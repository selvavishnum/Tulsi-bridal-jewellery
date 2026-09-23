/* ─────────────────────────────────────────────
   Vendor self-service portal — isolation and field-level tests against the
   REAL /api/vendor/* route handlers (only session, Firestore, Cloudinary
   and messaging are swapped for fakes).
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { parseVendorProduct, vendorPriceFloorError, parseVendorProfile } from '../src/lib/vendorCatalog.js';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (email) => { session = email ? { user: { id: `uid-${email}`, email } } : null; };
const getServerSession = async () => session;

mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db,
    getBucket: () => null,
    FieldValue: { increment: (n) => n, serverTimestamp: () => new Date().toISOString() },
    Timestamp: class {},
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    toPublicProduct: (p) => p,
    paginate: async () => ({}),
    newId: () => `id${Date.now()}`,
  },
});
mock.module(src('lib/cloudinary.js'), { namedExports: { uploadImage: async () => ({ url: 'https://res.cloudinary.com/x/image/upload/v1/a.jpg' }), deleteImage: async () => {} } });

const route = (p) => import(src(`app/api/${p}/route.js`));
const [products, productById, inventory, profile, payoutReq, summary, vendorOrders, adminVendors] = await Promise.all([
  route('vendor/products'), route('vendor/products/[id]'), route('vendor/inventory'), route('vendor/profile'),
  route('vendor/profile/payout'), route('vendor/summary'), route('vendor/orders'), route('admin/vendors'),
]);

async function call(mod, method, { url = 'http://tulsi.test/api', body, params = {} } = {}) {
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const res = await mod[method](request, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
}

const SECRETS = ['supplyCost', 'platformFeeBps', 'razorpay', 'rzp_', 'accountNumber', 'restockQty', 'submittedBy'];
const assertNoSecrets = (payload, where) => {
  const s = JSON.stringify(payload);
  for (const k of SECRETS) assert.ok(!s.includes(k), `${where} leaked ${k}`);
};

beforeEach(() => {
  session = null;
  db = fakeFirestore({
    staff: {
      vA: { email: 'a@vendor.test', role: 'VENDOR', vendorId: 'vA', status: 'Active' },
      vB: { email: 'b@vendor.test', role: 'VENDOR', vendorId: 'vB', status: 'Active' },
      vS: { email: 's@vendor.test', role: 'VENDOR', vendorId: 'vS', status: 'Active' },
    },
    vendors: {
      vA: { name: 'Vendor A', status: 'active', platformFeeBps: 1000, payout: { method: 'bank', accountName: 'A', accountNumber: '123456789012', ifsc: 'HDFC0001234' } },
      vB: { name: 'Vendor B', status: 'active', platformFeeBps: 500 },
      vS: { name: 'Suspended', status: 'suspended' },
    },
    products: {
      pA: { name: 'Jhumka', sku: 'A-1', category: 'earrings', price: 2000, discountPrice: 0, supplyCost: 1200, vendorId: 'vA', stock: 5, isActive: true, images: ['https://example.com/old.jpg'] },
      pB: { name: 'Bangle', sku: 'B-1', category: 'bangles', price: 3000, supplyCost: 1800, vendorId: 'vB', stock: 4, isActive: true },
      pT: { name: 'Tulsi own', sku: 'T-1', category: 'ring', price: 900, vendorId: 'tulsi', stock: 3, isActive: true },
    },
    settings: { site: { razorpayKeyId: 'rzp_live_secret', razorpayKeySecret: 'shh' } },
    orders: {
      oB: { orderNumber: 'TBJ-B', vendorIds: ['vB'], items: [{ product: 'pB', name: 'Bangle', price: 3000, quantity: 1, vendorId: 'vB', supplyCost: 1800 }] },
    },
    vendorLedger: {
      'oA__vA': { vendorId: 'vA', type: 'order_settlement', orderNumber: 'TBJ-A', status: 'unsettled', availableAt: '2020-01-01T00:00:00Z', createdAt: '2020-01-01',
        itemsPaise: 200000, grossPaise: 200000, supplyCostPaise: 120000, shippingPaise: 8000, platformFeePaise: 20000, netPaise: 52000 },
    },
    vendorPayouts: {},
  });
});

test('a vendor lists only their own products, without supply cost or platform fields', async () => {
  signInAs('a@vendor.test');
  const res = await call(products, 'GET');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.data.map((p) => p.id), ['pA']);
  assertNoSecrets(res.json, 'product list');
});

test('IDOR: another vendor’s product (or the platform’s) is a 404 for read, edit and stock', async () => {
  signInAs('a@vendor.test');
  for (const id of ['pB', 'pT', 'nope']) {
    assert.equal((await call(productById, 'GET', { params: { id } })).status, 404, `GET ${id}`);
    assert.equal((await call(productById, 'PUT', { params: { id }, body: { price: 1 } })).status, 404, `PUT ${id}`);
    assert.equal((await call(inventory, 'PATCH', { body: { id, stock: 0 } })).status, 404, `PATCH ${id}`);
  }
  assert.equal(db.store.get('products').get('pB').price, 3000);
  assert.equal(db.store.get('products').get('pB').stock, 4);
  assert.equal(db.store.get('products').get('pT').stock, 3);
});

test('a vendor cannot set supply cost, vendor, publishing or feature flags — 403 and nothing written', async () => {
  signInAs('a@vendor.test');
  for (const body of [{ supplyCost: 1 }, { vendorId: 'vB' }, { isActive: true }, { showMe: true }, { featured: true }, { reviewStatus: 'approved' }]) {
    const res = await call(productById, 'PUT', { params: { id: 'pA' }, body });
    assert.equal(res.status, 403, JSON.stringify(body));
  }
  const p = db.store.get('products').get('pA');
  assert.equal(p.supplyCost, 1200);
  assert.equal(p.vendorId, 'vA');
  const created = await call(products, 'POST', { body: { name: 'X', category: 'ring', price: 500, vendorId: 'vB' } });
  assert.equal(created.status, 403);
});

test('a vendor can reprice their own piece, but not below the supply cost — and the floor is not revealed', async () => {
  signInAs('a@vendor.test');
  const ok = await call(productById, 'PUT', { params: { id: 'pA' }, body: { price: 2500, discountPrice: 2200 } });
  assert.equal(ok.status, 200);
  assert.equal(db.store.get('products').get('pA').discountPrice, 2200);
  assertNoSecrets(ok.json, 'edit response');

  const low = await call(productById, 'PUT', { params: { id: 'pA' }, body: { discountPrice: 1000 } });
  assert.equal(low.status, 400);
  assert.ok(!low.json.message.includes('1200') && !low.json.message.includes('1,200'), 'floor value leaked');
  assert.equal(db.store.get('products').get('pA').discountPrice, 2200);
});

test('a new vendor product is a hidden draft owned by that vendor, pending Tulsi review', async () => {
  signInAs('a@vendor.test');
  const res = await call(products, 'POST', { body: { name: 'Temple haaram', category: 'necklace', price: 8000, stock: 2 } });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.status, 'in_review');
  const stored = db.store.get('products').get(res.json.data.id);
  assert.equal(stored.vendorId, 'vA');
  assert.equal(stored.isActive, false);
  assert.equal(stored.supplyCost, 0);
  assertNoSecrets(res.json, 'create response');
});

test('stock: quick toggle and quantity edit work on own products and are logged', async () => {
  signInAs('a@vendor.test');
  const off = await call(inventory, 'PATCH', { body: { id: 'pA', inStock: false } });
  assert.equal(off.status, 200);
  assert.equal(db.store.get('products').get('pA').stock, 0);
  const on = await call(inventory, 'PATCH', { body: { id: 'pA', inStock: true } });
  assert.equal(on.json.data.stock, 5, 'restores the previous quantity');
  await call(inventory, 'PATCH', { body: { id: 'pA', stock: 9 } });
  assert.equal(db.store.get('products').get('pA').stock, 9);
  assert.equal((await call(inventory, 'PATCH', { body: { id: 'pA', price: 1 } })).status, 403, 'inventory route is stock-only');
  const logs = [...db.store.get('stockAdjustments').values()];
  assert.equal(logs.length, 3);
  assert.ok(logs.every((l) => l.vendorId === 'vA' && l.tier === 'VENDOR'));
  assertNoSecrets(on.json, 'inventory response');
});

test('a suspended vendor can read but not write', async () => {
  signInAs('s@vendor.test');
  assert.equal((await call(products, 'GET')).status, 200);
  assert.equal((await call(products, 'POST', { body: { name: 'X', category: 'ring', price: 500 } })).status, 403);
  assert.equal((await call(profile, 'PUT', { body: { name: 'New' } })).status, 403);
});

test('profile: vendor edits store details; fee and payout are not editable there; bank details masked', async () => {
  signInAs('a@vendor.test');
  const got = await call(profile, 'GET');
  assert.equal(got.status, 200);
  assertNoSecrets(got.json, 'profile');
  assert.ok(got.json.data.payoutDestination.includes('••••9012'));

  const saved = await call(profile, 'PUT', { body: { name: 'A Jewels', phone: '9876543210', pickupAddress: { line1: '1 Main St', city: 'Thuckalay', state: 'Tamil Nadu', pincode: '629175' } } });
  assert.equal(saved.status, 200);
  assert.equal(db.store.get('vendors').get('vA').pickupAddress.city, 'Thuckalay');
  for (const body of [{ platformFeeBps: 0 }, { status: 'active' }, { payout: { method: 'upi', upiId: 'x@okaxis' } }]) {
    assert.equal((await call(profile, 'PUT', { body })).status, 403, JSON.stringify(body));
  }
  assert.equal(db.store.get('vendors').get('vA').platformFeeBps, 1000);
});

test('payout change is only a request: payouts keep going to the old account until a Super Admin approves', async () => {
  signInAs('a@vendor.test');
  const req = await call(payoutReq, 'POST', { body: { payout: { method: 'upi', upiId: 'thief@okaxis' } } });
  assert.equal(req.status, 200);
  const v = db.store.get('vendors').get('vA');
  assert.equal(v.payout.accountNumber, '123456789012', 'live destination unchanged');
  assert.equal(v.pendingPayout.upiId, 'thief@okaxis');

  // another vendor can't approve it, nor can the vendor themself
  assert.equal((await call(adminVendors, 'PUT', { url: 'http://tulsi.test/api/admin/vendors?id=vA', body: { pendingPayoutDecision: 'approve' } })).status, 403);

  signInAs('owner@tulsi.test');
  const ok = await call(adminVendors, 'PUT', { url: 'http://tulsi.test/api/admin/vendors?id=vA', body: { pendingPayoutDecision: 'approve' } });
  assert.equal(ok.status, 200);
  const after = db.store.get('vendors').get('vA');
  assert.equal(after.payout.upiId, 'thief@okaxis');
  assert.equal(after.pendingPayout, null);
});

test('ledger: total sold, logistics, combined charges and net reconcile; no fee rate or per-product cost', async () => {
  signInAs('a@vendor.test');
  const res = await call(summary, 'GET');
  assert.equal(res.status, 200);
  const s = res.json.data.summary;
  assert.equal(s.totalSoldPaise - s.logisticsPaise - s.chargesPaise, s.netPaise);
  assert.equal(s.availablePaise, 52000);
  const e = res.json.data.entries[0];
  assert.equal(e.totalSoldPaise - e.logisticsPaise - e.chargesPaise, e.netPaise);
  assertNoSecrets(res.json, 'summary');
});

test('orders: a vendor never sees another vendor’s orders', async () => {
  signInAs('a@vendor.test');
  const res = await call(vendorOrders, 'GET');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.data, []);
});

test('customers, staff and signed-out callers are refused by every vendor endpoint', async () => {
  for (const who of [null, 'shopper@gmail.test', 'owner@tulsi.test']) {
    signInAs(who);
    const expected = who ? 403 : 401;
    assert.equal((await call(products, 'GET')).status, expected, `${who} list`);
    assert.equal((await call(products, 'POST', { body: { name: 'X', category: 'ring', price: 1 } })).status, expected, `${who} create`);
    assert.equal((await call(inventory, 'PATCH', { body: { id: 'pA', stock: 0 } })).status, expected, `${who} stock`);
    assert.equal((await call(profile, 'GET')).status, expected, `${who} profile`);
  }
});

/* ── pure validation ── */

