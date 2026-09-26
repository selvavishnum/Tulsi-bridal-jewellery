/* ─────────────────────────────────────────────
   RBAC penetration tests — against the REAL route handlers.

   Only the edges are swapped out: the NextAuth session (who the caller
   claims to be), Firestore (an in-memory fake seeded per test), and the
   email/WhatsApp senders. Everything in between — requireRole, the
   zero-trust tier lookup against the staff collection, field-level
   checks, projections — is the production code path.

   Run: npm test
   ───────────────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';

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
const noop = async () => {};
mock.module(src('lib/email.js'), { namedExports: Object.fromEntries(['esc', 'sendOTPEmail', 'sendOrderConfirmation', 'sendOrderNotificationToAdmin', 'sendStatusUpdateEmail', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'sendVendorOrderNotification', 'isConfigured'].map((n) => [n, noop])) });
mock.module(src('lib/whatsapp.js'), { namedExports: Object.fromEntries(['sendOrderWhatsAppToAdmin', 'sendOrderWhatsAppToCustomer', 'sendStatusWhatsApp', 'sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])) });

const route = (p) => import(src(`app/api/${p}/route.js`));
const [analytics, reports, accounting, vendorLedger, settings, staff, orders, orderById, vendorOrderById, vendorOrders, products, productById, adminProducts, shipments, vendors, inventory, customers] = await Promise.all([
  route('admin/analytics'), route('reports'), route('admin/accounting'), route('admin/vendor-ledger'), route('admin/settings'),
  route('admin/staff'), route('orders'), route('orders/[id]'), route('vendor/orders/[id]'), route('vendor/orders'),
  route('products'), route('products/[id]'), route('admin/products'), route('admin/shipments'), route('admin/vendors'),
  route('admin/inventory'), route('admin/customers'),
]);
const [contact, coupons, feedbacks, returns, warehouses, suppliers, employees] = await Promise.all([
  route('contact'), route('coupons'), route('admin/feedbacks'), route('admin/returns'),
  route('admin/warehouses'), route('admin/suppliers'), route('admin/employees'),
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

beforeEach(() => {
  session = null;
  db = fakeFirestore({
    staff: {
      ofs: { email: 'ofs@tulsi.test', role: 'ORDER_FULFILLMENT_STAFF', status: 'Active' },
      cat: { email: 'cat@tulsi.test', role: 'CATALOG_STAFF', status: 'Active' },
      vA: { email: 'vendor-a@vendor.test', role: 'VENDOR', vendorId: 'vA', status: 'Active' },
      vB: { email: 'vendor-b@vendor.test', role: 'VENDOR', vendorId: 'vB', status: 'Active' },
      legacy: { email: 'ordermgr@tulsi.test', role: 'OrderManager', status: 'Active' },
      bm: { email: 'bizmgr@tulsi.test', role: 'BusinessManager', status: 'Active' },
      oldsuper: { email: 'oldsuper@tulsi.test', role: 'SuperAdmin', status: 'Active' },
      inv: { email: 'inv@tulsi.test', role: 'INVENTORY_MANAGER', status: 'Active' },
      sales: { email: 'sales@tulsi.test', role: 'SALES_STAFF', status: 'Active' },
      biz: { email: 'biz@tulsi.test', role: 'BUSINESS_MANAGER', status: 'Active', roleGrantedBy: 'owner@tulsi.test' },
      selfmade: { email: 'selfmade@tulsi.test', role: 'SUPER_ADMIN', status: 'Active' },
    },
    orders: {
      oA: {
        orderNumber: 'TBJ-A', status: 'confirmed', createdAt: '2026-09-20T10:00:00Z', total: 1000,
        vendorIds: ['vA'], vendorFees: { vA: 500 }, payment: { method: 'razorpay', status: 'paid', razorpaySignature: 'sig' },
        shippingAddress: { name: 'Priya Raman', phone: '9876543210', city: 'Madurai' },
        items: [{ product: 'p1', name: 'Jhumka', price: 1000, quantity: 1, vendorId: 'vA', supplyCost: 600 }],
      },
      oB: {
        orderNumber: 'TBJ-B', status: 'confirmed', createdAt: '2026-09-21T10:00:00Z', total: 2500,
        vendorIds: ['vB'], payment: { method: 'cod', status: 'pending' },
        shippingAddress: { name: 'Meena K', phone: '9123456780', city: 'Chennai' },
        items: [{ product: 'p2', name: 'Bangle', price: 2500, quantity: 1, vendorId: 'vB', supplyCost: 1800 }],
      },
    },
    products: {
      p1: { name: 'Jhumka', price: 1000, discountPrice: 0, supplyCost: 600, vendorId: 'vA', stock: 5, isActive: true, createdAt: '2026-01-01' },
    },
    settings: { site: { onlinePaymentEnabled: true } },
    users: {},
    vendorLedger: {},
    vendorPayouts: {},
    vendors: { vA: { name: 'Vendor A' }, vB: { name: 'Vendor B' } },
  });
});

/* ── (a) Fulfilment staff vs. financial analytics ── */

