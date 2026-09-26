/* ─────────────────────────────────────────────
   Shipping & COD charges — the shared rule, the admin endpoint, and the
   server-side recalculation on the real order handler.
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { computeCharges, normalizeCharges, parseChargesInput, DEFAULT_CHARGES, freeShippingLine } from '../src/lib/storeCharges.js';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
delete process.env.SHIPROCKET_EMAIL;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (user) => { session = user ? { user } : null; };
const getServerSession = async () => session;

mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db, getBucket: () => null,
    FieldValue: { increment: (n) => n, serverTimestamp: () => new Date().toISOString() },
    Timestamp: class {},
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    toPublicProduct: (p) => p, paginate: async () => ({}), newId: () => `id${Date.now()}`,
  },
});
const noop = async () => {};
mock.module(src('lib/email.js'), { namedExports: { ...Object.fromEntries(['sendOTPEmail', 'sendOrderConfirmation', 'sendOrderNotificationToAdmin', 'sendStatusUpdateEmail', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'sendVendorOrderNotification', 'isConfigured'].map((n) => [n, noop])), esc: (v) => String(v ?? '') } });
mock.module(src('lib/whatsapp.js'), { namedExports: Object.fromEntries(['sendOrderWhatsAppToAdmin', 'sendOrderWhatsAppToCustomer', 'sendStatusWhatsApp', 'sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])) });

const route = (p) => import(src(`app/api/${p}/route.js`));
const [orders, adminCharges, publicCharges] = await Promise.all([route('orders'), route('admin/store-charges'), route('store-charges')]);

async function call(mod, method, body) {
  const res = await mod[method](new Request('http://tulsi.test/api', { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.1` }, ...(body !== undefined && { body: JSON.stringify(body) }) }), { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json() };
}

const ADDRESS = { fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' };
const order = (qty, method, extra = {}) => ({ items: [{ product: 'p1', quantity: qty }], shippingAddress: ADDRESS, payment: { method }, ...extra });
const CUSTOMER = { id: 'u1', email: 'priya@x.test', emailVerified: true };

beforeEach(() => {
  session = null;
  db = fakeFirestore({
    products: { p1: { name: 'Studs', price: 300, stock: 50, isActive: true } },
    users: { u1: { email: 'priya@x.test' } },
    staff: { m: { email: 'mgr@tulsi.test', role: 'ORDER_MANAGER', status: 'Active' } },
    settings: { site: {} },
  });
});

/* ── The shared rule ── */

test('rule: shipping fee below the threshold, free at or above it, free everywhere when switched off', () => {
  const c = { ...DEFAULT_CHARGES };
  assert.equal(computeCharges({ subtotal: 1999, paymentMethod: 'razorpay', charges: c }).shipping, 99);
  assert.equal(computeCharges({ subtotal: 2000, paymentMethod: 'razorpay', charges: c }).shipping, 0);
  assert.equal(computeCharges({ subtotal: 100, paymentMethod: 'razorpay', charges: { ...c, enable_shipping_fee: false } }).shipping, 0);
  assert.equal(computeCharges({ subtotal: 5000, paymentMethod: 'razorpay', charges: { ...c, free_shipping_threshold: 0 } }).shipping, 99, '0 threshold = never free');
});

test('rule: switching COD ↔ online adds / removes the COD fee (what the checkout recomputes on each change)', () => {
  const c = { ...DEFAULT_CHARGES, cod_fee_waive_above: null };
  const at = (method) => computeCharges({ subtotal: 1500, paymentMethod: method, charges: c });
  assert.equal(at('cod').codFee, 49);
  assert.equal(at('razorpay').codFee, 0);
  assert.equal(at('cod').codFee, 49, 'and back again');
  assert.equal(computeCharges({ subtotal: 1500, paymentMethod: 'cod', charges: { ...c, enable_cod_fee: false } }).codFee, 0);
  assert.equal(computeCharges({ subtotal: 600, paymentMethod: 'cod', charges: DEFAULT_CHARGES }).codFee, 0, 'default keeps the old ₹500 waiver');
  assert.equal(computeCharges({ subtotal: 400, paymentMethod: 'cod', charges: DEFAULT_CHARGES }).codFee, 49);
});

