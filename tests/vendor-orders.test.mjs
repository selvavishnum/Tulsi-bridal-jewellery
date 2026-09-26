/* ─────────────────────────────────────────────
   Vendor order suite — counters, client-side filtering, and the
   multi-tenant guardrails on the real /api/vendor/orders handlers
   (session, Firestore, email and WhatsApp are fakes).
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import {
  vendorTabCounts, filterVendorOrders, VENDOR_ORDER_TABS, vendorTransitionError, toVendorOrderDetail,
} from '../src/lib/vendorOrders.js';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (email) => { session = email ? { user: { id: `uid-${email}`, email } } : null; };
const getServerSession = async () => session;
const vendorMails = [];
const customerMails = [];

mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db,
    getBucket: () => null,
    FieldValue: { increment: (n) => ({ __inc: n }), serverTimestamp: () => new Date().toISOString() },
    Timestamp: class {},
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    toPublicProduct: (p) => p,
    paginate: async () => ({}),
    newId: () => `id${Date.now()}`,
  },
});
const noop = async () => {};
mock.module(src('lib/email.js'), {
  namedExports: {
    ...Object.fromEntries(['sendOTPEmail', 'sendOrderConfirmation', 'sendOrderNotificationToAdmin', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'isConfigured'].map((n) => [n, noop])),
    esc: (v) => String(v ?? ''),
    sendStatusUpdateEmail: async (order, status) => { customerMails.push({ order: order.orderNumber, status }); },
    sendVendorOrderNotification: async (to, name, detail) => { vendorMails.push({ to, detail }); return true; },
  },
});
mock.module(src('lib/whatsapp.js'), { namedExports: Object.fromEntries(['sendOrderWhatsAppToAdmin', 'sendOrderWhatsAppToCustomer', 'sendStatusWhatsApp', 'sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])) });

const route = (p) => import(src(`app/api/${p}/route.js`));
const [list, one, ship, resend] = await Promise.all([
  route('vendor/orders'), route('vendor/orders/[id]'), route('vendor/orders/[id]/ship'), route('vendor/orders/[id]/resend-email'),
]);
const { notifyVendorsOfOrder } = await import(src('lib/vendorNotify.js'));

async function call(mod, method, { body, params = {} } = {}) {
  const request = new Request('http://tulsi.test/api', {
    method, headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const res = await mod[method](request, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
}

const ADDR = { name: 'Priya Raman', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' };
const line = (vendorId, name, price = 1000, extra = {}) => ({ product: `p-${name}`, name, price, quantity: 1, vendorId, supplyCost: price * 0.6, ...extra });
const order = (o) => ({ createdAt: new Date().toISOString(), shippingAddress: ADDR, shippingCost: 99, codFee: 0, total: 1099, ...o });

beforeEach(() => {
  session = null;
  vendorMails.length = 0;
  customerMails.length = 0;
  db = fakeFirestore({
    staff: {
      a: { email: 'a@vendor.test', role: 'VENDOR', vendorId: 'vA', status: 'Active' },
      b: { email: 'b@vendor.test', role: 'VENDOR', vendorId: 'vB', status: 'Active' },
    },
    vendors: {
      vA: { name: 'Vendor A', status: 'active', selfFulfil: true, contactEmail: 'orders@a.test' },
      vB: { name: 'Vendor B', status: 'active', selfFulfil: false },
    },
    products: { 'p-Jhumka': { stock: 5 }, 'p-Bangle': { stock: 5 }, 'p-Ring': { stock: 5 }, 'p-Chain': { stock: 5 } },
    orders: {
      a1: order({ orderNumber: 'TBJ-A1', status: 'pending', vendorIds: ['vA'], vendorFees: { vA: 1000 }, payment: { method: 'cod', status: 'pending', razorpaySignature: 'sig' }, items: [line('vA', 'Jhumka')] }),
      a2: order({ orderNumber: 'TBJ-A2', status: 'shipped', trackingNumber: 'AWB123', vendorIds: ['vA'], payment: { method: 'razorpay', status: 'paid' }, items: [line('vA', 'Ring')] }),
      a3: order({ orderNumber: 'TBJ-A3', status: 'confirmed', vendorIds: ['vA'], payment: { method: 'razorpay', status: 'paid' }, items: [line('vA', 'Chain')] }),
      mix: order({ orderNumber: 'TBJ-MIX', status: 'confirmed', vendorIds: ['vA', 'vB'], payment: { method: 'cod', status: 'pending' }, items: [line('vA', 'Jhumka'), line('vB', 'Bangle', 2500)] }),
      b1: order({ orderNumber: 'TBJ-B1', status: 'pending', vendorIds: ['vB'], payment: { method: 'cod', status: 'pending' }, items: [line('vB', 'Bangle', 2500)] }),
      x1: order({ orderNumber: 'TBJ-X1', status: 'cancelled', vendorIds: ['vA'], payment: { method: 'cod', status: 'pending' }, items: [line('vA', 'Ring')] }),
    },
  });
});

/* ── 1. Counters ── */

