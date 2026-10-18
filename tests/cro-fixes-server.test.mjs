/* ─────────────────────────────────────────────
   CRO fixes — the reviewers' server-side reproductions as regression
   tests, through the REAL route handlers:

     POST /api/orders                 409 COUPON_CHANGED (nothing written),
                                      abandoned online attempts, first-order
                                      hardening (session, phone, email)
     POST /api/coupons/validate       the same rules, as a preview
     PUT  /api/orders/[id]            the customer gives up an unpaid attempt
     POST /api/payments/create-order  pay again = the same Razorpay order
     POST /api/payments/verify        a paid online order is a placed order
     POST/PUT /api/coupons            Max Discount, Valid From, Unlimited
     GET  /api/announcement           the strip only for a live code
     viewersOnPage                    "viewing right now" = 90 seconds

   Each reproduction from the review (cro-review2/*.test.mjs) is named in
   its test. The guiding rule: a customer is never charged a different
   amount from the one on the Place-order button, and an abandoned online
   payment never costs them their coupon or loyalty discount.

   Only the edges are fakes: the NextAuth session, Firestore (in-memory),
   email, WhatsApp and the Razorpay SDK. The fake doesn't resolve dotted
   where() paths ('shippingAddress.phone'), so the phone tests mirror that
   field the way real Firestore would resolve it.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore, INC } from './helpers/fakeFirestore.mjs';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
delete process.env.SHIPROCKET_EMAIL;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (user) => { session = user ? { user } : null; };
const getServerSession = async () => session;

/* Razorpay SDK stand-in with its own little ledger of orders and payments. */
const rzp = { orders: new Map(), payments: new Map(), creates: 0, down: false };
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
        if (rzp.down) throw new Error('ETIMEDOUT');
        if (!rzp.orders.has(id)) throw Object.assign(new Error('not found'), { error: { description: 'The id provided does not exist' } });
        return { ...rzp.orders.get(id) };
      },
    };
    this.payments = {
      fetch: async (id) => ({ ...rzp.payments.get(id) }),
      capture: async (id) => ({ ...rzp.payments.get(id), status: 'captured' }),
    };
  }
}
/* The shopper pays on the Razorpay window: Razorpay marks its order paid. */
function payOnRazorpay(rzpOrderId) {
  const o = rzp.orders.get(rzpOrderId);
  o.status = 'paid';
  const pay = { id: `pay_${rzp.payments.size + 1}`, order_id: o.id, status: 'captured', amount: o.amount, currency: 'INR' };
  rzp.payments.set(pay.id, pay);
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${o.id}|${pay.id}`).digest('hex');
  return { razorpayOrderId: o.id, razorpayPaymentId: pay.id, razorpaySignature: signature };
}

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
const noop = async () => {};
mock.module(src('lib/email.js'), { namedExports: { ...Object.fromEntries(['sendOTPEmail', 'sendOrderConfirmation', 'sendOrderNotificationToAdmin', 'sendStatusUpdateEmail', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'sendVendorOrderNotification', 'isConfigured'].map((n) => [n, noop])), esc: (v) => String(v ?? '') } });
mock.module(src('lib/whatsapp.js'), { namedExports: Object.fromEntries(['sendOrderWhatsAppToAdmin', 'sendOrderWhatsAppToCustomer', 'sendStatusWhatsApp', 'sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])) });

const route = (p) => import(src(`app/api/${p}/route.js`));
const [orders, orderById, validate, createOrder, verify, coupons, couponById, announcement] = await Promise.all([
  route('orders'), route('orders/[id]'), route('coupons/validate'), route('payments/create-order'), route('payments/verify'),
  route('coupons'), route('coupons/[id]'), route('announcement'),
]);
const { viewersOnPage, _resetViewersCache, VIEWERS_WINDOW_MS, VIEWERS_CACHE_MS } = await import(src('lib/analytics/viewers.js'));
const { couponDiscountFor } = await import(src('lib/coupons.js'));

/* Every request from its own address: the coupon check allows 20 an hour per IP. */
let ipN = 0;
const freshIp = () => { ipN += 1; return `10.11.${Math.floor(ipN / 250)}.${(ipN % 250) + 1}`; };
async function call(mod, method, body, params = {}) {
  const res = await mod[method](new Request('http://tulsi.test/api', {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }), { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
}
const post = (body) => call(orders, 'POST', body);
const check = (code, orderAmount = 1500) => call(validate, 'POST', { code, orderAmount });
const cancel = (id) => call(orderById, 'PUT', { status: 'cancelled' }, { id });
const payFor = (orderId) => call(createOrder, 'POST', { orderId });
const quietly = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

/* Customers. Each has their own mobile number, so the phone check only
   matters where a test says so. */
const NEW = { id: 'u-new', email: 'new@x.test', emailVerified: true };
const RETURNING = { id: 'u-old', email: 'old@x.test', emailVerified: true };
const OWNER = { id: 'owner', email: 'owner@tulsi.test' };
const customer = (n, extra = {}) => ({ id: `u-${n}`, email: `c${n}@x.test`, emailVerified: true, ...extra });
const ADDRESS = { fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' };
const addressFor = (phone) => ({ ...ADDRESS, phone });

/* What checkout posts. Defaults: ₹1,500 piece, shipping ₹99 below ₹2,000,
   no COD fee above ₹500. */
const order = (extra = {}) => ({ items: [{ product: 'p1', quantity: 1 }], shippingAddress: ADDRESS, payment: { method: 'cod' }, couponCode: 'TULSI10', ...extra });
const online = (extra = {}) => order({ payment: { method: 'razorpay' }, ...extra });

const couponDoc = (id = 'welcome') => db.store.get('coupons').get(id);
const orderDoc = (id) => db.store.get('orders').get(id);
const orderDocs = () => [...(db.store.get('orders')?.values() || [])];
const userDoc = (id) => db.store.get('users').get(id);
/* Everything checkout could write (the coupon check's rate-limit counter
   aside; the fake materialises an empty collection on a read). */
const snapshot = () => JSON.stringify([...db.store.entries()].filter(([c, m]) => c !== 'rateLimits' && m.size > 0)
  .map(([c, m]) => [c, [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1))]));
/* As real Firestore resolves where('shippingAddress.phone', …). */
const mirrorPhones = () => { for (const o of orderDocs()) if (o.shippingAddress?.phone) o['shippingAddress.phone'] = o.shippingAddress.phone; };

const COUPON = { type: 'percentage', maxUses: 0, usedCount: 0, usedBy: [], isActive: true, minOrderAmount: 0, maxDiscount: null, startsAt: null, expiresAt: null };
const DAY = 86_400_000;

beforeEach(() => {
  session = null;
  rzp.orders.clear(); rzp.payments.clear(); rzp.creates = 0; rzp.down = false;
  db = fakeFirestore({
    products: {
      p1: { name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 500, isActive: true },
      big: { name: 'Bridal Set', price: 150000, stock: 5, isActive: true },
    },
    coupons: {
      welcome: { ...COUPON, code: 'TULSI10', value: 10, firstOrderOnly: true },
      once: { ...COUPON, code: 'ONCE100', type: 'fixed', value: 100 },
      big: { ...COUPON, code: 'BIG500', type: 'fixed', value: 500, minOrderAmount: 5000 },
    },
    orders: {},
    users: { 'u-new': { email: 'new@x.test', pendingLoyaltyDiscount: 0 }, 'u-old': { email: 'old@x.test' } },
    settings: { site: {} },
  });
});

/* ══ Contract 2: the coupon discount the shopper was shown, or 409 ══ */

describe('409 COUPON_CHANGED — an order that wouldn’t get the coupon as shown is not created, and nothing is written', () => {
  const past = () => new Date(Date.now() - DAY).toISOString();
  const future = () => new Date(Date.now() + DAY).toISOString();
  /* [label, setup(), body, expected reason, couponApplied, server discount] */
  const CASES = [
    ['first-order code shown at /cart, then signed in as a returning customer (finding checkout/A)', () => {
      db.store.get('orders').set('paid', { userId: 'u-old', guestEmail: 'old@x.test', status: 'delivered', payment: { method: 'razorpay', status: 'paid' } });
      signInAs(RETURNING);
    }, (m) => order({ payment: { method: m }, couponDiscount: 150 }), 'first_order_only', false, 0],
    ['a once-per-customer code already spent on a placed order', () => {
      Object.assign(couponDoc('once'), { usedBy: ['u:u-new'], usedCount: 1 });
      db.store.get('orders').set('prev', { userId: 'u-new', couponUserKey: 'u:u-new', coupon: 'once', status: 'processing', payment: { method: 'cod', status: 'pending' } });
      signInAs(NEW);
    }, (m) => order({ payment: { method: m }, couponCode: 'ONCE100', couponDiscount: 100 }), 'used', false, 0],
    ['expired', () => { couponDoc().expiresAt = past(); signInAs(NEW); }, (m) => order({ payment: { method: m }, couponDiscount: 150 }), 'expired', false, 0],
    ['below its minimum after the quantity was lowered (finding BN-2)', () => signInAs(NEW),
      (m) => order({ payment: { method: m }, items: [{ product: 'p1', quantity: 3 }], couponCode: 'BIG500', couponDiscount: 500 }), 'min_order', false, 0],
    ['Max Discount: shown uncapped ₹15,000, the cap is ₹500 (finding server/F)', () => { couponDoc().maxDiscount = 500; signInAs(NEW); },
      (m) => order({ payment: { method: m }, items: [{ product: 'big', quantity: 1 }], couponDiscount: 15000 }), 'amount_changed', true, 500],
    ['Valid From still in the future (finding server/F)', () => { couponDoc().startsAt = future(); signInAs(NEW); },
      (m) => order({ payment: { method: m }, couponDiscount: 150 }), 'not_started', false, 0],
    ['used up by other customers', () => { Object.assign(couponDoc('once'), { maxUses: 2, usedCount: 2, usedBy: ['u:a', 'u:b'] }); signInAs(NEW); },
      (m) => order({ payment: { method: m }, couponCode: 'ONCE100', couponDiscount: 100 }), 'limit', false, 0],
    ['switched off', () => { couponDoc().isActive = false; signInAs(NEW); }, (m) => order({ payment: { method: m }, couponDiscount: 150 }), 'inactive', false, 0],
    ['no such code', () => signInAs(NEW), (m) => order({ payment: { method: m }, couponCode: 'NOPE10', couponDiscount: 150 }), 'not_found', false, 0],
    ['a first-order code on a sessionless API order (finding server/C)', () => signInAs(null),
      (m) => order({ payment: { method: m }, guestEmail: 'a1@fake.test', couponDiscount: 150 }), 'sign_in_required', false, 0],
  ];

  for (const [label, setup, body, reason, couponApplied, discount] of CASES) {
    for (const method of ['cod', 'razorpay']) {
      test(`${label} — ${method === 'cod' ? 'COD' : 'online'}`, async () => {
        setup();
        const before = snapshot();
        const r = await post(body(method));
        assert.equal(r.status, 409, r.json.message);
        assert.equal(r.json.success, false);
        assert.equal(r.json.code, 'COUPON_CHANGED');
        assert.equal(r.json.reason, reason);
        assert.equal(r.json.couponApplied, couponApplied);
        assert.equal(r.json.discount, discount);
        assert.ok(typeof r.json.message === 'string' && r.json.message.length > 15);
        assert.doesNotMatch(r.json.message, /undefined|NaN/);
        assert.equal(snapshot(), before, 'no order, no coupon use, no loyalty, no saved address');
      });
    }
  }

  test('the customer confirms the new total and is charged exactly that', async () => {
    /* Refused: the coupon comes off; the order then costs the full price. */
    db.store.get('orders').set('paid', { userId: 'u-old', guestEmail: 'old@x.test', status: 'delivered', payment: { method: 'razorpay', status: 'paid' } });
    signInAs(RETURNING);
    const refused = await post(order({ couponDiscount: 150 }));
    assert.equal(refused.status, 409);
    const again = await post(order({ couponCode: undefined }));
    assert.equal(again.status, 201);
    assert.equal(again.json.data.total, 1500 + 99);

    /* A different amount: shown again with the server's figure, accepted at it. */
    couponDoc().maxDiscount = 500;
    signInAs(NEW);
    const capped = await post(online({ items: [{ product: 'big', quantity: 1 }], couponDiscount: 15000 }));
    assert.equal(capped.json.discount, 500);
    const ok = await post(online({ items: [{ product: 'big', quantity: 1 }], couponDiscount: capped.json.discount }));
    assert.equal(ok.status, 201, ok.json.message);
    assert.equal(ok.json.data.discount, 500);
    assert.equal(ok.json.data.total, 150000 - 500);
  });

  test('below the minimum and shown as ₹0 ("Add ₹500 more"): placed at full price, the code not counted', async () => {
    signInAs(NEW);
    const r = await post(order({ items: [{ product: 'p1', quantity: 3 }], couponCode: 'BIG500', couponDiscount: 0 }));
    assert.equal(r.status, 201);
    assert.equal(r.json.data.discount, 0);
    assert.equal(r.json.data.total, 4500);
    assert.equal(r.json.data.couponCode, null);
    assert.equal(couponDoc('big').usedCount, 0);
  });

  test('shown = server: one order, one use counted (no 409)', async () => {
    signInAs(NEW);
    const r = await post(order({ couponDiscount: 150 }));
    assert.equal(r.status, 201);
    assert.equal(r.json.data.total, 1449);
    assert.deepEqual(couponDoc().usedBy, ['u:u-new']);
    assert.equal(couponDoc().usedCount, 1);
    assert.equal(orderDocs().length, 1);
  });
});

/* ══ Abandoned online attempts (findings server/A, checkout/B, BN-3) ══ */

describe('an abandoned Razorpay attempt never costs the coupon or the parked loyalty discount', () => {
  test('coupons-repro A: close Razorpay, retry as COD → the discount shown, counted once', async () => {
    signInAs(NEW);
    const first = await post(online({ couponDiscount: 150 }));
    assert.equal(first.status, 201);
    assert.equal(first.json.data.discount, 150);
    assert.deepEqual(couponDoc().usedBy, ['u:u-new']);

    /* The page still shows 10% off — and that is now true. */
    const v = await check('TULSI10');
    assert.equal(v.status, 200);
    assert.equal(v.json.data.discount, 150);

    const retry = await post(order({ couponDiscount: 150 }));
    assert.equal(retry.status, 201, retry.json.message);
    assert.equal(retry.json.data.discount, 150, 'not dropped (was 0)');
    assert.equal(retry.json.data.total, 1449, 'not ₹1,599');
    assert.deepEqual(couponDoc().usedBy, ['u:u-new']);
    assert.equal(couponDoc().usedCount, 1);
  });

  test('coupon + parked points over three attempts (online, online after a reload, COD), then the stale attempts are cancelled', async () => {
    userDoc('u-new').pendingLoyaltyDiscount = 100;
    signInAs(NEW);
    const a = await post(online({ couponDiscount: 150 }));
    assert.equal(a.json.data.discount, 250);
    assert.equal(a.json.data.loyaltyDiscount, 100);
    assert.equal(a.json.data.total, 1500 - 250 + 99);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);

    const b = await post(online({ couponDiscount: 150 }));
    assert.equal(b.status, 201);
    assert.equal(b.json.data.discount, 250, 'coupon and points both still there');
    assert.equal(b.json.data.loyaltyDiscount, 100);

    const c = await post(order({ couponDiscount: 150 }));
    assert.equal(c.status, 201);
    assert.equal(c.json.data.total, 1349);
    assert.equal(c.json.data.loyaltyDiscount, 100);

    assert.deepEqual(couponDoc().usedBy, ['u:u-new'], 'one entry');
    assert.equal(couponDoc().usedCount, 1, 'counted once');
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0, 'the points were spent once, by the placed order');
    const [A, B] = [orderDoc(a.json.data.id), orderDoc(b.json.data.id)];
    assert.deepEqual([A.couponReleased, A.couponMovedTo, A.loyaltyRestored, A.loyaltyMovedTo], [true, b.json.data.id, true, b.json.data.id]);
    assert.deepEqual([B.couponReleased, B.couponMovedTo, B.loyaltyRestored, B.loyaltyMovedTo], [true, c.json.data.id, true, c.json.data.id]);

    /* The customer (or a clean-up) cancels the stale attempts: nothing is handed back twice. */
    for (const stale of [a, b]) {
      const r = await cancel(stale.json.data.id);
      assert.equal(r.status, 200, r.json.message);
    }
    assert.deepEqual(couponDoc().usedBy, ['u:u-new']);
    assert.equal(couponDoc().usedCount, 1);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
    assert.equal(orderDoc(c.json.data.id).status, 'pending', 'the placed order is untouched');

    /* The COD order is a placed first order now. */
    assert.equal((await check('TULSI10')).json.code, 'FIRST_ORDER_ONLY');
    assert.equal((await post(order({ couponDiscount: 150 }))).json.reason, 'first_order_only');
  });

  test('an older page (no couponDiscount) gets the same: the retry keeps the code', async () => {
    signInAs(NEW);
    assert.equal((await post(online())).json.data.discount, 150);
    const retry = await post(order());
    assert.equal(retry.status, 201);
    assert.equal(retry.json.data.discount, 150);
    assert.equal(couponDoc().usedCount, 1);
  });

  test('another customer’s unpaid attempt is never taken over', async () => {
    db.store.get('users').set('u-a', { email: 'ca@x.test', pendingLoyaltyDiscount: 50 });
    signInAs(customer('a'));
    const theirs = await post(online({ couponCode: 'ONCE100', couponDiscount: 100, shippingAddress: addressFor('9000000001') }));
    assert.equal(theirs.json.data.loyaltyDiscount, 50);
    signInAs(NEW);
    const mine = await post(order({ couponCode: 'ONCE100', couponDiscount: 100 }));
    assert.equal(mine.status, 201);
    assert.equal(mine.json.data.loyaltyDiscount, 0, 'not their points');
    assert.deepEqual(couponDoc('once').usedBy, ['u:u-a', 'u:u-new']);
    assert.equal(couponDoc('once').usedCount, 2);
    const t = orderDoc(theirs.json.data.id);
    assert.equal(t.couponReleased, undefined);
    assert.equal(t.loyaltyRestored, undefined);
  });

  test('a placed earlier order still blocks — COD, or paid online through Razorpay', async () => {
    signInAs(NEW);
    /* First order, paid online: create-order → Razorpay → verify. */
    const first = await post(online({ couponDiscount: 150 }));
    const pay = await payFor(first.json.data.id);
    assert.equal(pay.status, 200);
    const v = await call(verify, 'POST', { ...payOnRazorpay(pay.json.data.id), orderId: first.json.data.id });
    assert.equal(v.status, 200, v.json.message);
    assert.equal(orderDoc(first.json.data.id).payment.status, 'paid');

    assert.equal((await check('TULSI10')).json.code, 'FIRST_ORDER_ONLY');
    const again = await post(order({ couponDiscount: 150 }));
    assert.equal(again.status, 409);
    assert.equal(again.json.reason, 'first_order_only');
    assert.equal(couponDoc().usedCount, 1);

    /* Once-per-customer code on a COD order. */
    assert.equal((await post(order({ couponCode: 'ONCE100', couponDiscount: 100 }))).status, 201);
    const used = await check('ONCE100');
    assert.equal(used.status, 400);
    assert.equal(used.json.code, 'COUPON_USED');
    const twice = await post(online({ couponCode: 'ONCE100', couponDiscount: 100 }));
    assert.equal(twice.status, 409);
    assert.equal(twice.json.reason, 'used');
    assert.equal(couponDoc('once').usedCount, 1);
  });
});

/* ══ Usage limits (finding server/B) ══ */

describe('usage limits', () => {
  test('coupons-repro B/B2: a blank "Usage Limit" is unlimited — 100 abandoned attempts never use the code up', async () => {
    signInAs(OWNER);
    const created = await call(coupons, 'POST', {
      code: 'WELCOME', description: '', type: 'percentage', value: 10, minOrderAmount: 0, maxDiscount: '',
      usageLimit: '', validFrom: '', validUntil: '', isActive: true, firstOrderOnly: true,
    });
    assert.equal(created.status, 201, created.json.message);
    assert.equal(created.json.data.maxUses, 0, 'not 100');

    for (let i = 0; i < 100; i += 1) {
      signInAs(customer(i));
      const r = await post(online({ couponCode: 'WELCOME', couponDiscount: 150, shippingAddress: addressFor(`9${String(i).padStart(9, '0')}`) }));
      assert.equal(r.status, 201, `attempt ${i}: ${r.json.message}`);
    }
    signInAs(customer('real'));
    const v = await check('WELCOME');
    assert.equal(v.status, 200, v.json.message);
    const real = await post(order({ couponCode: 'WELCOME', couponDiscount: 150 }));
    assert.equal(real.status, 201);
    assert.equal(real.json.data.discount, 150);
  });

  test('an explicit limit: unpaid attempts hold their use until cancelled, and cancelling gives it back', async () => {
    Object.assign(couponDoc('once'), { maxUses: 2 });
    const attempts = {};
    for (const n of ['1', '2']) {
      signInAs(customer(n));
      const r = await post(online({ couponCode: 'ONCE100', couponDiscount: 100, shippingAddress: addressFor(`900000000${n}`) }));
      assert.equal(r.status, 201);
      attempts[n] = r.json.data.id;
    }
    signInAs(customer('3'));
    const before = snapshot();
    const full = await post(order({ couponCode: 'ONCE100', couponDiscount: 100 }));
    assert.equal(full.json.reason, 'limit');
    assert.equal(snapshot(), before);

    signInAs(customer('1'));
    const c = await cancel(attempts['1']);
    assert.equal(c.status, 200);
    assert.deepEqual(couponDoc('once').usedBy, ['u:u-2']);
    assert.equal(couponDoc('once').usedCount, 1);

    signInAs(customer('3'));
    const now = await post(order({ couponCode: 'ONCE100', couponDiscount: 100 }));
    assert.equal(now.status, 201, now.json.message);
    assert.equal(now.json.data.discount, 100);
  });
});

/* ══ First-order-only (findings server/C, server/G) ══ */

describe('first-order-only: who is a first-time customer', () => {
  test('coupons-repro C: sessionless API orders never get it — not with any number of fresh emails', async () => {
    signInAs(null);
    for (const e of ['a1@fake.test', 'a2@fake.test', 'a3@fake.test']) {
      const before = snapshot();
      const r = await post(order({ guestEmail: e, couponDiscount: 150 }));
      assert.equal(r.status, 409, e);
      assert.equal(r.json.reason, 'sign_in_required');
      assert.equal(snapshot(), before);
      const legacy = await post(order({ guestEmail: e }));
      assert.equal(legacy.status, 201);
      assert.equal(legacy.json.data.discount, 0, `${e}: was 150 every time`);
    }
    assert.equal(couponDoc().usedCount, 0);
    /* The preview while signed out still shows it (checkout requires sign-in). */
    const preview = await check('TULSI10');
    assert.equal(preview.status, 200);
    assert.equal(preview.json.data.coupon.firstOrderOnly, true);
  });

  test('phone: a placed order to the same mobile blocks a new account, in any format; abandoned or cancelled ones don’t', async () => {
    signInAs(customer('a'));
    const placed = await post(order({ couponCode: undefined, shippingAddress: addressFor('9876500001') }));
    assert.equal(placed.status, 201);
    const abandoned = await post(online({ couponCode: undefined, shippingAddress: addressFor('9876500002') }));
    assert.equal(abandoned.status, 201);
    const gone = await post(order({ couponCode: undefined, shippingAddress: addressFor('9876500003') }));
    signInAs(OWNER);
    assert.equal((await cancel(gone.json.data.id)).status, 200);
    mirrorPhones();

    signInAs(customer('fresh', { emailVerified: false }));
    for (const phone of ['9876500001', '+91 98765 00001']) {
      const before = snapshot();
      const r = await post(order({ shippingAddress: addressFor(phone), couponDiscount: 150 }));
      assert.equal(r.status, 409, phone);
      assert.equal(r.json.reason, 'first_order_only', phone);
      assert.equal(snapshot(), before);
    }
    for (const phone of ['9876500002', '9876500003', '9123456780']) {
      const r = await post(order({ shippingAddress: addressFor(phone), couponDiscount: 150 }));
      assert.equal(r.status, 201, `${phone}: ${r.json.message}`);
      assert.equal(r.json.data.discount, 150);
      signInAs(OWNER);
      await cancel(r.json.data.id); // a fresh first order for the next phone
      signInAs(customer('fresh', { emailVerified: false }));
    }
  });

  test('coupons-repro C2: email history is matched only for a verified email — no order-history oracle', async () => {
    db.store.get('orders').set('g1', { userId: null, guestEmail: 'victim@x.test', status: 'pending', payment: { method: 'cod', status: 'pending' }, shippingAddress: { phone: '9000000099' } });
    signInAs({ id: 'u-attacker', email: 'victim@x.test', emailVerified: false });
    const v = await check('TULSI10');
    assert.equal(v.status, 200, 'the victim’s guest order is not revealed');
    const o = await post(order({ couponDiscount: 150 }));
    assert.equal(o.status, 201, 'matched by account and phone only');
    assert.equal(o.json.data.discount, 150);

    signInAs({ id: 'u-victim', email: 'victim@x.test', emailVerified: true });
    assert.equal((await check('TULSI10')).json.code, 'FIRST_ORDER_ONLY', 'the proven owner of the email is matched');
    const theirs = await post(order({ shippingAddress: addressFor('9000000098'), couponDiscount: 150 }));
    assert.equal(theirs.status, 409);
    assert.equal(theirs.json.reason, 'first_order_only');
  });

  test('verify-fg G: a gift shipped to the bride’s email doesn’t make her a returning customer', async () => {
    signInAs({ id: 'u-buyer', email: 'buyer@x.test', emailVerified: true });
    const gift = await post(order({ couponCode: undefined, shippingAddress: { ...addressFor('9000000011'), email: 'bride@x.test' } }));
    assert.equal(gift.status, 201);
    const stored = orderDoc(gift.json.data.id);
    assert.equal(stored.guestEmail, 'buyer@x.test');
    stored['shippingAddress.email'] = stored.shippingAddress.email; // as real Firestore resolves it
    signInAs({ id: 'u-bride', email: 'bride@x.test', emailVerified: true });
    assert.equal((await check('TULSI10')).status, 200);
    const mine = await post(order({ shippingAddress: addressFor('9000000012'), couponDiscount: 150 }));
    assert.equal(mine.status, 201);
    assert.equal(mine.json.data.discount, 150);
  });
});

/* ══ Admin coupon fields (finding server/F) ══ */

describe('Max Discount and Valid From are stored, listed and enforced', () => {
  test('verify-fg F: created as the admin form sends it → capped at checkout, refused before its start', async () => {
    signInAs(OWNER);
    const startsTomorrow = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
    const created = await call(coupons, 'POST', {
      code: 'BRIDE10', description: 'Bridal', type: 'percentage', value: 10, minOrderAmount: 0, maxDiscount: 500,
      usageLimit: '', validFrom: startsTomorrow, validUntil: '', isActive: true, firstOrderOnly: false,
    });
    assert.equal(created.status, 201, created.json.message);
    const id = created.json.data.id;
    const listed = (await call(coupons, 'GET')).json.data.find((c) => c.id === id);
    assert.equal(listed.maxDiscount, 500);
    assert.equal(listed.startsAt, new Date(`${startsTomorrow}T00:00:00+05:30`).toISOString(), 'midnight in India');
    assert.equal(listed.maxUses, 0);

    signInAs(NEW);
    const early = await check('BRIDE10', 150000);
    assert.equal(early.status, 400);
    assert.equal(early.json.message, 'This coupon isn’t active yet');
    assert.equal((await post(online({ items: [{ product: 'big', quantity: 1 }], couponCode: 'BRIDE10', couponDiscount: 500 }))).json.reason, 'not_started');

    /* The admin clears Valid From: live now, still capped. */
    signInAs(OWNER);
    const put = await call(couponById, 'PUT', { validFrom: '' }, { id });
    assert.equal(put.status, 200);
    assert.equal(put.json.data.startsAt, null);
    assert.equal(put.json.data.maxDiscount, 500, 'an edit that doesn’t touch the cap keeps it');

    signInAs(NEW);
    const v = await check('BRIDE10', 150000);
    assert.equal(v.status, 200);
    assert.equal(v.json.data.discount, 500, 'not ₹15,000');
    assert.equal(v.json.data.coupon.maxDiscount, 500);
    const r = await post(online({ items: [{ product: 'big', quantity: 1 }], couponCode: 'BRIDE10', couponDiscount: v.json.data.discount }));
    assert.equal(r.status, 201, r.json.message);
    assert.equal(r.json.data.discount, 500);
    assert.equal(r.json.data.total, 149500);
  });

  test('an edit clears the cap and the limit; only staff may edit', async () => {
    Object.assign(couponDoc(), { maxDiscount: 500, maxUses: 100 });
    signInAs(NEW);
    assert.equal((await call(couponById, 'PUT', { maxDiscount: '' }, { id: 'welcome' })).status, 403);
    signInAs(OWNER);
    const r = await call(couponById, 'PUT', { maxDiscount: '', usageLimit: '' }, { id: 'welcome' });
    assert.equal(r.status, 200);
    assert.equal(couponDoc().maxDiscount, null);
    assert.equal(couponDoc().maxUses, 0);
    assert.equal(couponDiscountFor(couponDoc(), 150000), 15000);
    const bad = await call(couponById, 'PUT', { maxDiscount: -1 }, { id: 'welcome' });
    assert.equal(bad.status, 400);
  });
});

/* ══ Contract 3: the customer cancels their own unpaid online order ══ */

describe('PUT /api/orders/[id] { status: "cancelled" } by the customer', () => {
  async function unpaidAttempt() {
    userDoc('u-new').pendingLoyaltyDiscount = 100;
    signInAs(NEW);
    const r = await post(online({ couponDiscount: 150 }));
    assert.equal(r.status, 201);
    assert.equal(couponDoc().usedCount, 1);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
    return r.json.data.id;
  }

  test('their own unpaid online order: cancelled; the coupon use and the parked points come back; the retry gets both', async () => {
    const id = await unpaidAttempt();
    await payFor(id); // the Razorpay window was opened, then closed unpaid
    const r = await cancel(id);
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.status, 'cancelled');
    assert.deepEqual(couponDoc().usedBy, []);
    assert.equal(couponDoc().usedCount, 0);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 100);
    assert.equal(orderDoc(id).couponReleased, true);
    assert.equal(orderDoc(id).loyaltyRestored, true);

    /* Again (a retried request): nothing is handed back twice. */
    const twice = await cancel(id);
    assert.equal(twice.status, 400);
    assert.equal(couponDoc().usedCount, 0);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 100);

    const cod = await post(order({ couponDiscount: 150 }));
    assert.equal(cod.json.data.discount, 250);
    assert.equal(cod.json.data.total, 1349, '₹1,500 − ₹150 − ₹100 + ₹99');
    assert.deepEqual(couponDoc().usedBy, ['u:u-new']);
    assert.equal(couponDoc().usedCount, 1);
  });

  test('someone else’s order: 403 and nothing written — also an unverified account holding the guest’s email', async () => {
    const id = await unpaidAttempt();
    const guest = 'guestorder';
    db.store.get('orders').set(guest, { userId: null, guestEmail: 'guest@x.test', status: 'pending', payment: { method: 'razorpay', status: 'pending' }, coupon: null });
    const before = snapshot();
    signInAs(customer('other'));
    assert.equal((await cancel(id)).status, 403);
    signInAs({ id: 'u-claim', email: 'guest@x.test', emailVerified: false });
    assert.equal((await cancel(guest)).status, 403);
    signInAs(null);
    assert.equal((await cancel(id)).status, 401);
    assert.equal(snapshot(), before);
    /* The verified owner of that email may. */
    signInAs({ id: 'u-guest', email: 'guest@x.test', emailVerified: true });
    assert.equal((await cancel(guest)).status, 200);
  });

  test('a paid order is not given up: Razorpay already has the money → 409 ALREADY_PAID; packed → 400', async () => {
    const id = await unpaidAttempt();
    const pay = await payFor(id);
    payOnRazorpay(pay.json.data.id); // the UPI approval landed after the window closed; no webhook yet
    const before = snapshot();
    const r = await cancel(id);
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'ALREADY_PAID');
    assert.equal(snapshot(), before, 'the order, its coupon use and the points stay as they are');

    db.store.get('orders').set('packed', { userId: 'u-new', status: 'processing', payment: { method: 'razorpay', status: 'paid' } });
    const packed = await cancel('packed');
    assert.equal(packed.status, 400);
    assert.match(packed.json.message, /already processing/);
  });

  test('Razorpay unreachable: the unpaid order is still cancelled (a late payment is then recorded as paidAfterCancel)', async () => {
    const id = await unpaidAttempt();
    await payFor(id);
    rzp.down = true;
    const r = await quietly(() => cancel(id));
    assert.equal(r.status, 200);
    assert.equal(couponDoc().usedCount, 0);
  });
});

/* ══ Contract 4: create-order again for the same unpaid order ══ */

describe('POST /api/payments/create-order twice for the same unpaid order', () => {
  test('the same Razorpay order for the current total; a payment made on the first window settles it', async () => {
    signInAs(NEW);
    const o = await post(online({ couponDiscount: 150 }));
    const id = o.json.data.id;
    const first = await payFor(id);
    assert.equal(first.status, 200);
    assert.equal(first.json.data.amount, 144900, '₹1,449 — what the button said');
    const second = await payFor(id);
    assert.equal(second.status, 200);
    assert.equal(second.json.data.id, first.json.data.id);
    assert.equal(second.json.data.amount, 144900);
    assert.equal(rzp.creates, 1, 'no second Razorpay order');
    assert.equal(orderDoc(id).payment.razorpayOrderId, first.json.data.id);

    /* The shopper actually paid on the first window: verify settles THIS order. */
    const v = await call(verify, 'POST', { ...payOnRazorpay(first.json.data.id), orderId: id });
    assert.equal(v.status, 200, v.json.message);
    assert.equal(orderDoc(id).payment.status, 'paid');
    assert.equal(orderDoc(id).status, 'confirmed');
    const third = await payFor(id);
    assert.equal(third.status, 400, 'already paid');
  });

  test('paid on Razorpay but not yet here → 409 ALREADY_PAID (no second payment); cancelled → 400; not theirs → 403', async () => {
    signInAs(NEW);
    const o = await post(online({ couponDiscount: 150 }));
    const id = o.json.data.id;
    const first = await payFor(id);
    payOnRazorpay(first.json.data.id);
    const again = await payFor(id);
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'ALREADY_PAID');

    const o2 = await post(online({ couponCode: undefined }));
    signInAs(customer('other'));
    assert.equal((await payFor(o2.json.data.id)).status, 403);
    signInAs(NEW);
    await cancel(o2.json.data.id);
    const gone = await payFor(o2.json.data.id);
    assert.equal(gone.status, 400);
    assert.equal(gone.json.message, 'This order was cancelled.');
  });
});

/* ══ Live viewers (finding server/E) ══ */

describe('"N people are viewing this right now" means the last 90 seconds', () => {
  const NOW = new Date('2026-10-16T08:00:00Z');
  const iso = (agoMs) => new Date(NOW.getTime() - agoMs).toISOString();
  const vid = (c) => `tj_vid_${String(c).padEnd(22, 'x')}`;
  const sid = (c) => `tj_sid_${String(c).padEnd(22, 'y')}`;
  const sessions = (rows) => ({ analytics_sessions: Object.fromEntries(rows.map(([s, ago, p = '/product/p1']) => [sid(s), { sid: sid(s), vid: vid(s.toUpperCase()), currentPath: p, lastSeenAt: iso(ago) }])) });
  beforeEach(() => _resetViewersCache());

  test('viewers-repro: two shoppers who closed the tab 4.5 minutes ago are not "viewing right now"', async () => {
    db = fakeFirestore(sessions([['a', 270_000], ['b', 270_000]]));
    assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW, excludeSid: sid('me') }), 0, 'was 2');
  });

  test('the window is 90 s, the shared snapshot 30 s', async () => {
    assert.equal(VIEWERS_WINDOW_MS, 90_000);
    assert.equal(VIEWERS_CACHE_MS, 30_000);
    db = fakeFirestore(sessions([['a', 89_000], ['b', 91_000], ['c', 10_000], ['d', 10_000, '/product/p2']]));
    assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW, excludeSid: sid('me') }), 2);
  });

  test('a snapshot reused 25 s later re-applies the window: someone seen 80 s before it no longer counts', async () => {
    db = fakeFirestore(sessions([['a', 80_000], ['b', 20_000], ['c', 30_000]]));
    assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW }), 3);
    db.store.get('analytics_sessions').clear(); // not read again: the snapshot is shared
    const later = new Date(NOW.getTime() + 25_000);
    assert.equal(await viewersOnPage(db, '/product/p1', { now: later }), 2, 'a is 105 s old now');
  });
});

/* ══ The welcome strip (finding server/D) ══ */

describe('GET /api/announcement — the offer only while its code really works', () => {
  const read = async () => { const r = await announcement.GET(new Request('http://tulsi.test/api/announcement')); return { status: r.status, json: await r.json() }; };
  const withCode = (couponFields) => fakeFirestore({
    settings: { site: { announcement: { enabled: true, message: 'Diwali: 20% OFF bridal sets', code: 'diwali20' } } },
    coupons: couponFields === null ? {} : { d: { ...COUPON, code: 'DIWALI20', value: 20, ...couponFields } },
  });

  /* [label, coupon fields (null = no coupon), active] */
  const TABLE = [
    ['coupons-repro D: the code doesn’t exist', null, false],
    ['switched off', { isActive: false }, false],
    ['expired', { expiresAt: '2020-01-01T00:00:00.000Z' }, false],
    ['Valid From in the future', { startsAt: '2099-01-01T00:00:00.000Z' }, false],
    ['used up', { maxUses: 5, usedCount: 5 }, false],
    ['live (started yesterday, a use left)', { startsAt: new Date(Date.now() - DAY).toISOString(), maxUses: 5, usedCount: 4 }, true],
    ['live, unlimited', {}, true],
  ];
  for (const [label, fields, active] of TABLE) {
    test(label, async () => {
      db = withCode(fields);
      const r = await read();
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { success: true, enabled: true, message: 'Diwali: 20% OFF bridal sets', code: 'DIWALI20', active });
    });
  }

  test('one read a minute, shared; after the minute a change shows; a failure isn’t cached', async () => {
    db = withCode({});
    let reads = 0;
    const col = db.collection.bind(db);
    db.collection = (n) => { if (n === 'settings') reads += 1; return col(n); };
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      const burst = await Promise.all([read(), read(), read()]);
      assert.deepEqual(burst.map((r) => r.json.active), [true, true, true]);
      assert.equal(reads, 1, 'in-flight read shared');
      db.store.get('coupons').get('d').isActive = false; // the owner switches the code off
      now += 59_000;
      assert.equal((await read()).json.active, true, 'still the cached answer');
      assert.equal(reads, 1);
      now += 2_000;
      assert.equal((await read()).json.active, false, 'the next minute reads again');
      assert.equal(reads, 2);

      now += 61_000;
      db.collection = (n) => (n === 'settings' ? { doc: () => ({ get: async () => { throw new Error('UNAVAILABLE'); } }) } : col(n));
      const bad = await quietly(read);
      assert.equal(bad.status, 500);
      assert.equal(bad.json.active, false, 'the strip keeps its tagline');
      db.collection = (n) => { if (n === 'settings') reads += 1; return col(n); };
      assert.equal((await read()).status, 200, 'the failure was not cached');
    } finally {
      Date.now = realNow;
    }
  });
});