test('(a) fulfilment staff get 403 from every financial endpoint', async () => {
  signInAs('ofs@tulsi.test');
  assert.equal((await call(analytics, 'GET')).status, 403, '/api/admin/analytics');
  assert.equal((await call(reports, 'GET')).status, 403, '/api/reports');
  assert.equal((await call(accounting, 'GET')).status, 403, '/api/admin/accounting');
  assert.equal((await call(vendorLedger, 'GET', { url: 'http://tulsi.test/api/admin/vendor-ledger?vendorId=vA' })).status, 403, 'vendor ledger');
  assert.equal((await call(vendorLedger, 'POST', { body: { action: 'payout', vendorId: 'vA', reference: 'UTR' } })).status, 403, 'payout');
});

test('(a) …while the owner is allowed, proving the 403 is the role check and not a broken route', async () => {
  signInAs('owner@tulsi.test');
  assert.equal((await call(analytics, 'GET')).status, 200);
});

/* ── (b) Vendor IDOR: another vendor's order by direct id ── */

test('(b) a vendor requesting another vendor’s order by id gets 403', async () => {
  signInAs('vendor-a@vendor.test');
  assert.equal((await call(vendorOrderById, 'GET', { params: { id: 'oB' } })).status, 403);
  assert.equal((await call(vendorOrderById, 'GET', { params: { id: 'does-not-exist' } })).status, 403, 'same answer for missing ids — no existence oracle');
  assert.equal((await call(orderById, 'GET', { params: { id: 'oB' } })).status, 403, 'the customer order route refuses it too');
});

test('(b) …own order works, with no supply cost, contact details or other vendors in it', async () => {
  signInAs('vendor-a@vendor.test');
  const { status, json } = await call(vendorOrderById, 'GET', { params: { id: 'oA' } });
  assert.equal(status, 200);
  const body = JSON.stringify(json);
  for (const leak of ['supplyCost', '600', '9876543210', 'Bangle', 'vendorFees']) assert.ok(!body.includes(leak), `leaked ${leak}`);
  const list = await call(vendorOrders, 'GET');
  assert.deepEqual(list.json.data.orders.map((o) => o.orderNumber), ['TBJ-A']);
});

test('(b) a vendor gets 403 from the platform admin APIs', async () => {
  signInAs('vendor-a@vendor.test');
  assert.equal((await call(adminProducts, 'GET')).status, 403);
  assert.equal((await call(vendorLedger, 'GET', { url: 'http://tulsi.test/api/admin/vendor-ledger?vendorId=vA' })).status, 403);
});

/* ── (c) Catalog staff vs. payment gateway settings ── */

test('(c) catalog staff trying to update payment gateway keys get 403, and nothing is written', async () => {
  signInAs('cat@tulsi.test');
  const res = await call(settings, 'POST', { body: { razorpayKeyId: 'rzp_live_attacker', razorpayKeySecret: 'x', onlinePaymentEnabled: false } });
  assert.equal(res.status, 403);
  assert.deepEqual(db.store.get('settings').get('site'), { onlinePaymentEnabled: true });
});

test('(c) …the owner can write settings (control)', async () => {
  signInAs('owner@tulsi.test');
  assert.equal((await call(settings, 'POST', { body: { onlinePaymentEnabled: false } })).status, 200);
});

/* ── Field-level limits and escalation ── */

