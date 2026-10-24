/* ─────────────────────────────────────────────
   CRO round 4 — server side, through the REAL route handlers:

     A   POST /api/orders asks Razorpay before it takes an abandoned
         attempt over: paid → that attempt is confirmed, 409
         EARLIER_ORDER_PAID; in progress / paid but unreadable → 409
         EARLIER_PAYMENT_PENDING, nothing written; never paid (or Razorpay
         not configured) → taken over as before; Razorpay unreachable or
         too slow → taken over as before too (tests/cro-round4-fixes.test.mjs)
     B   POST /api/payments/verify → 409 PAID_AFTER_CANCEL for money that
         arrived on a replaced / cancelled order
     C   an online order's "order confirmed" email + WhatsApp go when it is
         paid (settlePaidOrder), once — never at creation, never for a
         payment being refunded; COD unchanged
     D   POST /api/orders loyaltyDiscount (what the page showed) → 409
         LOYALTY_CHANGED with no writes when it isn't what the order gets
     S6  the daily clean-up: 'refunded' payments are dead, the scan pages
         through every pending online order (oldest first), 'remaining' is
         real, and a paid one is confirmed (a missed webhook)

   The guiding rules: the amount on the Place-order button is the amount
   charged; a paid order is never cancelled or taken over; no customer
   messages for internal bookkeeping.

   Only the edges are fakes: the NextAuth session, Firestore (in-memory,
   every transaction held to "all reads before any write"; dotted where()
   paths mirrored the way real Firestore resolves them), email and WhatsApp
   (recorded) and the Razorpay SDK.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fakeFirestore, INC } from './helpers/fakeFirestore.mjs';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.CRON_SECRET = 'cron-test-secret';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
delete process.env.SHIPROCKET_EMAIL;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (user) => { session = user ? { user } : null; };
const getServerSession = async () => session;

/* Razorpay SDK stand-in with its own ledger of orders and payments.
   down: unreachable; hang: never answers (the caller's timeout decides);
   onFetch: runs as Razorpay is asked about an order. */
const rzp = { orders: new Map(), payments: new Map(), creates: 0, fetches: 0, down: false, hang: null, noPaymentsApi: false, onFetch: null };
class FakeRazorpay {
  constructor() {
    this.orders = {
      create: async (o) => {
        rzp.creates += 1;
        const order = { id: `order_${rzp.creates}`, entity: 'order', amount: o.amount, currency: o.currency || 'INR', receipt: o.receipt, status: 'created' };
        rzp.orders.set(order.id, order);
        return { ...order };
      },
      fetch: async (id) => {
        rzp.fetches += 1;
        if (rzp.hang) return rzp.hang();
        if (rzp.down) throw new Error('ETIMEDOUT');
        rzp.onFetch?.(id);
        if (!rzp.orders.has(id)) throw Object.assign(new Error('not found'), { error: { description: 'The id provided does not exist' } });
        return { ...rzp.orders.get(id) };
      },
      fetchPayments: async (id) => {
        if (rzp.noPaymentsApi) throw new Error('unavailable');
        return { items: [...rzp.payments.values()].filter((p) => p.order_id === id).map((p) => ({ ...p })) };
      },
    };
    this.payments = {
      fetch: async (id) => ({ ...rzp.payments.get(id) }),
      capture: async (id) => ({ ...rzp.payments.get(id), status: 'captured' }),
    };
  }
}
/* A payment on the Razorpay window: 'captured' marks the Razorpay order
   paid; any other status ('authorized', 'created', 'failed', 'refunded')
   leaves it 'attempted'. Returns the signed ids the window hands back. */