test('counters: every tab count equals the vendor’s own orders in that bucket, and the status tabs sum to All', async () => {
  signInAs('a@vendor.test');
  const { json } = await call(list, 'GET');
  const { orders, counts } = json.data;
  assert.deepEqual(orders.map((o) => o.orderNumber).sort(), ['TBJ-A1', 'TBJ-A2', 'TBJ-A3', 'TBJ-MIX', 'TBJ-X1']);
  for (const t of VENDOR_ORDER_TABS.filter((x) => x.filter)) {
    assert.equal(counts[t.id], filterVendorOrders(orders, t.id, '').length, t.id);
  }
  const byStatus = ['new', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'].reduce((s, k) => s + counts[k], 0);
  assert.equal(byStatus, counts.all);
  assert.equal(counts.all, 5, 'vendor B’s own order is not counted');
  assert.equal(counts.cod, 2, 'COD pending: A1 + MIX (cancelled X1 excluded)');
});

/* ── 2. Status pills filter client-side ── */

test('status pills and search re-filter the loaded feed (pure, no refetch)', () => {
  const orders = [
    { orderNumber: 'TBJ1', status: 'pending', createdAt: new Date().toISOString(), customer: { name: 'Priya', phone: '9876543210' } },
    { orderNumber: 'TBJ2', status: 'shipped', createdAt: new Date().toISOString(), customer: { name: 'Meena', phone: '9123456780' } },
    { orderNumber: 'TBJ3', status: 'processing', createdAt: new Date(Date.now() - 72 * 3600e3).toISOString(), customer: { name: 'Lakshmi' } },
  ];
  assert.deepEqual(filterVendorOrders(orders, 'shipped', '').map((o) => o.orderNumber), ['TBJ2']);
  assert.deepEqual(filterVendorOrders(orders, 'action', '').map((o) => o.orderNumber), ['TBJ3'], 'packed > 48h needs action');
  assert.deepEqual(filterVendorOrders(orders, 'all', 'meena').map((o) => o.orderNumber), ['TBJ2']);
  assert.deepEqual(filterVendorOrders(orders, 'all', '98765').map((o) => o.orderNumber), ['TBJ1'], 'by phone');
  assert.deepEqual(filterVendorOrders(orders, 'all', 'tbj3').map((o) => o.orderNumber), ['TBJ3'], 'by order number');
  assert.equal(vendorTabCounts(orders).all, 3);
});

/* ── 3. Tenant isolation ── */

test('IDOR: another vendor’s order is 403 for view, status, ship and resend — and nothing changes', async () => {
  signInAs('a@vendor.test');
  for (const id of ['b1', 'does-not-exist']) {
    assert.equal((await call(one, 'GET', { params: { id } })).status, 403, `GET ${id}`);
    assert.equal((await call(one, 'PATCH', { params: { id }, body: { status: 'confirmed' } })).status, 403, `PATCH ${id}`);
    assert.equal((await call(ship, 'POST', { params: { id }, body: { courierName: 'DTDC', trackingNumber: 'X1234' } })).status, 403, `ship ${id}`);
    assert.equal((await call(resend, 'POST', { params: { id } })).status, 403, `resend ${id}`);
  }
  assert.equal(db.store.get('orders').get('b1').status, 'pending');
  assert.equal(customerMails.length, 0);
});

test('mixed-seller order: vendor A sees only A’s line and subtotal, no customer contact, and can’t change it', async () => {
  signInAs('a@vendor.test');
  const { status, json } = await call(one, 'GET', { params: { id: 'mix' } });
  assert.equal(status, 200);
  const body = JSON.stringify(json);
  assert.deepEqual(json.data.items.map((i) => i.name), ['Jhumka']);
  assert.equal(json.data.itemsTotal, 1000);
  for (const leak of ['Bangle', '2500', '3599', '9876543210', 'Temple St', 'supplyCost', 'vendorFees', 'razorpay', 'sig']) assert.ok(!body.includes(leak), `leaked ${leak}`);
  assert.equal(json.data.charges, null, 'order totals belong to several sellers');
  assert.equal((await call(one, 'PATCH', { params: { id: 'mix' }, body: { status: 'processing' } })).status, 403);
  assert.equal(db.store.get('orders').get('mix').status, 'confirmed');
});

test('self-shipping off: vendor B sees their order read-only, without the address', async () => {
  signInAs('b@vendor.test');
  const { json } = await call(one, 'GET', { params: { id: 'b1' } });
  assert.equal(json.data.fulfilledBy, 'tulsi');
  assert.ok(!JSON.stringify(json).includes('9876543210'));
  assert.equal((await call(one, 'PATCH', { params: { id: 'b1' }, body: { status: 'confirmed' } })).status, 403);
});

test('self-fulfilled order: address and phone for the label; margin never per piece; no gateway fields', async () => {
  signInAs('a@vendor.test');
  const { json } = await call(one, 'GET', { params: { id: 'a1' } });
  assert.equal(json.data.fulfilledBy, 'vendor');
  assert.equal(json.data.customer.phone, '9876543210');
  const body = JSON.stringify(json);
  for (const leak of ['supplyCost', 'marginPercent', 'vendorFees', 'platformFeeBps', 'razorpaySignature', 'sig"']) assert.ok(!body.includes(leak), leak);
  // net = 1000 + 99 customer shipping − 99 shipping estimate − (600 margin + 100 fee)
  assert.deepEqual([json.data.earnings.tulsiCharges, json.data.earnings.net], [700, 300]);
});

/* ── 4. State machine ── */

test('status rules: COD confirm deducts stock; skipping ahead, reviving cancelled and cancelling prepaid are refused', async () => {
  signInAs('a@vendor.test');
  const ok = await call(one, 'PATCH', { params: { id: 'a1' }, body: { status: 'confirmed' } });
  assert.equal(ok.status, 200);
  assert.equal(db.store.get('orders').get('a1').status, 'confirmed');
  assert.equal(db.store.get('products').get('p-Jhumka').stock, 4, 'stock deducted once');
  assert.deepEqual(customerMails.at(-1), { order: 'TBJ-A1', status: 'confirmed' });

  assert.equal((await call(one, 'PATCH', { params: { id: 'a1' }, body: { status: 'delivered' } })).status, 400, 'confirmed → delivered skips shipping');
  assert.equal((await call(one, 'PATCH', { params: { id: 'a1' }, body: { status: 'shipped' } })).status, 400, 'no tracking yet');
  assert.equal((await call(one, 'PATCH', { params: { id: 'x1' }, body: { status: 'delivered' } })).status, 400, 'cancelled is final');
  assert.equal((await call(one, 'PATCH', { params: { id: 'a3' }, body: { status: 'cancelled' } })).status, 400, 'prepaid cancel is Tulsi’s (refund)');
  assert.equal((await call(one, 'PATCH', { params: { id: 'a1' }, body: { status: 'confirmed', supplyCost: 0 } })).status, 403, 'no extra fields');
  assert.ok(vendorTransitionError({ status: 'pending', payment: { method: 'razorpay', status: 'pending' } }, 'confirmed'), 'unpaid online order can’t be confirmed');
});

test('ship: manual tracking moves it to Shipped and tells the customer; delivered COD stays unpaid (no payout)', async () => {
  signInAs('a@vendor.test');
  await call(one, 'PATCH', { params: { id: 'a1' }, body: { status: 'confirmed' } });
  const shipped = await call(ship, 'POST', { params: { id: 'a1' }, body: { courierName: 'DTDC', trackingNumber: 'D12345678' } });
  assert.equal(shipped.status, 200);
  const o = db.store.get('orders').get('a1');
  assert.deepEqual([o.status, o.trackingNumber, o.courierName], ['shipped', 'D12345678', 'DTDC']);
  assert.ok(o.shippedAt);
  assert.deepEqual(customerMails.at(-1), { order: 'TBJ-A1', status: 'shipped' });

  const delivered = await call(one, 'PATCH', { params: { id: 'a1' }, body: { status: 'delivered' } });
  assert.equal(delivered.status, 200);
  const d = db.store.get('orders').get('a1');
  assert.equal(d.status, 'delivered');
  assert.equal(d.payment.status, 'pending', 'COD cash not confirmed by a vendor');
  assert.equal(d.deliveryReportedBy, 'vendor');
  assert.ok(!db.store.has('vendorLedger') || db.store.get('vendorLedger').size === 0, 'no earnings until Tulsi confirms the cash');
});

/* ── Vendor email ── */

test('new-order email: each vendor gets only their own lines, once per order', async () => {
  await notifyVendorsOfOrder(db, 'mix');
  await notifyVendorsOfOrder(db, 'mix'); // payment page + webhook both calling
  assert.equal(vendorMails.length, 2);
  const byTo = Object.fromEntries(vendorMails.map((m) => [m.to, m.detail.items.map((i) => i.name)]));
  assert.deepEqual(byTo, { 'orders@a.test': ['Jhumka'], 'b@vendor.test': ['Bangle'] }, 'B has no contact email → their login email');
  for (const m of vendorMails) assert.ok(!JSON.stringify(m.detail).includes('9876543210'), 'mixed order: Tulsi ships, no phone');
});

test('new-order email: goes to the vendor’s contact email, with the address only when they ship it', async () => {
  await notifyVendorsOfOrder(db, 'a1');
  assert.equal(vendorMails.length, 1);
  assert.equal(vendorMails[0].to, 'orders@a.test');
  assert.equal(vendorMails[0].detail.customer.phone, '9876543210');
  const mixed = toVendorOrderDetail({ id: 'mix', ...db.store.get('orders').get('mix') }, 'vB', { selfFulfil: false });
  assert.ok(!JSON.stringify(mixed).includes('Jhumka'), 'vendor B’s mail can’t show vendor A’s piece');
});