test('catalog staff: price, supply cost, vendor and delete are 403; copy and stock edits work; costs never returned', async () => {
  signInAs('cat@tulsi.test');
  assert.equal((await call(productById, 'PUT', { params: { id: 'p1' }, body: { price: 1 } })).status, 403);
  assert.equal((await call(productById, 'PUT', { params: { id: 'p1' }, body: { supplyCost: 0 } })).status, 403);
  assert.equal((await call(productById, 'PUT', { params: { id: 'p1' }, body: { vendorId: 'vB' } })).status, 403);
  assert.equal((await call(productById, 'DELETE', { params: { id: 'p1' } })).status, 403);
  assert.equal(db.store.get('products').get('p1').price, 1000);

  const ok = await call(productById, 'PUT', { params: { id: 'p1' }, body: { description: 'Temple jhumka', stock: 9 } });
  assert.equal(ok.status, 200);
  assert.equal(db.store.get('products').get('p1').stock, 9);
  const [adj] = [...db.store.get('stockAdjustments').values()];
  assert.deepEqual([adj.from, adj.to, adj.by], [5, 9, 'cat@tulsi.test'], 'catalog stock change is logged for reconciliation');
  assert.ok(!JSON.stringify(ok.json).includes('supplyCost'));
  assert.ok(!JSON.stringify((await call(adminProducts, 'GET')).json).includes('supplyCost'));
});

test('catalog staff: a new product is a hidden draft, and a priced create is refused', async () => {
  signInAs('cat@tulsi.test');
  assert.equal((await call(products, 'POST', { body: { name: 'Draft set', price: 4999 } })).status, 403);
  const res = await call(products, 'POST', { body: { name: 'Draft set', category: 'set', stock: 2 } });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.isActive, false);
  assert.equal(res.json.data.price, 0);
});

