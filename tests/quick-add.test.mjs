/* ─────────────────────────────────────────────
   Quick Add Product (Inventory screen): schema and
   POST /api/admin/products/quick-add against the real handler.
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { parseQuickAdd, generateSku, discountPercent, isLowStock } from '../src/lib/quickAddProduct.js';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (email) => { session = email ? { user: { id: `uid-${email}`, email } } : null; };

mock.module('next-auth', { defaultExport: { getServerSession: async () => session }, namedExports: { getServerSession: async () => session } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db, getBucket: () => null,
    FieldValue: { increment: (n) => n, serverTimestamp: () => new Date().toISOString() },
    Timestamp: class {}, docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    toPublicProduct: (p) => p, paginate: async () => ({}), newId: () => 'x',
  },
});
const route = await import(src('app/api/admin/products/quick-add/route.js'));
const post = (body) => route.POST(new Request('http://tulsi.test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  .then(async (r) => ({ status: r.status, json: await r.json() }));

const IMG = 'https://res.cloudinary.com/demo/image/upload/v1/tulsi-bridal/products/a.jpg';
const valid = (over = {}) => ({
  name: 'Antique Matte Finish Lakshmi Choker', category: 'necklace', designType: 'Temple', sku: '',
  purchasePrice: '1800', mrp: '4,500', salePrice: '3600', stock: '3', lowStockAt: '2', images: [IMG], ...over,
});

beforeEach(() => {
  session = null;
  db = fakeFirestore({
    staff: { pm: { email: 'pm@tulsi.test', role: 'PRODUCT_MANAGER', status: 'Active' }, inv: { email: 'inv@tulsi.test', role: 'INVENTORY_MANAGER', status: 'Active' } },
    products: { old: { name: 'Old', sku: 'TJ-NK-1024', stock: 1 } },
    stockLots: { l1: { lotNumber: 'LOT-TBJ-0007', productId: 'old', remainingQty: 1, status: 'active' } },
  });
});

/* ── Schema ── */

test('schema: live discount %, auto SKU, defaults and friendly errors', () => {
  assert.equal(discountPercent(4500, 3600), 20);
  assert.equal(discountPercent(3600, 3600), 0);
  assert.match(generateSku('necklace', 1_700_000_000_000), /^TJ-NK-[0-9A-Z]{6}$/);
  assert.match(generateSku('set'), /^TJ-BS-/);
  const { data } = parseQuickAdd(valid({ stock: '', lowStockAt: '', mrp: '' }));
  assert.equal(data.stock, 1, 'stock defaults to 1');
  assert.equal(data.lowStockAt, 2, 'alert defaults to 2');
  assert.equal(data.mrp, 3600, 'blank MRP = selling price (no discount)');
  const { errors } = parseQuickAdd(valid({ name: 'x', stock: '0', salePrice: '5000', sku: 'bad sku!', images: ['https://evil.test/a.jpg'] }));
  for (const k of ['name', 'stock', 'salePrice', 'sku', 'images']) assert.ok(errors[k], `${k} flagged`);
  assert.match(errors.salePrice, /above the MRP/);
  assert.ok(parseQuickAdd(valid({ salePrice: '', mrp: '' })).errors.salePrice, 'owners must price it');
  assert.ok(!parseQuickAdd(valid({ salePrice: '', mrp: '', purchasePrice: '' }), { pricing: false }).errors, 'staff draft needs no price');
  assert.equal(isLowStock({ stock: 2, lowStockAt: 2 }), true);
  assert.equal(isLowStock({ stock: 3, lowStockAt: 2 }), false);
  assert.equal(isLowStock({ stock: 3 }), true, 'older products default to 3');
});

/* ── API ── */

test('owner: priced product goes live with stock, and the cost opens a FIFO lot', async () => {
  signInAs('owner@tulsi.test');
  const r = await post(valid());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const p = r.json.data;
  assert.match(p.sku, /^TJ-NK-/);
  assert.equal(p.price, 4500);
  assert.equal(p.discountPrice, 3600);
  assert.equal(p.stock, 3);
  assert.equal(p.lowStockAt, 2);
  assert.equal(p.subCategory, 'Temple');
  assert.equal(p.isActive, true);
  assert.equal(p.showMe, true);
  assert.equal(p.purchasePrice, 1800);
  const lot = [...db.store.get('stockLots').values()].find((l) => l.productId === p.id);
  assert.equal(lot.lotNumber, 'LOT-TBJ-0008', 'next number after the existing lot');
  assert.equal(lot.originalQty, 3);
  assert.equal(lot.totalLotCost, 5400);
  assert.equal(lot.source, 'quick-add');
});

test('product staff: hidden draft without prices; sending prices is refused; inventory-only staff can’t create', async () => {
  signInAs('pm@tulsi.test');
  assert.equal((await post(valid())).status, 403, 'prices need a pricing role');
  const r = await post(valid({ purchasePrice: undefined, mrp: undefined, salePrice: undefined }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.isActive, false);
  assert.equal(r.json.data.showMe, false);
  assert.equal(r.json.data.price, 0);
  assert.equal(r.json.data.purchasePrice, undefined);
  assert.equal([...db.store.get('stockLots').values()].length, 1, 'no cost lot for a draft');
  signInAs('inv@tulsi.test');
  assert.equal((await post(valid({ purchasePrice: undefined, mrp: undefined, salePrice: undefined }))).status, 403);
  session = null;
  assert.equal((await post(valid())).status, 401);
});

test('duplicate SKU → 409 naming the other product; bad input → 400 with field errors', async () => {
  signInAs('owner@tulsi.test');
  const dup = await post(valid({ sku: 'tj-nk-1024' }));
  assert.equal(dup.status, 409);
  assert.match(dup.json.message, /Old/);
  assert.ok(dup.json.errors.sku);
  const bad = await post(valid({ name: '<b>x</b>', category: 'spaceship' }));
  assert.equal(bad.status, 400);
  assert.ok(bad.json.errors.name && bad.json.errors.category);
});