function payOnRazorpay(rzpOrderId, status = 'captured', extra = {}) {
  const o = rzp.orders.get(rzpOrderId);
  if (status === 'captured') o.status = 'paid';
  else if (o.status === 'created') o.status = 'attempted';
  const pay = { id: `pay_${rzp.payments.size + 1}`, order_id: o.id, status, amount: o.amount, currency: 'INR', ...extra };
  rzp.payments.set(pay.id, pay);
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${o.id}|${pay.id}`).digest('hex');
  return { razorpayOrderId: o.id, razorpayPaymentId: pay.id, razorpaySignature: signature };
}

/* Every message, recorded: [kind, orderNumber, status?]. */
const sent = [];
const record = (kind) => async (o, status) => { sent.push([kind, o?.orderNumber, status]); };
const noop = async () => {};

mock.module('razorpay', { defaultExport: FakeRazorpay });
mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db, getBucket: () => null,
    FieldValue: { increment: (n) => ({ [INC]: n }), serverTimestamp: () => new Date().toISOString() },
    Timestamp: class {},
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    toPublicProduct: (p) => p, paginate: async () => ({}), newId: () => `id${Date.now()}`,
  },
});
mock.module(src('lib/email.js'), {
  namedExports: {
    ...Object.fromEntries(['sendOTPEmail', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'sendVendorOrderNotification', 'isConfigured'].map((n) => [n, noop])),
    sendOrderConfirmation: record('email:placed'),
    sendOrderNotificationToAdmin: record('admin:email'),
    sendStatusUpdateEmail: record('email:status'),
    esc: (v) => String(v ?? ''),
  },
});
mock.module(src('lib/whatsapp.js'), {
  namedExports: {
    ...Object.fromEntries(['sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])),
    sendOrderWhatsAppToCustomer: record('wa:placed'),
    sendOrderWhatsAppToAdmin: record('admin:wa'),
    sendStatusWhatsApp: record('wa:status'),
  },
});

const route = (p) => import(src(`app/api/${p}/route.js`));
const [orders, orderById, createOrder, verify, webhook, loyalty, expireCron] = await Promise.all([
  route('orders'), route('orders/[id]'), route('payments/create-order'), route('payments/verify'),
  route('payments/webhook'), route('loyalty'), route('cron/expire-unpaid-orders'),
]);
const { settlePaidOrder } = await import(src('lib/settlePayment.js'));

/* Real Firestore resolves where('payment.method' / 'payment.razorpayOrderId', …)
   on the nested field; the fake compares top-level keys, so they are
   mirrored before every request. */
function syncDotted() {
  for (const o of db.store.get('orders')?.values() || []) {
    if (o.payment?.method !== undefined) o['payment.method'] = o.payment.method;
    if (o.payment?.razorpayOrderId !== undefined) o['payment.razorpayOrderId'] = o.payment.razorpayOrderId;
  }
}

let ipN = 0;
const freshIp = () => { ipN += 1; return `10.16.${Math.floor(ipN / 250)}.${(ipN % 250) + 1}`; };
async function call(mod, method, body, params = {}, headers = {}) {
  syncDotted();
  const res = await mod[method](new Request('http://tulsi.test/api', {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp(), ...headers },
    ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
}
const post = (body) => call(orders, 'POST', body);
const payFor = (orderId) => call(createOrder, 'POST', { orderId });
const verifyPayment = (ids, orderId) => call(verify, 'POST', { ...ids, orderId });
const readParked = async () => (await call(loyalty, 'GET')).json.data.parkedDiscount;
const runCron = () => call(expireCron, 'GET', undefined, {}, { authorization: `Bearer ${process.env.CRON_SECRET}` });
/* Razorpay's server calls the webhook: that payment was captured. */
async function webhookCaptured(paymentId) {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { ...rzp.payments.get(paymentId), status: 'captured' } } } });
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  return call(webhook, 'POST', body, {}, { 'x-razorpay-signature': signature });
}
const quietly = async (fn) => {
  const orig = [console.error, console.warn];
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { [console.error, console.warn] = orig; }
};

const NEW = { id: 'u-new', email: 'new@x.test', emailVerified: true };
const ADDRESS = { fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' };

/* What checkout posts. ₹1,500 piece, shipping ₹99 below ₹2,000, no COD fee above ₹500. */
const order = (extra = {}) => ({ items: [{ product: 'p1', quantity: 1 }], shippingAddress: ADDRESS, payment: { method: 'cod' }, ...extra });
const online = (extra = {}) => order({ payment: { method: 'razorpay' }, ...extra });

const couponDoc = (id) => db.store.get('coupons').get(id);
const orderDoc = (id) => db.store.get('orders').get(id);
const userDoc = (id) => db.store.get('users').get(id);
const orderIds = () => [...db.store.get('orders').keys()].sort();
const stock = () => db.store.get('products').get('p1').stock;
const customerMessages = () => sent.filter(([k]) => k === 'email:placed' || k === 'wa:placed').map(([k, n]) => [k, n]);
const confirmedTo = (orderNumber) => [['email:placed', orderNumber], ['wa:placed', orderNumber]];
const snapshot = () => syncDotted() || JSON.stringify([...db.store.entries()].filter(([c, m]) => c !== 'rateLimits' && m.size > 0)
  .map(([c, m]) => [c, [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1))]));

/* Real Firestore refuses a read after a write inside a transaction; the
   in-memory fake doesn't, so every transaction here is held to that rule. */
function strictTransactions(fake) {
  const run = fake.runTransaction.bind(fake);
  fake.runTransaction = (fn) => run((tx) => {
    let wrote = false;
    const write = (op) => (...args) => { wrote = true; return tx[op](...args); };
    return fn({
      get: (target) => {
        if (wrote) throw new Error('Firestore transactions require all reads to be executed before all writes.');
        return tx.get(target);
      },
      set: write('set'), update: write('update'), delete: write('delete'),
    });
  });
  return fake;
}

const COUPON = { type: 'percentage', maxUses: 0, usedCount: 0, usedBy: [], isActive: true, minOrderAmount: 0, maxDiscount: null, startsAt: null, expiresAt: null };
const HOUR = 3_600_000;

beforeEach(() => {
  session = null;
  sent.length = 0;
  rzp.orders.clear(); rzp.payments.clear();
  Object.assign(rzp, { creates: 0, fetches: 0, down: false, hang: null, noPaymentsApi: false, onFetch: null });
  db = strictTransactions(fakeFirestore({
    products: { p1: { name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 500, isActive: true } },
    coupons: { once: { ...COUPON, code: 'FEST100', type: 'fixed', value: 100 } },
    orders: {},
    users: { 'u-new': { email: 'new@x.test', pendingLoyaltyDiscount: 100, loyaltyPoints: 0 } },
    settings: { site: {} },
  }));
});

/* #1: online with FEST100 and ₹100 parked points; the Razorpay window was
   opened (create-order). Then the page forgot it (a reload). */
async function abandonedAttempt() {
  signInAs(NEW);
  const a = await post(online({ couponCode: 'FEST100', couponDiscount: 100 }));
  assert.equal(a.status, 201, a.json.message);
  assert.equal(a.json.data.total, 1399);
  const pay = await payFor(a.json.data.id);
  assert.equal(pay.status, 200, pay.json.message);
  sent.length = 0;
  return { id: a.json.data.id, orderNumber: a.json.data.orderNumber, rzpOrderId: pay.json.data.id };
}
/* The retry the reloaded page places: COD, the same code and points. */
const retry = (extra = {}) => post(order({ couponCode: 'FEST100', couponDiscount: 100, ...extra }));

/* ══ A: the take-over asks Razorpay first ══ */

describe('A — POST /api/orders asks Razorpay before taking an abandoned attempt over', () => {
  test('paid on Razorpay (we never heard): #1 is confirmed as usual, 409 EARLIER_ORDER_PAID — nothing else created or cancelled', async () => {
    const first = await abandonedAttempt();
    const { razorpayPaymentId } = payOnRazorpay(first.rzpOrderId); // a late UPI approval; the webhook hasn't come
    const coupons = JSON.stringify([...db.store.get('coupons')]);
    const ids = orderIds();

    const r = await retry();
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { success: false, code: 'EARLIER_ORDER_PAID', orderId: first.id, message: 'Your earlier payment went through — we have confirmed that order.' });

    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.payment.status, A.payment.razorpayPaymentId, A.stockDeducted], ['confirmed', 'paid', razorpayPaymentId, true]);
    assert.equal(stock(), 499, 'its stock, once');
    assert.equal(A.pointsAwarded, true, 'points as for any paid order');
    for (const f of ['cancelReason', 'replacedBy', 'couponMovedTo', 'loyaltyMovedTo', 'loyaltyRestored', 'couponReleased', 'paidAfterCancel', 'refundDue']) assert.equal(A[f], undefined, f);
    assert.deepEqual(orderIds(), ids, 'no retry order');
    assert.equal(JSON.stringify([...db.store.get('coupons')]), coupons, 'FEST100 untouched — #1 keeps its use');
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0, '#1 keeps its points discount');
    assert.deepEqual(customerMessages(), confirmedTo(first.orderNumber), '"order confirmed" for #1, once');

    /* The webhook arrives after all: nothing more. */
    const before = snapshot();
    assert.equal((await webhookCaptured(razorpayPaymentId)).status, 200);
    assert.equal(snapshot(), before);
    assert.deepEqual(customerMessages(), confirmedTo(first.orderNumber));
  });

  for (const status of ['authorized', 'created']) {
    test(`a payment ${status} on Razorpay (still in progress) → 409 EARLIER_PAYMENT_PENDING, nothing written`, async () => {
      const first = await abandonedAttempt();
      payOnRazorpay(first.rzpOrderId, 'failed');
      payOnRazorpay(first.rzpOrderId, status);
      const before = snapshot();
      const r = await retry();
      assert.equal(r.status, 409);
      assert.deepEqual(r.json, {
        success: false, code: 'EARLIER_PAYMENT_PENDING', orderId: first.id,
        message: 'Your earlier payment is still being processed. Please wait a few minutes and check My Orders before paying again.',
      });
      assert.equal(snapshot(), before, 'no order, no take-over, no coupon use');
      assert.equal(orderDoc(first.id).status, 'pending');
      assert.deepEqual(sent, []);
    });
  }

  test('Razorpay says paid, but the payment can’t be read → 409 EARLIER_PAYMENT_PENDING (couldn’t check), nothing written', async () => {
    const first = await abandonedAttempt();
    const before = snapshot();
    /* Razorpay says paid, but which payment can't be read: not settled from
       here (the webhook will), and not taken over. (Razorpay unreachable is
       not this: that attempt is taken over as before — see
       tests/cro-round4-fixes.test.mjs, R-A.) */
    payOnRazorpay(first.rzpOrderId);
    rzp.noPaymentsApi = true;
    const unread = await quietly(retry);
    assert.equal(unread.status, 409);
    assert.deepEqual(unread.json, { success: false, code: 'EARLIER_PAYMENT_PENDING', orderId: first.id, message: "We couldn't check your earlier payment just now. Please try again in a minute." });
    assert.equal(snapshot(), before);
    assert.deepEqual(sent, []);
  });

  test('Razorpay too slow: given up after ~5 s → the attempt is taken over as before (R-A) — the order is placed, never held up by the outage', async () => {
    const first = await abandonedAttempt();
    let asked;
    const askedNow = new Promise((resolve) => { asked = resolve; });
    rzp.hang = () => {
      /* Razorpay never answers; the clock is moved on instead of waited for. */
      mock.timers.enable({ apis: ['setTimeout'] });
      asked();
      return new Promise(() => {});
    };
    try {
      const pending = quietly(retry);
      await askedNow;
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(4000);
      let done = false;
      pending.then(() => { done = true; });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(done, false, 'still waiting at 4 s');
      mock.timers.tick(1100);
      for (let i = 0; i < 50 && !done; i += 1) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(done, true, 'answered once 5 s have passed');
      const r = await pending;
      assert.equal(r.status, 201, r.json.message);
      assert.equal(r.json.data.total, 1399, '₹1,500 − ₹100 − ₹100 + ₹99');
      const A = orderDoc(first.id);
      assert.deepEqual([A.status, A.cancelReason, A.replacedBy], ['cancelled', 'replaced', r.json.data.id]);
    } finally {
      mock.timers.reset();
    }
  });

  test('never paid — every payment failed or refunded — → taken over exactly as before', async () => {
    const first = await abandonedAttempt();
    payOnRazorpay(first.rzpOrderId, 'failed');
    payOnRazorpay(first.rzpOrderId, 'refunded'); // an authorization Razorpay released
    const fetches = rzp.fetches;
    const r = await retry();
    assert.equal(r.status, 201, r.json.message);
    assert.ok(rzp.fetches > fetches, 'Razorpay was asked');
    assert.equal(r.json.data.total, 1399, '₹1,500 − ₹100 − ₹100 + ₹99');
    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.cancelReason, A.replacedBy, A.couponMovedTo, A.loyaltyMovedTo], ['cancelled', 'replaced', r.json.data.id, r.json.data.id, r.json.data.id]);
    assert.deepEqual([couponDoc('once').usedCount, couponDoc('once').usedBy], [1, ['u:u-new']]);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
    assert.deepEqual(customerMessages(), confirmedTo(r.json.data.orderNumber), 'nothing for #1');
  });

  test('never paid — no payment at all (the window was closed) → taken over', async () => {
    const first = await abandonedAttempt();
    const fetches = rzp.fetches;
    const r = await retry();
    assert.equal(r.status, 201, r.json.message);
    assert.ok(rzp.fetches > fetches, 'Razorpay was asked');
    assert.equal(orderDoc(first.id).cancelReason, 'replaced');
  });

  test('no Razorpay order (the window never opened) → not asked, taken over', async () => {
    signInAs(NEW);
    const a = await post(online({ couponCode: 'FEST100', couponDiscount: 100 }));
    const r = await retry();
    assert.equal(r.status, 201);
    assert.equal(rzp.fetches, 0);
    assert.equal(orderDoc(a.json.data.id).cancelReason, 'replaced');
  });

  test('Razorpay not configured → not asked, taken over (as the daily clean-up)', async () => {
    const first = await abandonedAttempt();
    payOnRazorpay(first.rzpOrderId, 'authorized');
    const saved = [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET];
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
      const fetches = rzp.fetches;
      const r = await retry();
      assert.equal(r.status, 201, r.json.message);
      assert.equal(rzp.fetches, fetches);
      assert.equal(orderDoc(first.id).cancelReason, 'replaced');
    } finally { [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET] = saved; }
  });

  test('paid, but #1 was cancelled meanwhile (settles as paid-after-cancel) → no EARLIER_ORDER_PAID; the order goes ahead', async () => {
    const first = await abandonedAttempt();
    const { razorpayPaymentId } = payOnRazorpay(first.rzpOrderId);
    /* The store cancels #1 just as Razorpay is asked (its points and code
       go back to the customer, as any cancel). */
    rzp.onFetch = () => {
      rzp.onFetch = null;
      Object.assign(orderDoc(first.id), { status: 'cancelled', loyaltyRestored: true, couponReleased: true });
      Object.assign(couponDoc('once'), { usedCount: 0, usedBy: [] });
      userDoc('u-new').pendingLoyaltyDiscount = 100;
    };
    const r = await quietly(retry);
    assert.equal(r.status, 201, r.json.message);
    assert.equal(r.json.data.total, 1399);
    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.payment.status, A.payment.razorpayPaymentId, A.paidAfterCancel, A.refundDue], ['cancelled', 'paid', razorpayPaymentId, true, true]);
    assert.equal(stock(), 500, 'no stock for the refunded payment');
    assert.deepEqual(customerMessages(), confirmedTo(r.json.data.orderNumber), 'only the COD order is confirmed');
  });

  test('a paid attempt the order would only take points from is asked about too', async () => {
    signInAs(NEW);
    const a = await post(online()); // ₹100 points, no code
    const pay = await payFor(a.json.data.id);
    payOnRazorpay(pay.json.data.id);
    const r = await post(order());
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'EARLIER_ORDER_PAID');
    assert.equal(orderDoc(a.json.data.id).status, 'confirmed');
    assert.equal(orderDoc(a.json.data.id).loyaltyDiscount, 100, 'keeps its points discount');
  });
});

/* ══ B: verify says when a payment was for a replaced / cancelled order ══ */

describe('B — POST /api/payments/verify → 409 PAID_AFTER_CANCEL', () => {
  const PAID_AFTER_CANCEL = {
    success: false,
    code: 'PAID_AFTER_CANCEL',
    message: 'This payment was for an order that had already been replaced or cancelled, so it was not placed. We will refund it to your original payment method.',
  };

  test('the replaced attempt paid late → 409 PAID_AFTER_CANCEL; recorded for a refund; a repeat says the same', async () => {
    const first = await abandonedAttempt();
    const r = await retry();
    assert.equal(r.status, 201);
    signInAs(NEW);
    const ids = payOnRazorpay(first.rzpOrderId);
    const v = await quietly(() => verifyPayment(ids, first.id));
    assert.equal(v.status, 409);
    assert.deepEqual(v.json, PAID_AFTER_CANCEL);
    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.payment.status, A.paidAfterCancel, A.refundDue], ['cancelled', 'paid', true, true]);

    const again = await quietly(() => verifyPayment(ids, first.id));
    assert.deepEqual([again.status, again.json], [409, PAID_AFTER_CANCEL], 'never "verified" on a retry');
  });

  test('the webhook recorded it first → verify still 409 PAID_AFTER_CANCEL', async () => {
    const first = await abandonedAttempt();
    await retry();
    const ids = payOnRazorpay(first.rzpOrderId);
    assert.equal((await quietly(() => webhookCaptured(ids.razorpayPaymentId))).status, 200, 'Razorpay is always acked');
    assert.equal(orderDoc(first.id).refundDue, true);
    signInAs(NEW);
    const v = await verifyPayment(ids, first.id);
    assert.deepEqual([v.status, v.json], [409, PAID_AFTER_CANCEL]);
  });

  test('a cancelled order paid late → the same', async () => {
    signInAs(NEW);
    const o = await post(online());
    const pay = await payFor(o.json.data.id);
    Object.assign(orderDoc(o.json.data.id), { status: 'cancelled' });
    const v = await quietly(() => verifyPayment(payOnRazorpay(pay.json.data.id), o.json.data.id));
    assert.deepEqual([v.status, v.json.code], [409, 'PAID_AFTER_CANCEL']);
  });

  test('other answers unchanged: a paid order → 200 verified, again → 200 already verified', async () => {
    signInAs(NEW);
    const o = await post(online());
    const pay = await payFor(o.json.data.id);
    const ids = payOnRazorpay(pay.json.data.id);
    const v = await verifyPayment(ids, o.json.data.id);
    assert.deepEqual([v.status, v.json], [200, { success: true, message: 'Payment verified successfully' }]);
    const again = await verifyPayment(ids, o.json.data.id);
    assert.deepEqual([again.status, again.json], [200, { success: true, message: 'Payment already verified' }]);
  });
});

/* ══ C: an online order is confirmed to the customer when it is paid ══ */

describe('C — "order confirmed" email + WhatsApp for an online order: when paid, once', () => {
  test('none at Razorpay creation (the store still hears); exactly one set on verify, none on the webhook repeat', async () => {
    signInAs(NEW);
    const o = await post(online());
    assert.equal(o.status, 201);
    const n = o.json.data.orderNumber;
    assert.deepEqual(customerMessages(), [], 'an unpaid attempt is not an order yet');
    assert.deepEqual(sent.map(([k]) => k).sort(), ['admin:email', 'admin:wa'], 'admin notices unchanged');

    const pay = await payFor(o.json.data.id);
    const ids = payOnRazorpay(pay.json.data.id);
    assert.equal((await verifyPayment(ids, o.json.data.id)).status, 200);
    assert.deepEqual(customerMessages(), confirmedTo(n));
    assert.equal(orderDoc(o.json.data.id).status, 'confirmed');

    assert.equal((await webhookCaptured(ids.razorpayPaymentId)).status, 200);
    await settlePaidOrder(db, db.collection('orders').doc(o.json.data.id), { razorpayPaymentId: ids.razorpayPaymentId });
    assert.equal((await verifyPayment(ids, o.json.data.id)).status, 200);
    assert.deepEqual(customerMessages(), confirmedTo(n), 'never again');
  });

  test('the webhook first (the tab closed), then verify → one set', async () => {
    signInAs(NEW);
    const o = await post(online());
    const pay = await payFor(o.json.data.id);
    const ids = payOnRazorpay(pay.json.data.id);
    assert.equal((await webhookCaptured(ids.razorpayPaymentId)).status, 200);
    assert.deepEqual(customerMessages(), confirmedTo(o.json.data.orderNumber));
    assert.equal((await verifyPayment(ids, o.json.data.id)).status, 200);
    assert.deepEqual(customerMessages(), confirmedTo(o.json.data.orderNumber));
  });

  test('paid after a cancel / replace → no "order confirmed" at all', async () => {
    const first = await abandonedAttempt();
    const r = await retry();
    sent.length = 0;
    signInAs(NEW);
    const ids = payOnRazorpay(first.rzpOrderId);
    await quietly(() => verifyPayment(ids, first.id));
    await quietly(() => webhookCaptured(ids.razorpayPaymentId));
    assert.deepEqual(sent, []);
    assert.equal(orderDoc(r.json.data.id).status, 'pending', 'the COD retry is untouched');
  });

  test('COD unchanged: confirmed to the customer at creation, with the store’s notices', async () => {
    signInAs(NEW);
    const o = await post(order());
    assert.equal(o.status, 201);
    assert.deepEqual(customerMessages(), confirmedTo(o.json.data.orderNumber));
    assert.deepEqual(sent.map(([k]) => k).sort(), ['admin:email', 'admin:wa', 'email:placed', 'wa:placed']);
  });
  /* Checkout settling an earlier attempt (A) and the daily clean-up
     confirming a missed webhook (S6) are checked to tell the customer once
     in their own tests. */
});

/* ══ D: the points discount the page showed ══ */

describe('D — POST /api/orders loyaltyDiscount → 409 LOYALTY_CHANGED when it isn’t what the order gets', () => {
  /* ₹400 parked + ₹100 held by an abandoned attempt this order takes over;
     the order can take 20% of ₹1,500 = ₹300. */
  async function setUp() {
    const first = await abandonedAttempt();
    userDoc('u-new').pendingLoyaltyDiscount = 400; // redeemed more since
    assert.equal(await readParked(), 500, 'what GET /api/loyalty tells the page');
    return first;
  }

  test('regress D: a stale page (₹100 shown) → 409 with the right figures, nothing written', async () => {
    const first = await setUp();
    const before = snapshot();
    const r = await retry({ loyaltyDiscount: 100 });
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, {
      success: false, code: 'LOYALTY_CHANGED', loyaltyDiscount: 300, parkedDiscount: 500,
      message: 'Your points discount is now ₹300. Please check your total and place the order again.',
    });
    assert.equal(snapshot(), before, 'no order, no take-over, no coupon use');
    assert.equal(orderDoc(first.id).status, 'pending');
    assert.deepEqual(sent, []);
  });

  test('what the page showed → 201 at that price; omitted (an older page) → 201, no check', async () => {
    const first = await setUp();
    const r = await retry({ loyaltyDiscount: 300 });
    assert.equal(r.status, 201, r.json.message);
    assert.deepEqual([r.json.data.loyaltyDiscount, r.json.data.total], [300, 1500 - 100 - 300 + 99]);
    assert.equal(orderDoc(first.id).cancelReason, 'replaced');
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 200, 'the ₹200 it couldn’t take stays parked');

    const older = await post(order());
    assert.equal(older.status, 201);
    assert.equal(older.json.data.loyaltyDiscount, 200);
    assert.equal((await post(order({ loyaltyDiscount: '999' }))).status, 201, 'not a number → not checked');
  });

  test('COUPON_CHANGED and CHARGES_CHANGED come first; a guest (no points) is checked against ₹0', async () => {
    await setUp();
    const coupon = await retry({ couponDiscount: 50, loyaltyDiscount: 1 });
    assert.equal(coupon.json.code, 'COUPON_CHANGED');
    const charges = await retry({ shippingCost: 0, loyaltyDiscount: 1 });
    assert.equal(charges.json.code, 'CHARGES_CHANGED');

    signInAs(null);
    const guest = await post(order({ guestEmail: 'g@x.test', loyaltyDiscount: 50 }));
    assert.deepEqual([guest.status, guest.json.code, guest.json.loyaltyDiscount, guest.json.parkedDiscount], [409, 'LOYALTY_CHANGED', 0, 0]);
    assert.equal((await post(order({ guestEmail: 'g@x.test', loyaltyDiscount: 0 }))).status, 201);
  });

  test('the cap with a coupon: never more than the coupon leaves — the same figure the page computes', async () => {
    db.store.get('coupons').set('big', { ...COUPON, code: 'BRIDE1400', type: 'fixed', value: 1400 });
    userDoc('u-new').pendingLoyaltyDiscount = 300;
    signInAs(NEW);
    /* ₹1,500 − ₹1,400 leaves ₹100 for points (the 20% cap would allow ₹300). */
    const capped = await post(order({ couponCode: 'BRIDE1400', couponDiscount: 1400, loyaltyDiscount: 300 }));
    assert.deepEqual([capped.status, capped.json.code, capped.json.loyaltyDiscount, capped.json.parkedDiscount], [409, 'LOYALTY_CHANGED', 100, 300]);
    const r = await post(order({ couponCode: 'BRIDE1400', couponDiscount: 1400, loyaltyDiscount: 100 }));
    assert.equal(r.status, 201, r.json.message);
    assert.deepEqual([r.json.data.loyaltyDiscount, r.json.data.total], [100, 99]);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 200);
  });
});

/* ══ S6: the daily clean-up ══ */

describe('S6 — GET /api/cron/expire-unpaid-orders', () => {
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const seed = (id, o = {}) => db.store.get('orders').set(id, {
    orderNumber: `TBJ-${id}`, userId: 'u-new', status: 'pending', createdAt: ago(25 * HOUR), total: 1449,
    items: [{ product: 'p1', quantity: 1 }], payment: { method: 'razorpay', status: 'pending' }, ...o,
  });
  const withRzp = (id, payments = [], o = {}) => {
    const rzpId = `order_${id}`;
    rzp.orders.set(rzpId, { id: rzpId, amount: 144900, status: 'created' });
    seed(id, { ...o, payment: { method: 'razorpay', status: 'pending', razorpayOrderId: rzpId, amountDue: 144900 } });
    for (const p of payments) payOnRazorpay(rzpId, p);
    return rzpId;
  };

  test('regress S6: a refunded payment (an authorization Razorpay released) is dead like a failed one → expired, code and points back', async () => {
    withRzp('released', ['authorized'], { coupon: 'once', couponUserKey: 'u:u-new', loyaltyDiscount: 100 });
    Object.assign(couponDoc('once'), { usedCount: 1, usedBy: ['u:u-new'] });
    userDoc('u-new').pendingLoyaltyDiscount = 0;
    rzp.payments.get('pay_1').status = 'refunded'; // never captured: auto-refunded by Razorpay
    withRzp('mixed', ['failed', 'refunded']);
    withRzp('still', ['refunded', 'authorized']);
    const r = await quietly(runCron);
    assert.deepEqual([...r.json.expired].sort(), ['mixed', 'released']);
    assert.deepEqual(r.json.skipped, [{ id: 'still', reason: 'razorpay_attempted' }], 'a live authorization is never cancelled');
    assert.deepEqual([couponDoc('once').usedCount, couponDoc('once').usedBy], [0, []]);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 100);
    assert.deepEqual(sent, [], 'quietly');
  });

  test('regress S6: 520 newer pending orders can’t hide the stale ones; oldest first; remaining is the real count', async () => {
    /* Document-id order (Firestore's own) puts the young ones first; among
       the stale ones the higher the id, the older. */
    for (let i = 0; i < 520; i += 1) seed(`a${String(i).padStart(3, '0')}`, { createdAt: ago(HOUR) });
    for (let i = 0; i < 205; i += 1) seed(`z${String(i).padStart(3, '0')}`, { createdAt: ago(25 * HOUR + i * 60_000) });
    const r = await runCron();
    assert.equal(r.status, 200);
    assert.equal(r.json.expired.length, 200, 'at most 200 a run');
    assert.equal(r.json.remaining, 5);
    assert.equal(r.json.scanComplete, true);
    assert.ok(r.json.expired.includes('z204') && r.json.expired.includes('z005'), 'the oldest first');
    for (const id of ['z000', 'z001', 'z002', 'z003', 'z004']) assert.equal(orderDoc(id).status, 'pending', `${id} is among the newest stale — next run`);
    assert.equal(orderDoc('a000').status, 'pending', 'younger than a day: left alone');
    const next = await runCron();
    assert.deepEqual([...next.json.expired].sort(), ['z000', 'z001', 'z002', 'z003', 'z004']);
    assert.equal(next.json.remaining, 0);
  });

  test('regress S6: paid on Razorpay (a missed webhook) → confirmed through settlePaidOrder, the customer told once', async () => {
    withRzp('missed', ['failed', 'captured']);
    const r = await quietly(runCron);
    assert.deepEqual(r.json.settled, ['missed']);
    assert.deepEqual([r.json.expired, r.json.skipped], [[], []]);
    const M = orderDoc('missed');
    assert.deepEqual([M.status, M.payment.status, M.payment.razorpayPaymentId, M.stockDeducted], ['confirmed', 'paid', 'pay_2', true]);
    assert.equal(stock(), 499);
    assert.deepEqual(customerMessages(), confirmedTo('TBJ-missed'));
    /* The webhook after all, and tomorrow's run: nothing more. */
    assert.equal((await webhookCaptured('pay_2')).status, 200);
    assert.equal((await runCron()).json.settled.length, 0);
    assert.deepEqual(customerMessages(), confirmedTo('TBJ-missed'));
  });

  test('paid, but the payment can’t be read (or doesn’t cover the order) → skipped and logged, as before', async () => {
    withRzp('unread', ['captured']);
    rzp.noPaymentsApi = true;
    const unread = await quietly(runCron);
    assert.deepEqual(unread.json.skipped, [{ id: 'unread', reason: 'razorpay_paid' }]);
    assert.equal(orderDoc('unread').status, 'pending');
    rzp.noPaymentsApi = false;

    db.store.get('orders').delete('unread');
    withRzp('short', ['captured']);
    rzp.payments.get(`pay_${rzp.payments.size}`).amount = 100;
    const short = await quietly(runCron);
    assert.deepEqual(short.json.skipped, [{ id: 'short', reason: 'razorpay_paid' }]);
    assert.equal(orderDoc('short').status, 'pending');
    assert.deepEqual(sent, []);
  });

  test('one shared Razorpay check: the clean-up and checkout use src/lib/razorpayState.js', () => {
    const cron = readFileSync(path.resolve('src/app/api/cron/expire-unpaid-orders/route.js'), 'utf8');
    const ordersSrc = readFileSync(path.resolve('src/app/api/orders/route.js'), 'utf8');
    for (const s of [cron, ordersSrc]) {
      assert.match(s, /from '@\/lib\/razorpayState'/);
      assert.doesNotMatch(s, /function razorpayState/);
    }
  });
});