test('catalog staff see no orders or customer data', async () => {
  signInAs('cat@tulsi.test');
  const res = await call(orders, 'GET', { url: 'http://tulsi.test/api/orders' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.data.orders, [], 'only their own purchases, of which there are none');
  assert.equal((await call(orderById, 'GET', { params: { id: 'oA' } })).status, 403);
});

test('fulfilment staff: may mark Packed, but not Delivered, not cancel, not set the courier charge; see no costs', async () => {
  signInAs('ofs@tulsi.test');
  assert.equal((await call(orderById, 'PUT', { params: { id: 'oA' }, body: { status: 'delivered' } })).status, 403);
  assert.equal((await call(orderById, 'PUT', { params: { id: 'oA' }, body: { status: 'cancelled' } })).status, 403);
  assert.equal((await call(orderById, 'PUT', { params: { id: 'oA' }, body: { shippingCostActual: 1 } })).status, 403);
  const packed = await call(orderById, 'PUT', { params: { id: 'oA' }, body: { status: 'processing' } });
  assert.equal(packed.status, 200);
  assert.equal(db.store.get('orders').get('oA').status, 'processing');

  const list = await call(orders, 'GET', { url: 'http://tulsi.test/api/orders?limit=50' });
  assert.equal(list.json.data.orders.length, 2);
  const body = JSON.stringify(list.json);
  for (const leak of ['supplyCost', 'vendorFees', 'razorpaySignature']) assert.ok(!body.includes(leak), `leaked ${leak}`);
});

test('no one below SUPER_ADMIN can grant themselves more access', async () => {
  for (const email of ['ofs@tulsi.test', 'cat@tulsi.test', 'inv@tulsi.test', 'sales@tulsi.test', 'biz@tulsi.test', 'vendor-a@vendor.test']) {
    signInAs(email);
    const res = await call(staff, 'POST', { body: { name: 'Me', email: 'me2@tulsi.test', password: 'password1', role: 'SUPER_ADMIN' } });
    assert.equal(res.status, 403, email);
  }
});

test('zero trust: deactivating a staff member takes effect on their very next request', async () => {
  signInAs('ofs@tulsi.test');
  assert.equal((await call(orderById, 'GET', { params: { id: 'oA' } })).status, 200);
  db.store.get('staff').get('ofs').status = 'Inactive'; // same session, record changed
  assert.equal((await call(orderById, 'GET', { params: { id: 'oA' } })).status, 403);
});

test('legacy role names keep their mapped access', async () => {
  signInAs('ordermgr@tulsi.test'); // "OrderManager" → ORDER_MANAGER
  assert.equal((await call(orderById, 'GET', { params: { id: 'oA' } })).status, 200);
  assert.equal((await call(analytics, 'GET')).status, 403);
  signInAs('bizmgr@tulsi.test'); // legacy "BusinessManager" with no recorded grant → nothing until re-granted
  assert.equal((await call(reports, 'GET')).status, 403);
  assert.equal((await call(accounting, 'GET')).status, 403);
  db.store.get('staff').get('bm').roleGrantedBy = 'owner@tulsi.test'; // re-saved on the Staff page
  assert.equal((await call(reports, 'GET')).status, 200);
  assert.equal((await call(vendorLedger, 'POST', { body: { action: 'payout', vendorId: 'vA', reference: 'UTR' } })).status, 403);
});

test('sales staff: read orders and customers without costs; cannot change orders, ship, or see finance', async () => {
  signInAs('sales@tulsi.test');
  const list = await call(orders, 'GET', { url: 'http://tulsi.test/api/orders?limit=50' });
  assert.equal(list.json.data.orders.length, 2);
  for (const leak of ['supplyCost', 'vendorFees', 'razorpaySignature']) assert.ok(!JSON.stringify(list.json).includes(leak), `leaked ${leak}`);
  assert.equal((await call(customers, 'GET')).status, 200);
  assert.equal((await call(orderById, 'PUT', { params: { id: 'oA' }, body: { status: 'processing' } })).status, 403);
  assert.equal(db.store.get('orders').get('oA').status, 'confirmed');
  assert.equal((await call(shipments, 'POST', { body: { orderId: 'oA' } })).status, 403);
  assert.equal((await call(analytics, 'GET')).status, 403);
  assert.equal((await call(reports, 'GET')).status, 403);
  assert.equal((await call(adminProducts, 'GET')).status, 403);
});

test('inventory manager: stock counts only — no new products, copy, price or orders', async () => {
  signInAs('inv@tulsi.test');
  const ok = await call(inventory, 'PATCH', { body: { id: 'p1', inStock: 7 } });
  assert.equal(ok.status, 200);
  assert.equal(db.store.get('products').get('p1').stock, 7);
  assert.ok(!JSON.stringify(ok.json).includes('supplyCost'));
  assert.equal((await call(inventory, 'PATCH', { body: { id: 'p1', mrp: 1 } })).status, 403);
  assert.equal((await call(products, 'POST', { body: { name: 'New', stock: 1 } })).status, 403);
  assert.equal((await call(productById, 'PUT', { params: { id: 'p1' }, body: { description: 'x' } })).status, 403);
  assert.equal((await call(orderById, 'GET', { params: { id: 'oA' } })).status, 403);
  assert.equal((await call(customers, 'GET')).status, 403);
});

test('business manager: operation, CRM, product, reports and management work', async () => {
  signInAs('biz@tulsi.test');
  // Operation
  assert.equal((await call(contact, 'GET')).status, 200, 'messages');
  const one = await call(orderById, 'GET', { params: { id: 'oA' } });
  assert.equal(one.status, 200);
  assert.ok(JSON.stringify(one.json).includes('supplyCost'), 'full order view (margin) for accounting');
  const confirmed = await call(orderById, 'PUT', { params: { id: 'oB' }, body: { status: 'processing' } });
  assert.equal(confirmed.status, 200, 'full order control');
  // CRM
  for (const [mod, name] of [[customers, 'customers'], [coupons, 'coupons'], [feedbacks, 'feedbacks'], [returns, 'returns']]) {
    assert.equal((await call(mod, 'GET')).status, 200, name);
  }
  // Product: price and margin too
  const priced = await call(productById, 'PUT', { params: { id: 'p1' }, body: { price: 1500, supplyCost: 700 } });
  assert.equal(priced.status, 200);
  assert.equal(db.store.get('products').get('p1').price, 1500);
  assert.ok(JSON.stringify((await call(adminProducts, 'GET')).json).includes('supplyCost'));
  // Reports
  assert.equal((await call(reports, 'GET')).status, 200);
  assert.equal((await call(analytics, 'GET')).status, 200);
  // Management
  for (const [mod, name] of [[warehouses, 'warehouses'], [suppliers, 'suppliers'], [employees, 'employees'], [accounting, 'accounting']]) {
    assert.equal((await call(mod, 'GET')).status, 200, name);
  }
});

test('business manager: still no vendor payouts or bank details, staff & access, or settings / gateway keys', async () => {
  signInAs('biz@tulsi.test');
  assert.equal((await call(vendorLedger, 'POST', { body: { action: 'payout', vendorId: 'vA', reference: 'UTR' } })).status, 403);
  assert.equal((await call(vendorLedger, 'GET', { url: 'http://tulsi.test/api/admin/vendor-ledger?vendorId=vA' })).status, 403);
  assert.equal((await call(vendors, 'PUT', { url: 'http://tulsi.test/api/admin/vendors?id=vA', body: { payout: { method: 'upi', upiId: 'x@okaxis' } } })).status, 403);
  const list = await call(vendors, 'GET');
  assert.equal(list.status, 200, 'vendor names for the product form');
  assert.ok(!/payout|accountNumber|upiId|summary|platformFee/.test(JSON.stringify(list.json)), 'no bank details or money in the list');
  assert.equal((await call(settings, 'POST', { body: { razorpayKeyId: 'rzp_live_attacker' } })).status, 403);
  assert.equal((await call(staff, 'POST', { body: { name: 'Me', email: 'me3@tulsi.test', password: 'password1', role: 'SUPER_ADMIN' } })).status, 403);
});

test('the new business-manager areas stay closed to the narrower roles', async () => {
  for (const email of ['ofs@tulsi.test', 'cat@tulsi.test', 'inv@tulsi.test', 'sales@tulsi.test']) {
    signInAs(email);
    for (const [mod, name] of [[contact, 'messages'], [coupons, 'coupons'], [feedbacks, 'feedbacks'], [returns, 'returns'], [warehouses, 'warehouses'], [suppliers, 'suppliers'], [employees, 'employees'], [accounting, 'accounting'], [vendors, 'vendors']]) {
      assert.equal((await call(mod, 'GET')).status, 403, `${email} → ${name}`);
    }
  }
});

test('signed out: 401 on admin and vendor endpoints', async () => {
  signInAs(null);
  assert.equal((await call(analytics, 'GET')).status, 401);
  assert.equal((await call(accounting, 'GET')).status, 403, 'legacy requireAdmin routes answer 403 when signed out');
  assert.equal((await call(adminProducts, 'GET')).status, 401);
  assert.equal((await call(vendorOrderById, 'GET', { params: { id: 'oA' } })).status, 401);
});

test('review H1: a pre-existing "SuperAdmin" or ungranted SUPER_ADMIN staff record gets no money powers', async () => {
  for (const email of ['oldsuper@tulsi.test', 'selfmade@tulsi.test']) {
    signInAs(email);
    assert.equal((await call(vendorLedger, 'POST', { body: { action: 'payout', vendorId: 'vA', reference: 'UTR' } })).status, 403, email);
    assert.equal((await call(vendors, 'PUT', { url: 'http://tulsi.test/api/admin/vendors?id=vA', body: { payout: { method: 'upi', upiId: 'thief@okaxis' } } })).status, 403, email);
  }
});

test('review H1: a Super Admin granted through the Staff page works, and the grant is stamped', async () => {
  signInAs('owner@tulsi.test');
  const res = await call(staff, 'POST', { body: { name: 'Co-owner', email: 'co@tulsi.test', password: 'password1', role: 'SUPER_ADMIN' } });
  assert.equal(res.status, 201);
  const rec = [...db.store.get('staff').values()].find((r) => r.email === 'co@tulsi.test');
  assert.equal(rec.roleGrantedBy, 'owner@tulsi.test');
  signInAs('co@tulsi.test');
  assert.equal((await call(analytics, 'GET')).status, 200);
});

test('review H2: fulfilment staff cannot set the courier charge that is deducted from vendor payouts', async () => {
  signInAs('ofs@tulsi.test');
  const res = await call(shipments, 'POST', { body: { orderId: 'oA', manualTracking: true, trackingNumber: 'AWB1', shippingCost: 0 } });
  assert.equal(res.status, 403);
  assert.equal(db.store.get('orders').get('oA').shippingCostActual, undefined);
  const ok = await call(shipments, 'POST', { body: { orderId: 'oA', manualTracking: true, trackingNumber: 'AWB1' } });
  assert.equal(ok.status, 200, 'booking the parcel itself is still allowed');
});

test('review L2: fulfilment staff cannot edit tracking or notes outside the packing/shipping window', async () => {
  db.store.get('orders').get('oA').status = 'delivered';
  signInAs('ofs@tulsi.test');
  assert.equal((await call(orderById, 'PUT', { params: { id: 'oA' }, body: { trackingNumber: 'X' } })).status, 400);
  assert.notEqual(db.store.get('orders').get('oA').trackingNumber, 'X');
});
