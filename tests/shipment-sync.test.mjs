/* ─────────────────────────────────────────────
   Courier status sync — Shiprocket webhook + daily catch-up, against the
   real handlers (Firestore, email, WhatsApp and Shiprocket are fakes).
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { stageOf, decideOrderStatus, parseShiprocketTime } from '../src/lib/shipmentStatus.js';

process.env.SHIPROCKET_WEBHOOK_TOKEN = 'hook-secret';
process.env.CRON_SECRET = 'cron-secret';
process.env.SHIPROCKET_EMAIL = 'ops@tulsi.test';
process.env.SHIPROCKET_PASSWORD = 'pw';

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
const customerMails = [];

mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db, getBucket: () => null,
    FieldValue: { increment: (n) => ({ __inc: n }), serverTimestamp: () => new Date().toISOString() },
    Timestamp: class {},
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    toPublicProduct: (p) => p, paginate: async () => ({}), newId: () => `id${Date.now()}`,
  },
});
const noop = async () => {};
mock.module(src('lib/email.js'), { namedExports: { ...Object.fromEntries(['sendOTPEmail', 'sendOrderConfirmation', 'sendOrderNotificationToAdmin', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'sendVendorOrderNotification', 'isConfigured'].map((n) => [n, noop])), esc: (v) => String(v ?? ''), sendStatusUpdateEmail: async (o, s) => { customerMails.push([o.orderNumber, s]); } } });
mock.module(src('lib/whatsapp.js'), { namedExports: Object.fromEntries(['sendOrderWhatsAppToAdmin', 'sendOrderWhatsAppToCustomer', 'sendStatusWhatsApp', 'sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])) });

/* Shiprocket tracking API (for the daily catch-up) */
let trackingReply = null;
globalThis.fetch = async (url) => {
  const p = new URL(url).pathname;
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (p.endsWith('/auth/login')) return json({ token: 't' });
  if (p.includes('/courier/track/awb/')) return json(trackingReply);
  return json({});
};

const hook = await import(src('app/api/webhooks/courier-status/route.js'));
const cron = await import(src('app/api/cron/shipment-sync/route.js'));

const post = (body, token = 'hook-secret') => hook.POST(new Request('http://tulsi.test/api/webhooks/courier-status', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token && { 'x-api-key': token }) }, body: JSON.stringify(body),
})).then(async (r) => ({ status: r.status, json: await r.json() }));

const parcel = (key, awb, extra = {}) => ({ key, awb, courierName: 'Delhivery', shipmentId: `SH-${awb}`, ...extra });

beforeEach(() => {
  customerMails.length = 0;
  trackingReply = null;
  db = fakeFirestore({
    products: { p1: { stock: 3 }, p2: { stock: 3 } },
    settings: { site: {} },
    orders: {
      solo: {
        orderNumber: 'TBJ1', status: 'processing', stockDeducted: true, total: 1049, createdAt: '2026-09-20T10:00:00Z',
        payment: { method: 'cod', status: 'pending' }, vendorIds: ['tulsi'],
        items: [{ product: 'p1', name: 'Ring', price: 1000, quantity: 1, vendorId: 'tulsi' }],
        awbs: ['AWB1'], shipments: { tulsi: parcel('tulsi', 'AWB1') },
      },
      split: {
        orderNumber: 'TBJ2', status: 'shipped', stockDeducted: true, total: 3000, createdAt: '2026-09-20T10:00:00Z',
        payment: { method: 'razorpay', status: 'paid' }, vendorIds: ['tulsi', 'vA'],
        items: [{ product: 'p1', name: 'Ring', price: 1000, quantity: 1, vendorId: 'tulsi' }, { product: 'p2', name: 'Set', price: 2000, quantity: 1, vendorId: 'vA', supplyCost: 500 }],
        awbs: ['AWB2', 'AWB3'], shipments: { tulsi: parcel('tulsi', 'AWB2'), vA: parcel('vA', 'AWB3', { vendorId: 'vA' }) },
      },
      legacy: {
        orderNumber: 'TBJ3', status: 'shipped', stockDeducted: true, total: 500, createdAt: '2026-09-20T10:00:00Z',
        payment: { method: 'razorpay', status: 'paid' }, vendorIds: ['tulsi'], trackingNumber: 'OLD9', shiprocketOrderId: 'SR9',
        items: [{ product: 'p1', name: 'Ring', price: 500, quantity: 1, vendorId: 'tulsi' }],
      },
    },
  });
});

/* ── Pure rules ── */

test('courier texts and ids map to stages', () => {
  assert.equal(stageOf({ status: 'DELIVERED' }), 'delivered');
  assert.equal(stageOf({ status: 'Out For Delivery' }), 'out_for_delivery');
  assert.equal(stageOf({ status: 'RTO IN TRANSIT' }), 'rto_initiated');
  assert.equal(stageOf({ status: 'RTO DELIVERED' }), 'rto_delivered');
  assert.equal(stageOf({ status: 'UNDELIVERED' }), 'undelivered');
  assert.equal(stageOf({ status: 'PICKED UP' }), 'in_transit');
  assert.equal(stageOf({ status: 'PICKUP SCHEDULED' }), 'booked');
  assert.equal(stageOf({ statusId: 7 }), 'delivered');
  assert.equal(parseShiprocketTime('23 09 2026 11:43:52'), '2026-09-23T06:13:52.000Z', 'IST → UTC');
});

