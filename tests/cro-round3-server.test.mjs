/* ─────────────────────────────────────────────
   CRO round 3 — the skeptic's re-verification regressions, server side,
   through the REAL route handlers:

     R1  a retry that takes over an abandoned attempt's coupon use / parked
         loyalty cancels that attempt in the same commit ('replaced'); a
         late payment on it is recorded for a refund, never confirmed
     R2  first-order codes: no delivery-phone matching (no oracle, no
         refusal for a gift recipient)
     R3  checkout giving up its unpaid attempt (unpaidOnly) is quiet
     R4  GET /api/loyalty → parkedDiscount
     R6  POST /api/payments/create-order → ALREADY_PAID / ORDER_CANCELLED
     B   GET /api/cron/expire-unpaid-orders (+ vercel.json)
     F   a date-only Valid Until ends at 23:59:59.999 IST

   The guiding rules: the amount on the Place-order button is the amount
   charged; an abandoned online payment never costs or gifts the customer
   anything; a paid order is never cancelled; no customer messages for
   internal bookkeeping.

   Only the edges are fakes: the NextAuth session, Firestore (in-memory,
   every transaction held to "all reads before any write"), email and
   WhatsApp (recorded) and the Razorpay SDK. The fake doesn't resolve
   dotted where() paths, so the cron tests mirror 'payment.method' the way
   real Firestore resolves it.

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
process.env.CRON_SECRET = 'cron-test-secret';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
delete process.env.SHIPROCKET_EMAIL;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (user) => { session = user ? { user } : null; };
const getServerSession = async () => session;

/* Razorpay SDK stand-in with its own ledger of orders and payments. */
const rzp = { orders: new Map(), payments: new Map(), creates: 0, fetches: 0, down: false, noPaymentsApi: false };
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
        if (rzp.down) throw new Error('ETIMEDOUT');
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
   paid; 'failed' / 'authorized' leave it 'attempted'. */