test('parseVendorProduct: whitelist, price and offer rules, image origin', () => {
  assert.equal(parseVendorProduct({ name: 'X', category: 'ring', price: 100, supplyCost: 1 }).status, 403);
  assert.ok(parseVendorProduct({ name: 'X', category: 'ring', price: 0 }).error);
  assert.ok(parseVendorProduct({ name: 'X', category: 'ring', price: 100, discountPrice: 100 }).error, 'offer must be lower');
  assert.ok(parseVendorProduct({ name: 'X', category: 'spaceship', price: 100 }).error);
  assert.ok(parseVendorProduct({ name: 'X', category: 'ring', price: 100, images: ['https://evil.test/a.jpg'] }).error);
  assert.ok(parseVendorProduct({ images: ['https://old.test/a.jpg'] }, { images: ['https://old.test/a.jpg'], price: 10 }).data, 'existing images may stay');
  assert.ok(parseVendorProduct({ name: 'X', category: 'ring', price: 100, stock: 1.5 }).error);
  assert.equal(vendorPriceFloorError({ supplyCost: 0, price: 1 }), null, 'drafts have no floor yet');
  assert.ok(vendorPriceFloorError({ supplyCost: 500, price: 1000, discountPrice: 400 }));
  assert.equal(parseVendorProfile({ platformFeeBps: 1 }).status, 403);
  assert.ok(parseVendorProfile({ pickupAddress: { line1: 'x', city: 'y', state: 'z', pincode: '12' } }).error);
});