test('settings: missing or bad stored values fall back to safe defaults; admin input is validated', () => {
  assert.deepEqual(normalizeCharges(null).shipping_fee_amount, 99);
  assert.equal(normalizeCharges({ shipping_fee_amount: -5 }).shipping_fee_amount, 99);
  assert.match(parseChargesInput({ shipping_fee_amount: -1 }).error, /negative/);
  assert.match(parseChargesInput({ cod_fee_amount: 'abc' }).error, /number/);
  assert.match(parseChargesInput({ enable_cod_fee: true, cod_fee_amount: 0 }).error, /switch it off/);
  assert.match(parseChargesInput({ shipping_fee: 1 }).error, /Unknown/);
  assert.deepEqual(parseChargesInput({ enable_shipping_fee: false, shipping_fee_amount: 99 }).data, { enable_shipping_fee: false, shipping_fee_amount: 99 });
  assert.equal(freeShippingLine({ ...DEFAULT_CHARGES, enable_shipping_fee: false }), 'Free delivery on every order');
});

/* ── Admin endpoint ── */

test('only a Super Admin can change the charges; bad values are refused', async () => {
  signInAs({ id: 'm', email: 'mgr@tulsi.test' });
  assert.equal((await call(adminCharges, 'PUT', { enable_shipping_fee: false })).status, 403);
  signInAs({ id: 'o', email: 'owner@tulsi.test' });
  assert.equal((await call(adminCharges, 'PUT', { cod_fee_amount: -10 })).status, 400);
  const ok = await call(adminCharges, 'PUT', { enable_shipping_fee: true, shipping_fee_amount: 120, free_shipping_threshold: 3000 });
  assert.equal(ok.status, 200);
  assert.equal((await call(publicCharges, 'GET')).json.data.shipping_fee_amount, 120, 'public endpoint reflects it immediately');
});

/* ── Server recalculation ── */

test('turning the shipping fee off applies to the very next order (no cache, no restart)', async () => {
  signInAs(CUSTOMER);
  const before = await call(orders, 'POST', order(2, 'razorpay'));
  assert.equal(before.status, 201);
  assert.equal(before.json.data.shippingCost, 99);

  signInAs({ id: 'o', email: 'owner@tulsi.test' });
  await call(adminCharges, 'PUT', { enable_shipping_fee: false });

  signInAs(CUSTOMER);
  const after = await call(orders, 'POST', order(2, 'razorpay'));
  assert.equal(after.json.data.shippingCost, 0);
  assert.equal(after.json.data.total, 600);
});

test('COD fee is added on COD and never on online payment, from the stored settings', async () => {
  db.store.get('settings').set('store_settings', { enable_cod_fee: true, cod_fee_amount: 60, cod_fee_waive_above: null });
  signInAs(CUSTOMER);
  const cod = await call(orders, 'POST', order(1, 'cod'));
  assert.deepEqual([cod.json.data.codFee, cod.json.data.total], [60, 300 + 99 + 60]);
  const online = await call(orders, 'POST', order(1, 'razorpay'));
  assert.deepEqual([online.json.data.codFee, online.json.data.total], [0, 399]);
});

test('tampering: a payload claiming ₹0 shipping or COD fee while they are on is refused (409), nothing saved', async () => {
  db.store.get('settings').set('store_settings', { cod_fee_waive_above: null });
  signInAs(CUSTOMER);
  const noShip = await call(orders, 'POST', order(1, 'cod', { shippingCost: 0, codFee: 49 }));
  assert.equal(noShip.status, 409);
  assert.equal(noShip.json.code, 'CHARGES_CHANGED');
  assert.equal(noShip.json.charges.shipping_fee_amount, 99, 'the checkout gets the current charges to redisplay');
  const noCod = await call(orders, 'POST', order(1, 'cod', { shippingCost: 99, codFee: 0 }));
  assert.equal(noCod.status, 409);
  assert.ok(!db.store.has('orders') || db.store.get('orders').size === 0, 'no order created');
  const honest = await call(orders, 'POST', order(1, 'cod', { shippingCost: 99, codFee: 49 }));
  assert.equal(honest.status, 201);
  assert.equal(honest.json.data.total, 448);
});