function payOnRazorpay(rzpOrderId, status = 'captured') {
  const o = rzp.orders.get(rzpOrderId);
  o.status = status === 'captured' ? 'paid' : 'attempted';
  const pay = { id: `pay_${rzp.payments.size + 1}`, order_id: o.id, status, amount: o.amount, currency: 'INR' };
  rzp.payments.set(pay.id, pay);
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${o.id}|${pay.id}`).digest('hex');
  return { razorpayOrderId: o.id, razorpayPaymentId: pay.id, razorpaySignature: signature };
}

/* Every message to a customer, recorded: [kind, orderNumber, status?]. */
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
    ...Object.fromEntries(['sendOTPEmail', 'sendOrderNotificationToAdmin', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'sendVendorOrderNotification', 'isConfigured'].map((n) => [n, noop])),
    sendOrderConfirmation: record('email:placed'),
    sendStatusUpdateEmail: record('email:status'),
    esc: (v) => String(v ?? ''),
  },
});
mock.module(src('lib/whatsapp.js'), {
  namedExports: {
    ...Object.fromEntries(['sendOrderWhatsAppToAdmin', 'sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])),
    sendOrderWhatsAppToCustomer: record('wa:placed'),
    sendStatusWhatsApp: record('wa:status'),
  },
});

const route = (p) => import(src(`app/api/${p}/route.js`));
const [orders, orderById, validate, createOrder, verify, coupons, couponById, loyalty, expireCron] = await Promise.all([
  route('orders'), route('orders/[id]'), route('coupons/validate'), route('payments/create-order'), route('payments/verify'),
  route('coupons'), route('coupons/[id]'), route('loyalty'), route('cron/expire-unpaid-orders'),
]);
const { settlePaidOrder } = await import(src('lib/settlePayment.js'));
const { parseCouponInput, couponStateRefusal, couponDiscountFor, isAbandonedAttempt } = await import(src('lib/coupons.js'));

/* Every request from its own address: the coupon check allows 20 an hour per IP. */
let ipN = 0;
const freshIp = () => { ipN += 1; return `10.12.${Math.floor(ipN / 250)}.${(ipN % 250) + 1}`; };
async function call(mod, method, body, params = {}, headers = {}) {
  const res = await mod[method](new Request('http://tulsi.test/api', {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp(), ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }), { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
}
const post = (body) => call(orders, 'POST', body);
const check = (code, orderAmount = 1500) => call(validate, 'POST', { code, orderAmount });
const cancel = (id, extra = {}) => call(orderById, 'PUT', { status: 'cancelled', ...extra }, { id });
const payFor = (orderId) => call(createOrder, 'POST', { orderId });
const runCron = (auth = `Bearer ${process.env.CRON_SECRET}`) => call(expireCron, 'GET', undefined, {}, auth === null ? {} : { authorization: auth });
const quietly = async (fn) => {
  const orig = [console.error, console.warn];
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { [console.error, console.warn] = orig; }
};

const NEW = { id: 'u-new', email: 'new@x.test', emailVerified: true };
const OWNER = { id: 'owner', email: 'owner@tulsi.test' };
const customer = (n, extra = {}) => ({ id: `u-${n}`, email: `c${n}@x.test`, emailVerified: true, ...extra });
const ADDRESS = { fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' };
const addressFor = (phone) => ({ ...ADDRESS, phone });

/* What checkout posts. ₹1,500 piece, shipping ₹99 below ₹2,000, no COD fee above ₹500. */
const order = (extra = {}) => ({ items: [{ product: 'p1', quantity: 1 }], shippingAddress: ADDRESS, payment: { method: 'cod' }, ...extra });
const online = (extra = {}) => order({ payment: { method: 'razorpay' }, ...extra });

const couponDoc = (id) => db.store.get('coupons').get(id);
const orderDoc = (id) => db.store.get('orders').get(id);
const userDoc = (id) => db.store.get('users').get(id);
const stock = () => db.store.get('products').get('p1').stock;
const statusMessages = () => sent.filter(([k]) => k.endsWith(':status'));
const snapshot = () => JSON.stringify([...db.store.entries()].filter(([c, m]) => c !== 'rateLimits' && m.size > 0)
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
const DAY = 24 * HOUR;

beforeEach(() => {
  session = null;
  sent.length = 0;
  rzp.orders.clear(); rzp.payments.clear(); rzp.creates = 0; rzp.fetches = 0; rzp.down = false; rzp.noPaymentsApi = false;
  db = strictTransactions(fakeFirestore({
    products: { p1: { name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 500, isActive: true } },
    coupons: {
      welcome: { ...COUPON, code: 'TULSI10', value: 10, firstOrderOnly: true },
      once: { ...COUPON, code: 'FEST100', type: 'fixed', value: 100 },
    },
    orders: {},
    users: { 'u-new': { email: 'new@x.test', pendingLoyaltyDiscount: 100, loyaltyPoints: 0 } },
    settings: { site: {} },
  }));
});

/* ══ R1: the retry replaces the abandoned attempt it takes over ══ */

describe('R1 — a retry that takes over an abandoned attempt cancels it in the same commit', () => {
  /* #1: online with FEST100 and ₹100 parked points; the Razorpay window was
     opened (create-order) and closed. Then a reload: the page forgot #1. */
  async function abandonedAttempt() {
    signInAs(NEW);
    const a = await post(online({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(a.status, 201, a.json.message);
    assert.equal(a.json.data.total, 1500 - 200 + 99);
    const pay = await payFor(a.json.data.id);
    assert.equal(pay.status, 200);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
    sent.length = 0;
    return { id: a.json.data.id, rzpOrderId: pay.json.data.id };
  }

  test('regress R1: the COD retry gets the coupon and points shown; #1 is cancelled as replaced — quietly, nothing handed back twice', async () => {
    const first = await abandonedAttempt();
    const retry = await post(order({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(retry.status, 201, retry.json.message);
    assert.equal(retry.json.data.total, 1399, 'the amount on the button: ₹1,500 − ₹100 − ₹100 + ₹99');
    assert.equal(retry.json.data.loyaltyDiscount, 100);

    const A = orderDoc(first.id);
    assert.equal(A.status, 'cancelled');
    assert.equal(A.cancelReason, 'replaced');
    assert.equal(A.replacedBy, retry.json.data.id);
    assert.ok(A.cancelledAt && !Number.isNaN(Date.parse(A.cancelledAt)));
    assert.deepEqual([A.couponReleased, A.couponMovedTo, A.loyaltyRestored, A.loyaltyMovedTo], [true, retry.json.data.id, true, retry.json.data.id]);
    assert.deepEqual(couponDoc('once').usedBy, ['u:u-new'], 'one use, held by the retry');
    assert.equal(couponDoc('once').usedCount, 1);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
    assert.deepEqual(statusMessages(), [], 'no "order cancelled" email or WhatsApp for #1');
    assert.deepEqual(sent.map(([k, n]) => [k, n]), [['email:placed', retry.json.data.orderNumber], ['wa:placed', retry.json.data.orderNumber]]);

    /* Cancelling #1 again does nothing more (it is already cancelled). */
    signInAs(OWNER);
    await cancel(first.id);
    assert.equal(couponDoc('once').usedCount, 1);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
  });

  test('regress R1: the UPI payment on #1 lands late → recorded for a refund, not confirmed; cancelling the retry gives the discount back once', async () => {
    const first = await abandonedAttempt();
    const retry = await post(order({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(retry.status, 201);

    /* The UPI approval for #1 (verify; the webhook takes the same path). */
    signInAs(NEW);
    const v = await quietly(() => call(verify, 'POST', { ...payOnRazorpay(first.rzpOrderId), orderId: first.id }));
    assert.equal(v.status, 200, v.json.message);
    const A = orderDoc(first.id);
    assert.equal(A.status, 'cancelled', 'not confirmed');
    assert.equal(A.payment.status, 'paid');
    assert.equal(A.paidAfterCancel, true);
    assert.equal(A.refundDue, true, '"Refund due" in the admin’s orders');
    assert.equal(A.stockDeducted, undefined);
    assert.equal(stock(), 500, 'no stock taken for #1');
    assert.equal(A.pointsAwarded, undefined);
    assert.equal(userDoc('u-new').loyaltyPoints, 0, 'no points earned on a refunded payment');
    assert.equal(couponDoc('once').usedCount, 1, 'no second use of FEST100');
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0, 'no points discount re-applied');

    /* A second delivery (the webhook after verify) changes nothing. */
    await settlePaidOrder(db, db.collection('orders').doc(first.id), { razorpayPaymentId: 'pay_again' });
    assert.equal(orderDoc(first.id).status, 'cancelled');

    /* The customer cancels the COD retry: FEST100 and the ₹100 come back —
       once — and are the customer's to use on exactly one order. */
    const c = await cancel(retry.json.data.id);
    assert.equal(c.status, 200, c.json.message);
    assert.deepEqual(couponDoc('once').usedBy, []);
    assert.equal(couponDoc('once').usedCount, 0);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 100);
    const third = await post(order({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(third.status, 201);
    assert.equal(third.json.data.total, 1399);
    const fourth = await post(order({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(fourth.status, 409);
    assert.equal(fourth.json.reason, 'used', 'not a second time');
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
  });

  test('create-order refuses the replaced attempt: 409 ORDER_CANCELLED (replaced) — no Razorpay order', async () => {
    const first = await abandonedAttempt();
    await post(order({ couponCode: 'FEST100', couponDiscount: 100 }));
    const creates = rzp.creates;
    const r = await payFor(first.id);
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'ORDER_CANCELLED');
    assert.equal(r.json.replaced, true);
    assert.match(r.json.message, /replaced by your newer order/);
    assert.equal(rzp.creates, creates);
  });

  test('an attempt that was paid is never replaced: the coupon → 409 used (nothing written), the points stay with it', async () => {
    const first = await abandonedAttempt();
    signInAs(NEW);
    assert.equal((await call(verify, 'POST', { ...payOnRazorpay(first.rzpOrderId), orderId: first.id })).status, 200);
    assert.equal(orderDoc(first.id).status, 'confirmed');
    const before = snapshot();
    const r = await post(order({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'COUPON_CHANGED');
    assert.equal(r.json.reason, 'used');
    assert.equal(snapshot(), before);
    const noCoupon = await post(order());
    assert.equal(noCoupon.status, 201);
    assert.equal(noCoupon.json.data.loyaltyDiscount, 0, 'the paid order keeps its points discount');
    assert.equal(orderDoc(first.id).status, 'confirmed', 'the paid order is untouched');
    assert.equal(orderDoc(first.id).loyaltyRestored, undefined);
  });

  test('paid in the very moment between the coupon check and the commit: not replaced, 409, nothing written', async () => {
    const first = await abandonedAttempt();
    const realTx = db.runTransaction.bind(db);
    let before;
    db.runTransaction = (fn) => {
      db.runTransaction = realTx;
      Object.assign(orderDoc(first.id), { status: 'confirmed', payment: { ...orderDoc(first.id).payment, status: 'paid' } });
      before = snapshot();
      return realTx(fn);
    };
    const r = await post(order({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(r.status, 409);
    assert.equal(r.json.reason, 'used');
    assert.equal(snapshot(), before);
    assert.equal(orderDoc(first.id).status, 'confirmed');
  });

  test('points-only hand-over: the attempt is replaced and its use of a different code is released', async () => {
    const first = await abandonedAttempt(); // FEST100 + ₹100 points
    const retry = await post(order({ couponCode: 'TULSI10', couponDiscount: 150 }));
    assert.equal(retry.status, 201, retry.json.message);
    assert.equal(retry.json.data.total, 1500 - 150 - 100 + 99);
    const A = orderDoc(first.id);
    assert.equal(A.status, 'cancelled');
    assert.equal(A.replacedBy, retry.json.data.id);
    assert.equal(A.loyaltyMovedTo, retry.json.data.id);
    assert.equal(A.couponReleased, true);
    assert.equal(A.couponMovedTo, undefined, 'FEST100 is not taken over — it is given back');
    assert.deepEqual(couponDoc('once').usedBy, []);
    assert.equal(couponDoc('once').usedCount, 0);
    assert.deepEqual(couponDoc('welcome').usedBy, ['u:u-new']);
    assert.equal(couponDoc('welcome').usedCount, 1);
    assert.deepEqual(statusMessages(), []);

    /* And with no code at all on the retry. */
    userDoc('u-new').pendingLoyaltyDiscount = 0;
    const second = await post(online({ couponCode: 'FEST100', couponDiscount: 100, items: [{ product: 'p1', quantity: 2 }] }));
    assert.equal(second.status, 201);
    const plain = await post(order());
    assert.equal(plain.status, 201);
    assert.equal(orderDoc(second.json.data.id).status, 'pending', 'no points held, no code taken over: left alone');
  });

  test('a retry with no coupon takes the points and releases the attempt’s code', async () => {
    const first = await abandonedAttempt();
    const retry = await post(order());
    assert.equal(retry.status, 201);
    assert.equal(retry.json.data.loyaltyDiscount, 100);
    assert.equal(orderDoc(first.id).status, 'cancelled');
    assert.equal(couponDoc('once').usedCount, 0);
    assert.deepEqual(couponDoc('once').usedBy, []);
  });

  test('another customer’s attempt is never replaced', async () => {
    db.store.get('users').set('u-a', { email: 'ca@x.test', pendingLoyaltyDiscount: 50 });
    signInAs(customer('a'));
    const theirs = await post(online({ couponCode: 'FEST100', couponDiscount: 100 }));
    signInAs(NEW);
    const mine = await post(order({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(mine.status, 201);
    const t = orderDoc(theirs.json.data.id);
    assert.equal(t.status, 'pending');
    assert.equal(t.couponReleased, undefined);
    assert.equal(t.loyaltyRestored, undefined);
    assert.equal(userDoc('u-a').pendingLoyaltyDiscount, 0);
  });

  test('a sessionless request never cancels an order; the attempt it took the use from can’t be paid or confirmed', async () => {
    signInAs(null);
    const a = await post(online({ guestEmail: 'g@x.test', couponCode: 'FEST100' }));
    assert.equal(a.json.data.discount, 100);
    const b = await post(order({ guestEmail: 'g@x.test', couponCode: 'FEST100' }));
    assert.equal(b.json.data.discount, 100);
    const A = orderDoc(a.json.data.id);
    assert.equal(A.status, 'pending', 'not cancelled on an unauthenticated request');
    assert.equal(A.couponMovedTo, b.json.data.id);

    /* The verified owner of g@x.test tries to pay it: refused. */
    signInAs({ id: 'u-g', email: 'g@x.test', emailVerified: true });
    const r = await payFor(a.json.data.id);
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'ORDER_CANCELLED');
    assert.equal(r.json.replaced, true);
    /* A payment arriving anyway (an older Razorpay order): refunded, not confirmed. */
    const s = await quietly(() => settlePaidOrder(db, db.collection('orders').doc(a.json.data.id), { razorpayPaymentId: 'pay_x' }));
    assert.deepEqual(s, { alreadySettled: true, paidAfterCancel: true });
    const after = orderDoc(a.json.data.id);
    assert.deepEqual([after.status, after.cancelReason, after.replacedBy, after.refundDue, after.payment.status], ['cancelled', 'replaced', b.json.data.id, true, 'paid']);
    assert.equal(stock(), 500);
  });

  test('a replaced attempt saved before this fix (moved-to set, still pending) paid late → cancelled as replaced, refund due', async () => {
    db.store.get('orders').set('legacy', {
      userId: 'u-new', status: 'pending', total: 1399, items: [{ product: 'p1', quantity: 1 }],
      payment: { method: 'razorpay', status: 'pending', razorpayOrderId: 'order_old' }, coupon: 'once', couponReleased: true, couponMovedTo: 'newer',
    });
    const s = await quietly(() => settlePaidOrder(db, db.collection('orders').doc('legacy'), { razorpayPaymentId: 'pay_old' }));
    assert.equal(s.paidAfterCancel, true);
    const L = orderDoc('legacy');
    assert.deepEqual([L.status, L.cancelReason, L.replacedBy, L.paidAfterCancel, L.refundDue], ['cancelled', 'replaced', 'newer', true, true]);
    assert.equal(stock(), 500);
  });

  test('an unpaid holder the store moved on (confirmed) is a real order: the code counts as used', async () => {
    Object.assign(couponDoc('once'), { usedBy: ['u:u-new'], usedCount: 1 });
    db.store.get('orders').set('manual', { userId: 'u-new', couponUserKey: 'u:u-new', coupon: 'once', status: 'confirmed', stockDeducted: true, payment: { method: 'razorpay', status: 'pending' } });
    signInAs(NEW);
    const before = snapshot();
    const r = await post(order({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(r.status, 409);
    assert.equal(r.json.reason, 'used');
    assert.equal(snapshot(), before);
    assert.equal(orderDoc('manual').status, 'confirmed');
  });

  test('isAbandonedAttempt: pending, online, unpaid, no stock taken', () => {
    const base = { status: 'pending', payment: { method: 'razorpay', status: 'pending' } };
    assert.equal(isAbandonedAttempt(base), true);
    for (const o of [null, { ...base, status: 'confirmed' }, { ...base, status: 'cancelled' }, { ...base, payment: { method: 'cod', status: 'pending' } },
      { ...base, payment: { method: 'razorpay', status: 'paid' } }, { ...base, stockDeducted: true }]) {
      assert.equal(isAbandonedAttempt(o), false, JSON.stringify(o));
    }
  });
});

/* ══ R2: first-order codes don't look at delivery phones ══ */

describe('R2 — first-order checks match the account and a verified email only', () => {
  /* As real Firestore resolves where('shippingAddress.phone', …). */
  const placedTo = (id, phone, extra = {}) => db.store.get('orders').set(id, {
    userId: `u-${id}`, guestEmail: `${id}@x.test`, status: 'delivered', payment: { method: 'cod', status: 'paid' },
    shippingAddress: { phone }, 'shippingAddress.phone': phone, ...extra,
  });
  const whereFields = () => {
    const fields = [];
    const col = db.collection.bind(db);
    db.collection = (n) => {
      const c = col(n);
      return n === 'orders' ? { ...c, where: (f, ...rest) => { fields.push(f); return c.where(f, ...rest); } } : c;
    };
    return fields;
  };

  test('regress R2: no oracle — any phone gives the same answer, and no phone is ever queried', async () => {
    placedTo('victim', '9123456789');
    const fields = whereFields();
    signInAs({ id: 'u-probe', email: 'probe@x.test', emailVerified: false });
    const probe = async (phone) => (await post(order({ couponCode: 'TULSI10', couponDiscount: 1, shippingAddress: addressFor(phone) }))).json.reason;
    assert.equal(await probe('9123456789'), 'amount_changed');
    assert.equal(await probe('9000000001'), 'amount_changed');
    assert.ok(!fields.includes('shippingAddress.phone'), `queried: ${fields}`);
  });

  test('regress R3: a gift shipped with the bride’s phone doesn’t block her own first order — validate and checkout agree', async () => {
    placedTo('gift', '9988776655', { userId: 'u-buyer', guestEmail: 'buyer@x.test' });
    signInAs({ id: 'u-bride', email: 'bride@x.test', emailVerified: true });
    const v = await check('TULSI10');
    assert.equal(v.status, 200);
    const o = await post(order({ couponCode: 'TULSI10', couponDiscount: v.json.data.discount, shippingAddress: addressFor('9988776655') }));
    assert.equal(o.status, 201, o.json.message);
    assert.equal(o.json.data.discount, 150);
    assert.equal(o.json.data.total, 1449);
  });

  test('still refused: the account’s own placed order, and a placed order under the customer’s verified email', async () => {
    db.store.get('orders').set('own', { userId: 'u-new', guestEmail: 'new@x.test', status: 'delivered', payment: { method: 'cod', status: 'paid' } });
    signInAs(NEW);
    assert.equal((await post(order({ couponCode: 'TULSI10', couponDiscount: 150 }))).json.reason, 'first_order_only');
    assert.equal((await check('TULSI10')).json.code, 'FIRST_ORDER_ONLY');

    db.store.get('orders').set('guest', { userId: null, guestEmail: 'v@x.test', status: 'pending', payment: { method: 'cod', status: 'pending' } });
    signInAs({ id: 'u-v', email: 'v@x.test', emailVerified: true });
    assert.equal((await post(order({ couponCode: 'TULSI10', couponDiscount: 150 }))).json.reason, 'first_order_only');
    signInAs({ id: 'u-v2', email: 'v@x.test', emailVerified: false });
    assert.equal((await post(order({ couponCode: 'TULSI10', couponDiscount: 150 }))).status, 201, 'an unproven email is not matched');
    signInAs(null);
    assert.equal((await post(order({ guestEmail: 'fresh@x.test', couponCode: 'TULSI10', couponDiscount: 150 }))).json.reason, 'sign_in_required');
  });
});

/* ══ R3: giving up an unpaid attempt is quiet ══ */

describe('R3 — checkout giving up its unpaid online attempt sends the customer nothing', () => {
  async function attempt() {
    signInAs(NEW);
    const a = await post(online({ couponCode: 'FEST100', couponDiscount: 100 }));
    assert.equal(a.status, 201);
    sent.length = 0;
    return a.json.data.id;
  }

  test('unpaidOnly: cancelled, no email or WhatsApp — and the coupon use and parked points still come back', async () => {
    const id = await attempt();
    const r = await cancel(id, { unpaidOnly: true });
    assert.equal(r.status, 200, r.json.message);
    assert.equal(orderDoc(id).status, 'cancelled');
    assert.deepEqual(sent, []);
    assert.equal(couponDoc('once').usedCount, 0);
    assert.deepEqual(couponDoc('once').usedBy, []);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 100);
  });

  test('a real cancel is still news: My Orders (no unpaidOnly), or a placed COD order', async () => {
    const id = await attempt();
    assert.equal((await cancel(id)).status, 200);
    assert.deepEqual(sent.map(([k, , s]) => [k, s]), [['email:status', 'cancelled'], ['wa:status', 'cancelled']]);

    sent.length = 0;
    const cod = await post(order());
    sent.length = 0;
    assert.equal((await cancel(cod.json.data.id, { unpaidOnly: true })).status, 200);
    assert.equal(statusMessages().length, 2, 'a COD order is a placed order');
  });

  test('unpaidOnly on an order paid meanwhile: refused (409), nothing sent', async () => {
    const id = await attempt();
    const pay = await payFor(id);
    payOnRazorpay(pay.json.data.id);
    const r = await cancel(id, { unpaidOnly: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'ALREADY_PAID');
    assert.deepEqual(sent, []);
  });
});

/* ══ R4: GET /api/loyalty → parkedDiscount ══ */

describe('R4 — GET /api/loyalty tells the page the points discount the next order gets', () => {
  const read = () => call(loyalty, 'GET');

  test('parked + held by abandoned attempts; the reload retry then takes exactly that (charged = shown)', async () => {
    signInAs(NEW);
    await db.collection('loyaltyTransactions').doc('t1').set({ userId: 'u-new', type: 'redeem', points: -100, createdAt: '2026-10-01T00:00:00.000Z' });
    const before = await read();
    assert.equal(before.status, 200);
    assert.equal(before.json.data.parkedDiscount, 100);
    assert.equal(before.json.data.points, 0, 'existing fields kept');
    assert.equal(before.json.data.transactions.length, 1);

    const a = await post(online());
    assert.equal(a.json.data.loyaltyDiscount, 100);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
    userDoc('u-new').pendingLoyaltyDiscount = 40; // redeemed more since
    const reloaded = await read();
    assert.equal(reloaded.json.data.parkedDiscount, 140, '₹40 parked + ₹100 held by the abandoned attempt');

    const retry = await post(order());
    assert.equal(retry.json.data.loyaltyDiscount, 140);
    assert.equal(retry.json.data.total, 1500 - 140 + 99);
    assert.equal((await read()).json.data.parkedDiscount, 0);
  });

  test('not counted: a paid attempt, a COD order, a cancelled one, another customer’s; a failed look-up → the parked amount only', async () => {
    const seed = (id, o) => db.store.get('orders').set(id, { userId: 'u-new', status: 'pending', loyaltyDiscount: 30, payment: { method: 'razorpay', status: 'pending' }, ...o });
    seed('held', {});
    seed('paid', { payment: { method: 'razorpay', status: 'paid' } });
    seed('cod', { payment: { method: 'cod', status: 'pending' } });
    seed('gone', { status: 'cancelled' });
    seed('restored', { loyaltyRestored: true });
    seed('theirs', { userId: 'u-other' });
    signInAs(NEW);
    assert.equal((await read()).json.data.parkedDiscount, 100 + 30);

    const col = db.collection.bind(db);
    db.collection = (n) => (n === 'orders' ? { ...col(n), where: () => { throw new Error('UNAVAILABLE'); } } : col(n));
    const r = await quietly(read);
    assert.equal(r.status, 200);
    assert.equal(r.json.data.parkedDiscount, 100);
  });

  test('signed out: 401', async () => {
    signInAs(null);
    assert.equal((await read()).status, 401);
  });
});

/* ══ R6: create-order answers with explicit codes ══ */

describe('R6 — POST /api/payments/create-order: ALREADY_PAID / ORDER_CANCELLED, plain errors otherwise', () => {
  async function unpaid() {
    signInAs(NEW);
    const o = await post(online());
    return o.json.data.id;
  }

  test('cancelled → 409 ORDER_CANCELLED (not replaced)', async () => {
    const id = await unpaid();
    await cancel(id);
    const r = await payFor(id);
    assert.equal(r.status, 409);
    assert.deepEqual([r.json.success, r.json.code, r.json.replaced, r.json.message], [false, 'ORDER_CANCELLED', false, 'This order was cancelled.']);
  });

  test('paid here → 409 ALREADY_PAID; paid on Razorpay, not yet here → 409 ALREADY_PAID; paid after a cancel → ORDER_CANCELLED', async () => {
    const id = await unpaid();
    const first = await payFor(id);
    payOnRazorpay(first.json.data.id);
    const rzpPaid = await payFor(id);
    assert.equal(rzpPaid.status, 409);
    assert.equal(rzpPaid.json.code, 'ALREADY_PAID');
    await settlePaidOrder(db, db.collection('orders').doc(id), { razorpayPaymentId: 'pay_1' });
    const here = await payFor(id);
    assert.equal(here.status, 409);
    assert.equal(here.json.code, 'ALREADY_PAID');

    const id2 = await unpaid();
    await cancel(id2);
    await quietly(() => settlePaidOrder(db, db.collection('orders').doc(id2), { razorpayPaymentId: 'pay_2' }));
    const refunded = await payFor(id2);
    assert.equal(refunded.status, 409);
    assert.equal(refunded.json.code, 'ORDER_CANCELLED', 'the money is being refunded — not "your order is placed"');
  });

  test('online payment paused → 400 with no code; the order stays payable', async () => {
    const id = await unpaid();
    await payFor(id);
    db.store.get('settings').set('site', { onlinePaymentEnabled: false });
    const r = await payFor(id);
    assert.equal(r.status, 400);
    assert.equal(r.json.code, undefined);
    assert.match(r.json.message, /temporarily unavailable/);
    assert.equal(orderDoc(id).status, 'pending');
    db.store.get('settings').set('site', {});
    assert.equal((await payFor(id)).status, 200);
  });

  test('Razorpay unreachable on the re-read → still the same order (no code, no cancel)', async () => {
    const id = await unpaid();
    const first = await payFor(id);
    rzp.down = true;
    const r = await quietly(() => payFor(id));
    assert.equal(r.status, 200);
    assert.equal(r.json.data.id, first.json.data.id);
  });
});

/* ══ server/B: the daily clean-up of unpaid online orders ══ */

describe('GET /api/cron/expire-unpaid-orders', () => {
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  /* As real Firestore resolves where('payment.method', …). */
  const mirror = () => { for (const o of db.store.get('orders').values()) if (o.payment?.method) o['payment.method'] = o.payment.method; };
  const seed = (id, o = {}) => db.store.get('orders').set(id, {
    orderNumber: `TBJ-${id}`, userId: 'u-new', status: 'pending', createdAt: ago(25 * HOUR), total: 1449,
    items: [{ product: 'p1', quantity: 1 }], payment: { method: 'razorpay', status: 'pending' }, ...o,
  });

  test('auth: the CRON_SECRET bearer only', async () => {
    assert.equal((await runCron(null)).status, 401);
    assert.equal((await runCron('Bearer wrong')).status, 401);
    assert.equal((await runCron(`Bearer ${process.env.CRON_SECRET}x`)).status, 401);
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      assert.equal((await runCron('Bearer undefined')).status, 401, 'no secret configured → nobody');
    } finally { process.env.CRON_SECRET = saved; }
    assert.equal((await runCron()).status, 200);
  });

  test('a day-old unpaid attempt is cancelled quietly; its coupon use and parked points go back', async () => {
    signInAs(NEW);
    const a = await post(online({ couponCode: 'FEST100', couponDiscount: 100 }));
    await payFor(a.json.data.id); // Razorpay order created, never paid
    orderDoc(a.json.data.id).createdAt = ago(25 * HOUR);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
    mirror();
    sent.length = 0;

    const r = await runCron();
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.expired, [a.json.data.id]);
    const A = orderDoc(a.json.data.id);
    assert.equal(A.status, 'cancelled');
    assert.equal(A.cancelReason, 'expired');
    assert.equal(couponDoc('once').usedCount, 0);
    assert.deepEqual(couponDoc('once').usedBy, []);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 100);
    assert.deepEqual(sent, [], 'no email or WhatsApp');
    assert.equal((await check('FEST100')).status, 200, 'the code works again for the customer');
    /* A payment landing after all is recorded for a refund. */
    await quietly(() => settlePaidOrder(db, db.collection('orders').doc(a.json.data.id), { razorpayPaymentId: 'pay_late' }));
    assert.equal(orderDoc(a.json.data.id).refundDue, true);
    assert.equal(orderDoc(a.json.data.id).status, 'cancelled');
  });

  test('left alone: younger than a day, COD, paid, confirmed, already cancelled', async () => {
    seed('young', { createdAt: ago(23 * HOUR) });
    seed('cod', { payment: { method: 'cod', status: 'pending' } });
    seed('paid', { payment: { method: 'razorpay', status: 'paid' } });
    seed('confirmed', { status: 'confirmed', stockDeducted: true });
    seed('gone', { status: 'cancelled' });
    seed('old');
    mirror();
    const r = await runCron();
    assert.deepEqual(r.json.expired, ['old']);
    for (const id of ['young', 'cod', 'paid']) assert.equal(orderDoc(id).status, 'pending', id);
    assert.equal(orderDoc('confirmed').status, 'confirmed');
  });

  test('checked with Razorpay first: paid, a payment in progress, or unreachable → skipped (logged); only failed attempts → expired', async () => {
    const withRzp = (id, payment) => {
      const rzpId = `order_${id}`;
      rzp.orders.set(rzpId, { id: rzpId, amount: 144900, status: 'created' });
      seed(id, { payment: { method: 'razorpay', status: 'pending', razorpayOrderId: rzpId } });
      if (payment) payOnRazorpay(rzpId, payment);
      return rzpId;
    };
    withRzp('created');
    withRzp('paid', 'captured');
    withRzp('authorized', 'authorized');
    withRzp('failed', 'failed');
    seed('never'); // create-order never ran: nothing to check
    mirror();
    const logged = [];
    const warn = console.warn;
    console.warn = (...a) => logged.push(a.join(' '));
    let r;
    try { r = await runCron(); } finally { console.warn = warn; }
    assert.deepEqual([...r.json.expired].sort(), ['created', 'failed', 'never']);
    assert.deepEqual(r.json.skipped.map((s) => [s.id, s.reason]).sort(), [['authorized', 'razorpay_attempted'], ['paid', 'razorpay_paid']]);
    assert.equal(orderDoc('paid').status, 'pending', 'never cancel an order that has been paid');
    assert.equal(orderDoc('authorized').status, 'pending');
    assert.equal(logged.length, 2);
    assert.match(logged.join('\n'), /paid[\s\S]*attempted|attempted[\s\S]*paid/);

    seed('later', { payment: { method: 'razorpay', status: 'pending', razorpayOrderId: 'order_later' } });
    rzp.orders.set('order_later', { id: 'order_later', amount: 144900, status: 'attempted' });
    mirror();
    rzp.noPaymentsApi = true;
    const unreadable = await quietly(() => runCron());
    assert.deepEqual(unreadable.json.skipped.find((s) => s.id === 'later'), { id: 'later', reason: 'razorpay_attempted' });
    rzp.noPaymentsApi = false;
    rzp.down = true;
    const down = await quietly(() => runCron());
    assert.deepEqual(down.json.skipped.find((s) => s.id === 'later'), { id: 'later', reason: 'razorpay_unknown' });
    assert.equal(orderDoc('later').status, 'pending');
  });

  test('Razorpay not configured: nothing to ask, the unpaid order is expired', async () => {
    seed('old', { payment: { method: 'razorpay', status: 'pending', razorpayOrderId: 'order_x' } });
    mirror();
    const saved = [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET];
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
      const r = await runCron();
      assert.deepEqual(r.json.expired, ['old']);
      assert.equal(rzp.fetches, 0);
    } finally { [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET] = saved; }
  });

  test('bounded: at most 200 a run, the rest the next day', async () => {
    for (let i = 0; i < 205; i += 1) seed(`o${String(i).padStart(3, '0')}`);
    mirror();
    const r = await runCron();
    assert.equal(r.json.expired.length, 200);
    assert.equal(r.json.remaining, 5);
    const next = await runCron();
    assert.equal(next.json.expired.length, 5);
    assert.equal(next.json.remaining, 0);
  });

  test('paid between the scan and the cancel: not cancelled', async () => {
    seed('racy');
    mirror();
    const realTx = db.runTransaction.bind(db);
    db.runTransaction = (fn) => {
      db.runTransaction = realTx;
      Object.assign(orderDoc('racy'), { status: 'confirmed', payment: { method: 'razorpay', status: 'paid' } });
      return realTx(fn);
    };
    const r = await runCron();
    assert.deepEqual(r.json.expired, []);
    assert.deepEqual(r.json.skipped, [{ id: 'racy', reason: 'changed' }]);
    assert.equal(orderDoc('racy').status, 'confirmed');
  });

  test('registered in vercel.json as a daily cron, next to shipment-sync', () => {
    const { crons } = JSON.parse(readFileSync(path.resolve('vercel.json'), 'utf8'));
    const byPath = Object.fromEntries(crons.map((c) => [c.path, c.schedule]));
    assert.equal(byPath['/api/cron/shipment-sync'], '30 3 * * *');
    const s = byPath['/api/cron/expire-unpaid-orders'];
    assert.match(s, /^\d{1,2} \d{1,2} \* \* \*$/, 'once a day (Vercel Hobby allows only daily crons)');
  });
});

/* ══ F: Valid Until ends at the end of that day in India ══ */

describe('F — a date-only Valid Until runs to 23:59:59.999 IST', () => {
  test('parseCouponInput: date → end of the day in India; a full timestamp kept; blank → none', () => {
    const base = { code: 'BRIDE10', type: 'percentage', value: 10 };
    assert.equal(parseCouponInput({ ...base, validUntil: '2026-12-31' }).data.expiresAt, '2026-12-31T18:29:59.999Z');
    assert.equal(parseCouponInput({ ...base, expiresAt: '2026-12-31T10:00:00.000Z' }).data.expiresAt, '2026-12-31T10:00:00.000Z');
    assert.equal(parseCouponInput({ ...base, validUntil: '' }).data.expiresAt, null);
    assert.ok(parseCouponInput({ ...base, validUntil: 'soon' }).error);
    const sameDay = parseCouponInput({ ...base, validFrom: '2026-12-31', validUntil: '2026-12-31' });
    assert.equal(sameDay.error, undefined, 'a one-day coupon is valid');
    assert.equal(sameDay.data.startsAt, '2026-12-30T18:30:00.000Z');
    assert.ok(parseCouponInput({ ...base, validFrom: '2027-01-02', validUntil: '2027-01-01' }).error);
    assert.equal(couponDiscountFor({ type: 'percentage', value: 10 }, 1500), 150, 'the discount formula is unchanged');
  });

  test('the code works all of its last day in India and stops at midnight IST', () => {
    const c = { ...COUPON, ...parseCouponInput({ code: 'LASTDAY', type: 'fixed', value: 100, validUntil: '2026-12-31' }).data };
    assert.equal(couponStateRefusal(c, { now: new Date('2026-12-31T10:00:00+05:30') }), null, '10:00 IST — was already expired');
    assert.equal(couponStateRefusal(c, { now: new Date('2026-12-31T23:59:59+05:30') }), null);
    assert.equal(couponStateRefusal(c, { now: new Date('2027-01-01T00:00:00+05:30') }), 'expired');
  });

  test('saved through the admin routes; a stored value is left alone by an edit that doesn’t send it', async () => {
    signInAs(OWNER);
    const created = await call(coupons, 'POST', { code: 'NEWYEAR', type: 'fixed', value: 200, minOrderAmount: 0, usageLimit: '', validFrom: '', validUntil: '2026-12-31', isActive: true });
    assert.equal(created.status, 201, created.json.message);
    assert.equal(couponDoc(created.json.data.id).expiresAt, '2026-12-31T18:29:59.999Z');

    db.store.get('coupons').set('legacy', { ...COUPON, code: 'OLDEXP', value: 5, expiresAt: '2026-12-31T00:00:00.000Z' });
    const edit = await call(couponById, 'PUT', { value: 7 }, { id: 'legacy' });
    assert.equal(edit.status, 200, edit.json.message);
    assert.equal(couponDoc('legacy').expiresAt, '2026-12-31T00:00:00.000Z', 'existing stored values unchanged');
    assert.equal(couponDoc('legacy').value, 7);
  });
});