test('order decision needs every parcel: one of two delivered is not a delivered order', () => {
  const o = { status: 'shipped', payment: { status: 'paid' } };
  assert.equal(decideOrderStatus(o, ['delivered', 'in_transit']).status, null);
  assert.equal(decideOrderStatus(o, ['delivered', 'delivered']).status, 'delivered');
  assert.deepEqual(decideOrderStatus(o, ['rto_delivered']), { status: 'cancelled', issue: 'returned_to_seller', refundDue: true });
  assert.equal(decideOrderStatus(o, ['rto_delivered', 'delivered']).issue, 'rto_delivered', 'partial return → flagged, not cancelled');
  assert.equal(decideOrderStatus({ status: 'processing' }, ['in_transit']).status, 'shipped');
});

/* ── Webhook ── */

test('webhook refuses requests without the right token — no one can fake a delivery', async () => {
  assert.equal((await post({ awb: 'AWB1', current_status: 'DELIVERED' }, null)).status, 401);
  assert.equal((await post({ awb: 'AWB1', current_status: 'DELIVERED' }, 'guess')).status, 401);
  assert.equal(db.store.get('orders').get('solo').status, 'processing');
});

test('picked up → Shipped; delivered → Delivered, COD counted as collected, customer told', async () => {
  await post({ awb: 'AWB1', current_status: 'PICKED UP', current_timestamp: '26 09 2026 10:00:00' });
  assert.equal(db.store.get('orders').get('solo').status, 'shipped');
  const r = await post({ awb: 'AWB1', current_status: 'DELIVERED', current_timestamp: '27 09 2026 15:30:00', scans: [{ date: '2026-09-27 15:30', activity: 'Delivered', location: 'Madurai' }] });
  assert.equal(r.status, 200);
  const o = db.store.get('orders').get('solo');
  assert.equal(o.status, 'delivered');
  assert.equal(o.payment.status, 'paid');
  assert.equal(o.shipments.tulsi.tracking.stage, 'delivered');
  assert.equal(o.shipments.tulsi.scans[0].location, 'Madurai');
  assert.deepEqual(customerMails.map(([, s]) => s), ['shipped', 'delivered']);
});

test('split order: delivered only when both parcels are; a late, older update is ignored', async () => {
  await post({ awb: 'AWB2', current_status: 'DELIVERED', current_timestamp: '27 09 2026 10:00:00' });
  assert.equal(db.store.get('orders').get('split').status, 'shipped', 'other parcel still on its way');
  await post({ awb: 'AWB3', current_status: 'DELIVERED', current_timestamp: '27 09 2026 12:00:00' });
  assert.equal(db.store.get('orders').get('split').status, 'delivered');
  const stale = await post({ awb: 'AWB3', current_status: 'IN TRANSIT', current_timestamp: '26 09 2026 09:00:00' });
  assert.equal(stale.json.reason, 'stale');
  assert.equal(db.store.get('orders').get('split').shipments.vA.tracking.stage, 'delivered');
});

test('RTO: attempt failed is flagged; returned to seller cancels the order, restocks and flags the refund', async () => {
  await post({ awb: 'AWB9', current_status: 'DELIVERED' }).then((r) => assert.equal(r.json.reason, 'unknown awb'));
  const legacyRes = await post({ awb: 'OLD9', current_status: 'UNDELIVERED', current_timestamp: '27 09 2026 10:00:00' });
  assert.equal(legacyRes.json.issue, 'undelivered', 'older orders found by tracking number');
  assert.equal(db.store.get('orders').get('legacy').deliveryIssue, 'undelivered');
  await post({ awb: 'OLD9', current_status: 'RTO DELIVERED', current_timestamp: '30 09 2026 10:00:00' });
  const o = db.store.get('orders').get('legacy');
  assert.equal(o.status, 'cancelled');
  assert.equal(o.refundDue, true, 'prepaid — the customer must be refunded');
  assert.equal(o.deliveryIssue, 'returned_to_seller');
  assert.deepEqual(db.store.get('products').get('p1').stock, { __inc: 1 }, 'stock put back');
});

/* ── Daily catch-up ── */

test('daily sync: needs the cron secret, then applies Shiprocket’s latest status for parcels still moving', async () => {
  const call = (auth) => cron.GET(new Request('http://tulsi.test/api/cron/shipment-sync', { headers: auth ? { authorization: auth } : {} })).then(async (r) => ({ status: r.status, json: await r.json() }));
  assert.equal((await call(null)).status, 401);
  assert.equal((await call('Bearer nope')).status, 401);
  trackingReply = { tracking_data: { shipment_status: 7, shipment_track: [{ current_status: 'Delivered' }], shipment_track_activities: [{ date: '2026-09-28 11:00:00', activity: 'Delivered', location: 'Chennai' }] } };
  const res = await call('Bearer cron-secret');
  assert.equal(res.status, 200);
  assert.ok(res.json.checked >= 1);
  assert.equal(db.store.get('orders').get('solo').status, 'delivered');
});
