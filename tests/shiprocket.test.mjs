/* ─────────────────────────────────────────────
   Shiprocket multi-warehouse — token manager, split planning, pickup sync
   and split dispatch, against the real handlers with Shiprocket's HTTP API
   replaced by an in-memory fake (global fetch).
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { createTokenManager, TOKEN_TTL_MS } from '../src/lib/shiprocketToken.js';
import { planShipments, summarizeShipments, pickupAddressProblem, pickupNickname } from '../src/lib/shipmentPlan.js';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
process.env.SHIPROCKET_EMAIL = 'ops@tulsi.test';
process.env.SHIPROCKET_PASSWORD = 'pw';
process.env.SHIPROCKET_PICKUP_LOCATION = 'Primary';
process.env.SHIPROCKET_PICKUP_PINCODE = '629175';
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

/* ── Fake Shiprocket ── */
let sr;
function resetShiprocket() {
  sr = { calls: [], logins: 0, expireNext: false, awbCounter: 100, rejectPickup: null, noCourier: false };
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const p = u.pathname.replace('/v1/external', '');
  const body = init.body ? JSON.parse(init.body) : null;
  sr.calls.push({ path: p, body, auth: init.headers?.Authorization });
  if (p === '/auth/login') { sr.logins += 1; return json(200, { token: `tok${sr.logins}` }); }
  if (sr.expireNext) { sr.expireNext = false; return json(401, { message: 'Token has expired' }); }
  if (p === '/settings/company/addpickup') {
    if (sr.rejectPickup) return json(422, { message: 'Invalid data', errors: { pin_code: [sr.rejectPickup] } });
    return json(200, { success: true, address: { pickup_code: body.pickup_location, phone_verified: 1 }, pickup_id: 555 });
  }
  if (p === '/orders/create/adhoc') return json(200, { order_id: `SR-${body.order_id}`, shipment_id: `SH-${body.order_id}` });
  if (p === '/courier/assign/awb') {
    if (sr.noCourier) return json(200, { awb_assign_status: 0, message: 'Courier not serviceable for this pincode', response: { data: {} } });
    return json(200, { awb_assign_status: 1, response: { data: { awb_code: `AWB${++sr.awbCounter}`, courier_name: 'Delhivery', courier_company_id: 7 } } });
  }
  if (p.startsWith('/courier/serviceability')) return json(200, { data: { available_courier_companies: [{ courier_company_id: 7, rate: u.searchParams.get('pickup_postcode') === '629175' ? 80 : 60 }] } });
  if (p === '/courier/generate/pickup') return json(200, { pickup_status: 1 });
  if (p === '/courier/generate/label') return json(200, { label_created: 1, label_url: `https://sr.test/label/${body.shipment_id.join('+')}.pdf` });
  if (p.startsWith('/courier/track/awb/')) return json(200, { tracking_data: { shipment_status: 6, shipment_track: [{ current_status: 'In Transit' }], shipment_track_activities: [{ date: '2026-09-26', activity: 'Picked up', location: 'Madurai' }] } });
  return json(404, { message: `unexpected ${p}` });
};

const route = (p) => import(src(`app/api/${p}/route.js`));
const [adminShip, adminLabel, orderById, vendorProfile, vendorOrder, vendorLabel, vendorTracking] = await Promise.all([
  route('admin/shipments'), route('admin/shipments/label'), route('orders/[id]'),
  route('vendor/profile'), route('vendor/orders/[id]'), route('vendor/orders/[id]/label'), route('vendor/orders/[id]/tracking'),
]);

async function call(mod, method, { body, params = {}, url = 'http://tulsi.test/api' } = {}) {
  const res = await mod[method](new Request(url, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) }), { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
}

const ADDR = { name: 'Priya Raman', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' };
const WAREHOUSE = { line1: '14 Car Street, Near Temple', line2: '', city: 'Nagercoil', state: 'Tamil Nadu', pincode: '629001' };
const line = (vendorId, name, price) => ({ product: `p-${name}`, name, sku: name.toUpperCase(), price, quantity: 1, vendorId, supplyCost: 100 });

beforeEach(() => {
  session = null;
  resetShiprocket();
  db = fakeFirestore({
    staff: {
      a: { email: 'a@vendor.test', role: 'VENDOR', vendorId: 'vA', status: 'Active' },
      b: { email: 'b@vendor.test', role: 'VENDOR', vendorId: 'vB', status: 'Active' },
    },
    vendors: {
      vA: { name: 'Vendor A', contactName: 'Anand', phone: '9000000001', status: 'active', selfFulfil: true, pickupAddress: WAREHOUSE, shiprocketPickupLocation: 'VENDOR_vA', shiprocketPickup: { nickname: 'VENDOR_vA', status: 'active' } },
      vB: { name: 'Vendor B', contactName: 'Bala', phone: '9000000002', status: 'active', selfFulfil: false },
    },
    products: { 'p-Jhumka': { stock: 5 }, 'p-Bangle': { stock: 5 }, 'p-Ring': { stock: 5 } },
    settings: { site: {} },
    orders: {
      mix: {
        orderNumber: 'TBJ9', status: 'confirmed', createdAt: new Date().toISOString(), shippingAddress: ADDR,
        vendorIds: ['vA', 'vB', 'tulsi'], shippingCost: 0, total: 3500,
        payment: { method: 'cod', status: 'pending' },
        items: [line('vA', 'Jhumka', 1000), line('vB', 'Bangle', 2000), line('tulsi', 'Ring', 500)],
      },
      solo: {
        orderNumber: 'TBJ10', status: 'confirmed', createdAt: new Date().toISOString(), shippingAddress: ADDR,
        vendorIds: ['vA'], shippingCost: 99, total: 1099, payment: { method: 'razorpay', status: 'paid' },
        items: [line('vA', 'Jhumka', 1000)],
      },
    },
  });
});

/* ── Token manager ── */

test('token: one login shared by concurrent callers, reused from the store, refreshed before 10 days, renewed on 401', async () => {
  let logins = 0;
  let stored = null;
  let t = 0;
  const m = createTokenManager({
    login: async () => { logins += 1; await new Promise((r) => setTimeout(r, 5)); return `T${logins}`; },
    store: { read: async () => stored, write: async (v) => { stored = v; } },
    now: () => t,
  });
  const [a, b] = await Promise.all([m.get(), m.get()]);
  assert.deepEqual([a, b, logins], ['T1', 'T1', 1], 'one login for parallel calls');
  assert.equal(stored.expiresAt, TOKEN_TTL_MS);
  const fresh = createTokenManager({ login: async () => 'NEW', store: { read: async () => stored, write: async () => {} }, now: () => t });
  assert.equal(await fresh.get(), 'T1', 'a cold instance reuses the stored token');
  t = TOKEN_TTL_MS; // 9 days later
  assert.equal(await m.get(), 'T2', 'refreshed at expiry');
  assert.equal(await m.renew(), 'T3', 'renew after 401');
});

test('client: an expired token (401) is renewed once and the call succeeds', async () => {
  signInAs('owner@tulsi.test');
  sr.expireNext = true;
  const res = await call(adminShip, 'POST', { body: { orderId: 'solo' } });
  assert.equal(res.status, 200, res.json.message);
  assert.ok(sr.logins >= 2, 'logged in again after the 401');
});

/* ── Planning ── */

test('plan: a mixed cart splits by warehouse; COD amounts add up to the order total', () => {
  const vendors = { vA: { selfFulfil: true, shiprocketPickupLocation: 'VENDOR_vA', pickupAddress: WAREHOUSE }, vB: { selfFulfil: false } };
  const plan = planShipments({ orderNumber: 'TBJ9', total: 3500, payment: { method: 'cod' }, items: [line('vA', 'Jhumka', 1000), line('vB', 'Bangle', 2000), line('tulsi', 'Ring', 500)] }, vendors, { pickupLocation: 'Primary' });
  assert.deepEqual(plan.map((p) => [p.key, p.pickupLocation, p.subOrderId]), [['tulsi', 'Primary', 'TBJ9-1'], ['vA', 'VENDOR_vA', 'TBJ9-2']]);
  assert.deepEqual(plan[0].items.map((i) => i.name), ['Bangle', 'Ring'], 'vendor without a pickup ships from Tulsi');
  assert.equal(plan.reduce((s, p) => s + p.subTotal, 0), 3500);
  assert.equal(pickupNickname('vA'), 'VENDOR_vA');
  assert.equal(pickupNickname('vA', 2), 'VENDOR_vA_2');
  assert.equal(summarizeShipments({ tulsi: { awb: 'X' } }, plan).allBooked, false);
});

test('pickup address pre-checks give instant, specific messages', () => {
  assert.match(pickupAddressProblem({ ...WAREHOUSE, line1: 'Car Street near temple', name: 'A', phone: '9000000001' }), /house, flat/);
  assert.match(pickupAddressProblem({ ...WAREHOUSE, pincode: '12', name: 'A', phone: '9000000001' }), /pincode/);
  assert.match(pickupAddressProblem({ ...WAREHOUSE, name: 'A', phone: '123' }), /mobile/);
  assert.equal(pickupAddressProblem({ ...WAREHOUSE, name: 'A', phone: '9000000001' }), null);
});

/* ── Pickup sync ── */

test('saving a warehouse address registers VENDOR_<id> with Shiprocket; a changed address gets a new version', async () => {
  signInAs('b@vendor.test');
  const first = await call(vendorProfile, 'PUT', { body: { pickupAddress: WAREHOUSE } });
  assert.equal(first.status, 200);
  assert.equal(first.json.pickupSync.status, 'active');
  const add = sr.calls.find((c) => c.path === '/settings/company/addpickup');
  assert.equal(add.body.pickup_location, 'VENDOR_vB');
  assert.deepEqual([add.body.pin_code, add.body.phone, add.body.name], ['629001', '9000000002', 'Bala']);
  assert.equal(db.store.get('vendors').get('vB').shiprocketPickupLocation, 'VENDOR_vB');

  await call(vendorProfile, 'PUT', { body: { pickupAddress: { ...WAREHOUSE, line1: '22 Market Road' } } });
  assert.equal(db.store.get('vendors').get('vB').shiprocketPickupLocation, 'VENDOR_vB_2');
});

test('Shiprocket rejecting the address keeps the profile saved, reports why, and keeps the old working pickup', async () => {
  signInAs('a@vendor.test');
  sr.rejectPickup = 'Pincode is not serviceable';
  const res = await call(vendorProfile, 'PUT', { body: { pickupAddress: { ...WAREHOUSE, line1: '99 New Bazaar Road' } } });
  assert.equal(res.status, 200);
  assert.equal(res.json.pickupSync.status, 'error');
  assert.match(res.json.pickupSync.message, /courier|pincode/i);
  const v = db.store.get('vendors').get('vA');
  assert.equal(v.pickupAddress.line1, '99 New Bazaar Road', 'profile saved anyway');
  assert.equal(v.shiprocketPickupLocation, 'VENDOR_vA', 'old pickup still in use');
});

/* ── Split dispatch ── */

test('admin ship: mixed order → one Shiprocket order per warehouse, each with its own AWB; order shipped', async () => {
  signInAs('owner@tulsi.test');
  const res = await call(adminShip, 'POST', { body: { orderId: 'mix' } });
  assert.equal(res.status, 200, res.json.message);
  const creates = sr.calls.filter((c) => c.path === '/orders/create/adhoc');
  assert.deepEqual(creates.map((c) => [c.body.order_id, c.body.pickup_location, c.body.sub_total]), [['TBJ9-1', 'Primary', 2500], ['TBJ9-2', 'VENDOR_vA', 1000]]);
  assert.deepEqual(creates[1].body.order_items.map((i) => i.name), ['Jhumka'], 'vendor A’s parcel holds only their piece');
  const o = db.store.get('orders').get('mix');
  assert.deepEqual(Object.keys(o.shipments).sort(), ['tulsi', 'vA']);
  assert.ok(o.shipments.tulsi.awb && o.shipments.vA.awb && o.shipments.tulsi.awb !== o.shipments.vA.awb);
  assert.equal(o.status, 'shipped');
  assert.deepEqual(o.vendorShippingActual, { vA: 60, vB: 64 }, 'vendor A pays their parcel; B shares Tulsi’s parcel by value (80 × 2000/2500)');
  assert.equal(sr.calls.filter((c) => c.path === '/courier/generate/pickup').length, 2, 'pickups requested');

  // re-running books nothing twice
  await call(adminShip, 'POST', { body: { orderId: 'mix' } });
  assert.equal(sr.calls.filter((c) => c.path === '/orders/create/adhoc').length, 2);
});

test('no courier for the route: parcel kept for retry with a readable reason, order not shipped', async () => {
  signInAs('owner@tulsi.test');
  sr.noCourier = true;
  const res = await call(adminShip, 'POST', { body: { orderId: 'solo' } });
  assert.equal(res.status, 400);
  assert.match(res.json.message, /No courier delivers this route/);
  const o = db.store.get('orders').get('solo');
  assert.equal(o.status, 'confirmed');
  assert.ok(o.shipments.vA.shipmentId, 'Shiprocket shipment kept');
  sr.noCourier = false;
  await call(adminShip, 'POST', { body: { orderId: 'solo' } });
  assert.equal(sr.calls.filter((c) => c.path === '/orders/create/adhoc').length, 1, 'retry reuses the shipment');
  assert.equal(db.store.get('orders').get('solo').status, 'shipped');
});

test('vendor Packed → their parcel is booked from their warehouse automatically', async () => {
  signInAs('a@vendor.test');
  db.store.get('orders').get('solo').payment = { method: 'cod', status: 'pending' };
  const res = await call(vendorOrder, 'PATCH', { params: { id: 'solo' }, body: { status: 'processing' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.dispatch.results[0].ok, true);
  assert.equal(sr.calls.find((c) => c.path === '/orders/create/adhoc').body.pickup_location, 'VENDOR_vA');
  assert.equal(res.json.data.parcels[0].booked, true);
});

test('labels and tracking: each vendor gets only their own parcel; admin gets all', async () => {
  signInAs('owner@tulsi.test');
  await call(adminShip, 'POST', { body: { orderId: 'mix' } });
  const all = await call(adminLabel, 'POST', { body: { orderId: 'mix' } });
  assert.equal(all.json.data.parcels, 2);

  signInAs('a@vendor.test');
  const mine = await call(vendorLabel, 'POST', { params: { id: 'mix' } });
  assert.equal(mine.status, 200);
  assert.equal(sr.calls.at(-1).body.shipment_id.length, 1, 'only vendor A’s shipment');
  assert.equal(sr.calls.at(-1).body.shipment_id[0], 'SH-TBJ9-2');
  const track = await call(vendorTracking, 'GET', { params: { id: 'mix' } });
  assert.equal(track.json.data.status, 'In Transit');

  signInAs('b@vendor.test'); // B's pieces went in Tulsi's parcel — no label of their own
  assert.equal((await call(vendorLabel, 'POST', { params: { id: 'mix' } })).status, 400);
  assert.equal((await call(vendorLabel, 'POST', { params: { id: 'solo' } })).status, 403, 'not in this order at all');
});
