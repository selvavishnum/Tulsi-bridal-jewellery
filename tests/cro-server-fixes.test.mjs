/* ─────────────────────────────────────────────
   Checkout money rules — the server side, through the REAL route handlers:

     POST /api/orders                 coupon as shown (409 COUPON_CHANGED),
                                      abandoned online attempts never cost
                                      the coupon or the parked loyalty
                                      discount, first-order-only hardening
     POST /api/coupons/validate       same rules + the discount formula
     PUT  /api/orders/[id]            the customer gives up an unpaid
                                      online attempt (coupon + points back)
     POST /api/payments/create-order  pay again = the same Razorpay order
     PUT  /api/coupons/[id]           Max Discount / Valid From / Unlimited
     GET  /api/announcement           the welcome strip only for a live code

   The guiding rule: a customer is never charged a different amount from
   the one shown on the Place-order button, and an abandoned online payment
   never costs them their coupon or loyalty discount.

   Only the edges are fakes: the NextAuth session, Firestore (in-memory),
   email, WhatsApp and the Razorpay SDK.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore, INC } from './helpers/fakeFirestore.mjs';
import { parseCouponInput, couponDiscountFor, couponStateRefusal, phone10 } from '../src/lib/coupons.js';

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

/* Razorpay SDK stand-in: each test sets `rzp` (what orders.create/fetch do). */
let rzp;
const rzpCalls = [];
class FakeRazorpay {
  constructor() {
    this.orders = {
      create: async (o) => { rzpCalls.push(['create', o]); return rzp.create(o); },
      fetch: async (id) => { rzpCalls.push(['fetch', id]); return rzp.fetch(id); },
    };
  }
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
const [orders, orderById, validate, createOrder, couponById, announcement] = await Promise.all([
  route('orders'), route('orders/[id]'), route('coupons/validate'), route('payments/create-order'), route('coupons/[id]'), route('announcement'),
]);

let ipN = 0;
const freshIp = () => { ipN += 1; return `10.9.${Math.floor(ipN / 250)}.${(ipN % 250) + 1}`; };
async function call(mod, method, body, params = {}) {
  const res = await mod[method](new Request('http://tulsi.test/api', {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }), { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json(), headers: res.headers };
}
const post = (body) => call(orders, 'POST', body);
const check = (code, orderAmount = 1500) => call(validate, 'POST', { code, orderAmount });
const quietly = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

const NEW = { id: 'u-new', email: 'new@x.test', emailVerified: true };
const ADDRESS = { fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' };
/* Defaults: shipping ₹99 below ₹2,000; no COD fee above ₹500. */
const order = (extra = {}) => ({ items: [{ product: 'p1', quantity: 1 }], shippingAddress: ADDRESS, payment: { method: 'cod' }, couponCode: 'TULSI10', ...extra });
const online = (extra = {}) => order({ payment: { method: 'razorpay' }, ...extra });
const coupon = (id = 'welcome') => db.store.get('coupons').get(id);
const orderDocs = () => [...(db.store.get('orders')?.values() || [])];
const orderDoc = (id) => db.store.get('orders').get(id);
const user = (id) => db.store.get('users').get(id);

const COUPON = { type: 'percentage', maxUses: 0, usedCount: 0, usedBy: [], isActive: true, minOrderAmount: 0, expiresAt: null };

beforeEach(() => {
  session = null;
  rzpCalls.length = 0;
  rzp = {
    create: async (o) => ({ id: `order_rzp${rzpCalls.length}`, entity: 'order', amount: o.amount, currency: 'INR', receipt: o.receipt, status: 'created' }),
    fetch: async (id) => ({ id, entity: 'order', amount: 144900, currency: 'INR', status: 'attempted' }),
  };
  db = fakeFirestore({
    products: {
      p1: { name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 50, isActive: true },
      big: { name: 'Bridal Set', price: 150000, stock: 2, isActive: true },
    },
    coupons: {
      welcome: { ...COUPON, code: 'TULSI10', value: 10, firstOrderOnly: true },
      once: { ...COUPON, code: 'ONCE100', type: 'fixed', value: 100 },
      big: { ...COUPON, code: 'BIG500', type: 'fixed', value: 500, minOrderAmount: 5000 },
    },
    orders: {},
    users: { 'u-new': { email: 'new@x.test', pendingLoyaltyDiscount: 0 } },
    settings: { site: {} },
  });
});

/* ══ Abandoned online attempt → the retry keeps the coupon and the points ══ */

describe('an abandoned Razorpay attempt never costs the coupon or the parked loyalty discount', () => {
  test('retry as COD (or online again): same discount; one usedBy entry, counted once', async () => {
    signInAs(NEW);
    const first = await post(online({ couponDiscount: 150 }));
    assert.equal(first.status, 201);
    assert.equal(first.json.data.total, 1449);
    assert.deepEqual(coupon().usedBy, ['u:u-new']);
    assert.equal(coupon().usedCount, 1);

    /* The modal was closed: the code still validates for this customer. */
    const v = await check('TULSI10');
    assert.equal(v.status, 200);
    assert.equal(v.json.data.discount, 150);

    const retry = await post(order({ couponDiscount: 150 }));
    assert.equal(retry.status, 201, retry.json.message);
    assert.equal(retry.json.data.discount, 150);
    assert.equal(retry.json.data.total, 1449, 'charged what the button said');
    assert.equal(retry.json.data.couponCode, 'TULSI10');
    assert.deepEqual(coupon().usedBy, ['u:u-new'], 'no duplicate entry');
    assert.equal(coupon().usedCount, 1, 'the same customer is never counted twice');
    /* The abandoned attempt no longer holds the use: cancelling it later
       doesn't give back the use the COD order now holds. */
    assert.equal(orderDoc(first.json.data.id).couponReleased, true);
    assert.equal(orderDoc(first.json.data.id).couponMovedTo, retry.json.data.id);

    signInAs({ id: 'owner', email: 'owner@tulsi.test' });
    assert.equal((await call(orderById, 'PUT', { status: 'cancelled' }, { id: first.json.data.id })).status, 200);
    assert.deepEqual(coupon().usedBy, ['u:u-new']);
    assert.equal(coupon().usedCount, 1);

    /* Now a real (COD) order holds it: the next order doesn't get it. */
    signInAs(NEW);
    const third = await post(order({ couponDiscount: 150 }));
    assert.equal(third.status, 409);
    assert.equal(third.json.code, 'COUPON_CHANGED');
    assert.equal(third.json.reason, 'first_order_only');
    assert.equal(third.json.couponApplied, false);
  });

  test('an ordinary once-per-customer code: abandoned attempt → retry keeps it; after a placed order validate says used', async () => {
    signInAs(NEW);
    assert.equal((await post(online({ couponCode: 'ONCE100', couponDiscount: 100 }))).json.data.discount, 100);
    assert.equal((await post(online({ couponCode: 'ONCE100', couponDiscount: 100 }))).json.data.discount, 100, 'online retry');
    assert.equal(coupon('once').usedCount, 1);
    assert.equal((await post(order({ couponCode: 'ONCE100', couponDiscount: 100 }))).json.data.discount, 100, 'COD');
    assert.equal(coupon('once').usedCount, 1);
    assert.deepEqual(coupon('once').usedBy, ['u:u-new']);
    const v = await check('ONCE100');
    assert.equal(v.status, 400);
    assert.deepEqual(v.json, { success: false, code: 'COUPON_USED', message: 'You have already used this coupon.' });
    const again = await post(order({ couponCode: 'ONCE100', couponDiscount: 100 }));
    assert.equal(again.status, 409);
    assert.equal(again.json.reason, 'used');
    /* An older page (no couponDiscount): left off, as before. */
    const legacy = await post(order({ couponCode: 'ONCE100' }));
    assert.equal(legacy.status, 201);
    assert.equal(legacy.json.data.discount, 0);
  });

  test('use limit reached by this very customer’s abandoned attempt: their retry still gets it', async () => {
    Object.assign(coupon('once'), { maxUses: 1 });
    signInAs(NEW);
    assert.equal((await post(online({ couponCode: 'ONCE100', couponDiscount: 100 }))).status, 201);
    assert.equal(coupon('once').usedCount, 1);
    const retry = await post(order({ couponCode: 'ONCE100', couponDiscount: 100 }));
    assert.equal(retry.status, 201, retry.json.message);
    assert.equal(retry.json.data.discount, 100);
    signInAs({ id: 'u-other', email: 'other@x.test', emailVerified: true });
    assert.equal((await check('ONCE100')).json.message, 'Coupon usage limit reached');
  });

  test('parked loyalty discount spent by the abandoned attempt is handed to the retry, once', async () => {
    user('u-new').pendingLoyaltyDiscount = 100;
    signInAs(NEW);
    const first = await post(online({ couponCode: undefined }));
    assert.equal(first.json.data.loyaltyDiscount, 100);
    assert.equal(user('u-new').pendingLoyaltyDiscount, 0);

    const retry = await post(order({ couponCode: undefined }));
    assert.equal(retry.status, 201);
    assert.equal(retry.json.data.loyaltyDiscount, 100, 'the Points Discount row still holds');
    assert.equal(retry.json.data.total, 1500 - 100 + 99);
    assert.equal(user('u-new').pendingLoyaltyDiscount, 0);
    assert.equal(orderDoc(first.json.data.id).loyaltyRestored, true);
    assert.equal(orderDoc(first.json.data.id).loyaltyMovedTo, retry.json.data.id);

    /* Cancelling the old attempt doesn't hand it back a second time; the
       COD order is placed, so there is nothing more to take over. */
    signInAs({ id: 'owner', email: 'owner@tulsi.test' });
    await call(orderById, 'PUT', { status: 'cancelled' }, { id: first.json.data.id });
    assert.equal(user('u-new').pendingLoyaltyDiscount, 0);
    signInAs(NEW);
    assert.equal((await post(order({ couponCode: undefined }))).json.data.loyaltyDiscount, 0);
  });

  test('only what the retry can use is taken; the rest stays parked', async () => {
    user('u-new').pendingLoyaltyDiscount = 250;
    signInAs(NEW);
    /* ₹1,500 × 2 = ₹3,000: loyalty capped at 20% = ₹600 → all 250 used. */
    const first = await post(online({ couponCode: undefined, items: [{ product: 'p1', quantity: 2 }] }));
    assert.equal(first.json.data.loyaltyDiscount, 250);
    /* Retry on one piece (₹1,500): cap ₹300 → 250 used again. */
    const retry = await post(order({ couponCode: undefined }));
    assert.equal(retry.json.data.loyaltyDiscount, 250);
    assert.equal(user('u-new').pendingLoyaltyDiscount, 0);
    user('u-new').pendingLoyaltyDiscount = 0;
    /* A paid online order is never taken over. */
    db.store.get('orders').set('paidOne', { userId: 'u-new', status: 'pending', loyaltyDiscount: 80, payment: { method: 'razorpay', status: 'paid' } });
    assert.equal((await post(order({ couponCode: undefined }))).json.data.loyaltyDiscount, 0);
  });
});

/* ══ Contract 2: the coupon discount as shown, or 409 COUPON_CHANGED ══ */

describe('POST /api/orders with couponDiscount', () => {
  const RETURNING = { id: 'u-old', email: 'old@x.test', emailVerified: true };
  beforeEach(() => {
    db.store.get('orders').set('paid', { userId: 'u-old', guestEmail: 'old@x.test', status: 'delivered', payment: { method: 'razorpay', status: 'paid' } });
  });

  test('refused (returning customer): 409, nothing created, the coupon untouched', async () => {
    signInAs(RETURNING);
    const r = await post(order({ couponDiscount: 150 }));
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, {
      success: false, code: 'COUPON_CHANGED', couponApplied: false, discount: 0, reason: 'first_order_only',
      message: 'This code is for your first order only. Please check your total and place the order again.',
    });
    assert.equal(orderDocs().length, 1);
    assert.equal(coupon().usedCount, 0);
  });

  test('a different amount (stale basket): 409 with the server’s discount, couponApplied true', async () => {
    signInAs(NEW);
    const r = await post(order({ couponDiscount: 450 }));
    assert.equal(r.status, 409);
    assert.equal(r.json.couponApplied, true);
    assert.equal(r.json.discount, 150);
    assert.equal(r.json.reason, 'amount_changed');
    assert.match(r.json.message, /TULSI10 now takes ₹150 off this order \(not ₹450\)/);
    assert.equal(orderDocs().length, 1);
  });

  test('within ₹1: accepted; the shown 0 for a refused code: accepted at full price', async () => {
    signInAs(NEW);
    assert.equal((await post(order({ couponDiscount: 150.4 }))).status, 201);
    signInAs(RETURNING);
    const r = await post(order({ couponDiscount: 0 }));
    assert.equal(r.status, 201);
    assert.equal(r.json.data.total, 1599);
  });

  test('every refusal reason', async () => {
    signInAs(NEW);
    db.store.get('coupons').set('exp', { ...COUPON, code: 'GONE', value: 5, expiresAt: '2020-01-01T00:00:00.000Z' });
    db.store.get('coupons').set('off', { ...COUPON, code: 'OFF5', value: 5, isActive: false });
    db.store.get('coupons').set('later', { ...COUPON, code: 'LATER5', value: 5, startsAt: '2099-01-01T00:00:00.000Z' });
    db.store.get('coupons').set('full', { ...COUPON, code: 'FULL5', value: 5, maxUses: 2, usedCount: 2 });
    const cases = [['NOPE', 'not_found'], ['GONE', 'expired'], ['OFF5', 'inactive'], ['LATER5', 'not_started'], ['FULL5', 'limit'], ['BIG500', 'min_order']];
    for (const [code, reason] of cases) {
      const r = await post(order({ couponCode: code, couponDiscount: 75 }));
      assert.equal(r.status, 409, code);
      assert.equal(r.json.reason, reason, code);
      assert.equal(r.json.couponApplied, false, code);
      assert.equal(r.json.discount, 0, code);
      assert.ok(r.json.message.length > 10, code);
    }
    assert.match((await post(order({ couponCode: 'BIG500', couponDiscount: 500 }))).json.message, /Minimum order amount is ₹5,000/);
    assert.equal(orderDocs().length, 1, 'only the seeded order');
  });

  test('no couponDiscount (an older page): today’s behaviour — refused code left off, 201', async () => {
    signInAs(RETURNING);
    const r = await post(order());
    assert.equal(r.status, 201);
    assert.equal(r.json.data.discount, 0);
    assert.equal(r.json.data.couponCode, null);
  });

  test('a first-order lookup failure: 409 check_failed (try again), never a silent full price', async () => {
    signInAs(NEW);
    const realCollection = db.collection;
    db.collection = (name) => {
      const col = realCollection(name);
      if (name !== 'orders') return col;
      return { ...col, where: () => ({ select: () => ({ limit: () => ({ get: async () => { throw new Error('UNAVAILABLE'); } }) }), where: () => { throw new Error('UNAVAILABLE'); } }) };
    };
    const r = await quietly(() => post(order({ couponDiscount: 150 })));
    assert.equal(r.status, 409);
    assert.equal(r.json.reason, 'check_failed');
    assert.match(r.json.message, /try again/i);
  });

  test('the coupon changes between the check and the commit: 409 (400 for an older page), nothing created', async () => {
    signInAs(NEW);
    const realTx = db.runTransaction.bind(db);
    db.runTransaction = (fn) => { coupon().isActive = false; return realTx(fn); };
    const r = await post(order({ couponDiscount: 150 }));
    assert.equal(r.status, 409);
    assert.equal(r.json.reason, 'inactive');
    coupon().isActive = true;
    const legacy = await post(order());
    assert.equal(legacy.status, 400);
    assert.equal(legacy.json.message, 'This coupon is no longer available. Remove it and try again.');
    assert.equal(orderDocs().length, 1, 'only the seeded order');
    assert.equal(coupon().usedCount, 0);
  });
});

/* ══ First-order-only hardening (server/C, server/G) ══ */

describe('first-order-only: who counts as a first-time customer', () => {
  test('never without a signed-in account (sessionless API order)', async () => {
    signInAs(null);
    const r = await post(order({ guestEmail: 'a1@fake.test', couponDiscount: 150 }));
    assert.equal(r.status, 409);
    assert.equal(r.json.reason, 'sign_in_required');
    const legacy = await post(order({ guestEmail: 'a2@fake.test' }));
    assert.equal(legacy.status, 201);
    assert.equal(legacy.json.data.discount, 0);
  });

  test('a placed order to the same delivery phone (raw or last 10 digits) is not a first order', async () => {
    /* The fake doesn't resolve dotted where() paths: mirror the field. */
    db.store.get('orders').set('byPhone', { userId: 'u-someone', guestEmail: 'x@x.test', status: 'pending', payment: { method: 'cod', status: 'pending' }, shippingAddress: { phone: '9876543210' }, 'shippingAddress.phone': '9876543210' });
    signInAs({ id: 'u-fresh', email: 'fresh@x.test', emailVerified: false });
    const r = await post(order({ shippingAddress: { ...ADDRESS, phone: '+91 98765 43210' }, couponDiscount: 150 }));
    assert.equal(r.status, 409);
    assert.equal(r.json.reason, 'first_order_only');
    const other = await post(order({ shippingAddress: { ...ADDRESS, phone: '9123456780' }, couponDiscount: 150 }));
    assert.equal(other.status, 201);
    assert.equal(other.json.data.discount, 150);
  });

  test('an unverified account is matched by account and phone only — no order-history oracle by email', async () => {
    db.store.get('orders').set('g1', { userId: null, guestEmail: 'victim@x.test', status: 'pending', payment: { method: 'cod', status: 'pending' } });
    signInAs({ id: 'u-attacker', email: 'victim@x.test', emailVerified: false });
    const v = await check('TULSI10');
    assert.equal(v.status, 200, 'the victim’s guest order is not revealed');
    signInAs({ id: 'u-victim', email: 'victim@x.test', emailVerified: true });
    assert.equal((await check('TULSI10')).json.code, 'FIRST_ORDER_ONLY', 'the proven owner of the email is matched');
  });

  test('a gift shipped to the bride’s email doesn’t block her own first order', async () => {
    signInAs({ id: 'u-buyer', email: 'buyer@x.test', emailVerified: true });
    const gift = await post(order({ couponCode: undefined, shippingAddress: { ...ADDRESS, phone: '9000000002', email: 'bride@x.test' } }));
    assert.equal(gift.status, 201);
    const stored = orderDocs()[0];
    stored['shippingAddress.email'] = stored.shippingAddress.email; // as real Firestore would resolve it
    signInAs({ id: 'u-bride', email: 'bride@x.test', emailVerified: true });
    assert.equal((await check('TULSI10')).status, 200);
    const mine = await post(order({ shippingAddress: { ...ADDRESS, phone: '9000000003' }, couponDiscount: 150 }));
    assert.equal(mine.status, 201);
    assert.equal(mine.json.data.discount, 150);
  });
});

/* ══ Contract 1: /api/coupons/validate answer ══ */

describe('validate: the coupon and the discount formula', () => {
  test('coupon carries type, value, minOrderAmount, maxDiscount; discount = couponDiscountFor', async () => {
    Object.assign(coupon('big'), { type: 'percentage', value: 20, maxDiscount: 1500 });
    signInAs(NEW);
    const r = await check('BIG500', 20000);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.coupon, { id: 'big', code: 'BIG500', type: 'percentage', value: 20, minOrderAmount: 5000, maxDiscount: 1500, firstOrderOnly: false });
    assert.equal(r.json.data.discount, 1500, '20% of ₹20,000 capped at ₹1,500');
    assert.equal(r.json.data.discount, couponDiscountFor(r.json.data.coupon, 20000));
    const low = await check('BIG500', 4000);
    assert.equal(low.status, 400);
    assert.match(low.json.message, /Minimum order/);
  });

  test('before Valid From: refused', async () => {
    coupon().startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const r = await check('TULSI10');
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'This coupon isn’t active yet');
  });
});

/* ══ Max Discount, Valid From, Unlimited (server/F, server/B) ══ */

describe('admin coupon fields actually work', () => {
  const owner = () => signInAs({ id: 'owner', email: 'owner@tulsi.test' });

  test('parseCouponInput: blank usage limit = unlimited (0); cap and start date stored; cleared with ""', () => {
    const base = { code: 'tulsi10', type: 'percentage', value: 10 };
    assert.equal(parseCouponInput(base).data.maxUses, 0);
    assert.equal(parseCouponInput({ ...base, usageLimit: '' }).data.maxUses, 0);
    assert.equal(parseCouponInput({ ...base, usageLimit: 50 }).data.maxUses, 50);
    assert.ok(parseCouponInput({ ...base, usageLimit: -1 }).error);
    assert.ok(parseCouponInput({ ...base, usageLimit: 2.5 }).error);
    assert.deepEqual(parseCouponInput({ usageLimit: '' }, { partial: true }).data, { maxUses: 0 }, 'an edit can clear the limit');
    assert.deepEqual(parseCouponInput({ value: 5 }, { partial: true }).data, { value: 5 }, 'left alone unless sent');

    const p = parseCouponInput({ ...base, maxDiscount: 500, validFrom: '2026-12-01', validUntil: '2026-12-31' }).data;
    assert.equal(p.maxDiscount, 500);
    assert.equal(p.startsAt, '2026-11-30T18:30:00.000Z', 'midnight in India');
    assert.equal(parseCouponInput(base).data.maxDiscount, null);
    assert.equal(parseCouponInput(base).data.startsAt, null);
    assert.equal(parseCouponInput({ ...base, maxDiscount: 0 }).data.maxDiscount, null, '0 = no cap');
    assert.ok(parseCouponInput({ ...base, maxDiscount: -5 }).error);
    assert.ok(parseCouponInput({ ...base, validFrom: 'soon' }).error);
    assert.ok(parseCouponInput({ ...base, validFrom: '2027-01-02', validUntil: '2027-01-01' }).error);
    assert.deepEqual(parseCouponInput({ maxDiscount: '', validFrom: '' }, { partial: true }).data, { maxDiscount: null, startsAt: null });
  });

  test('saved through PUT /api/coupons/[id], then applied by checkout (cap) and refused before the start', async () => {
    owner();
    const put = await call(couponById, 'PUT', { maxDiscount: 500, usageLimit: '' }, { id: 'welcome' });
    assert.equal(put.status, 200);
    assert.equal(coupon().maxDiscount, 500);
    assert.equal(coupon().maxUses, 0);
    signInAs({ id: 'u-rich', email: 'rich@x.test', emailVerified: true });
    const r = await post(online({ items: [{ product: 'big', quantity: 1 }], couponDiscount: 500 }));
    assert.equal(r.status, 201, r.json.message);
    assert.equal(r.json.data.discount, 500, 'not ₹15,000');

    owner();
    await call(couponById, 'PUT', { validFrom: '2099-01-01', maxDiscount: '' }, { id: 'welcome' });
    assert.equal(coupon().maxDiscount, null);
    signInAs({ id: 'u-early', email: 'early@x.test', emailVerified: true });
    const early = await post(order({ couponDiscount: 150 }));
    assert.equal(early.status, 409);
    assert.equal(early.json.reason, 'not_started');
  });

  test('unlimited (0) is never "used up", however many orders', async () => {
    Object.assign(coupon('once'), { maxUses: 0, usedCount: 5000 });
    signInAs(NEW);
    assert.equal((await post(order({ couponCode: 'ONCE100', couponDiscount: 100 }))).status, 201);
    assert.equal(couponStateRefusal({ isActive: true, maxUses: 0, usedCount: 1e6 }), null);
    assert.equal(couponStateRefusal({ isActive: true, maxUses: 3, usedCount: 3 }), 'limit');
    assert.equal(couponStateRefusal({ isActive: true, maxUses: 3, usedCount: 3 }, { ownUseCounted: true }), null);
  });

  test('phone10', () => {
    assert.equal(phone10('+91 98765-43210'), '9876543210');
    assert.equal(phone10('09876543210'), '9876543210');
    assert.equal(phone10('98765'), '');
    assert.equal(phone10(null), '');
  });
});

/* ══ Contract 3: the customer gives up an unpaid online attempt ══ */

describe('PUT /api/orders/[id] { status: "cancelled" } by the customer', () => {
  test('their own unpaid online order: cancelled; coupon use and parked points handed back', async () => {
    user('u-new').pendingLoyaltyDiscount = 100;
    signInAs(NEW);
    const first = await post(online({ couponDiscount: 150 }));
    assert.equal(first.json.data.loyaltyDiscount, 100);
    assert.equal(coupon().usedCount, 1);

    signInAs({ id: 'u-other', email: 'other@x.test', emailVerified: true });
    assert.equal((await call(orderById, 'PUT', { status: 'cancelled' }, { id: first.json.data.id })).status, 403, 'not theirs');

    signInAs(NEW);
    const c = await call(orderById, 'PUT', { status: 'cancelled' }, { id: first.json.data.id });
    assert.equal(c.status, 200);
    assert.equal(c.json.data.status, 'cancelled');
    assert.deepEqual(coupon().usedBy, []);
    assert.equal(coupon().usedCount, 0);
    assert.equal(user('u-new').pendingLoyaltyDiscount, 100);

    /* The COD retry then gets both, counted once. */
    const cod = await post(order({ couponDiscount: 150 }));
    assert.equal(cod.status, 201);
    assert.equal(cod.json.data.discount, 250);
    assert.deepEqual(coupon().usedBy, ['u:u-new']);
    assert.equal(coupon().usedCount, 1);
    assert.equal(user('u-new').pendingLoyaltyDiscount, 0);
  });

  test('never cancels an order Razorpay has just been paid for (late UPI approval)', async () => {
    signInAs(NEW);
    const first = await post(online({ couponDiscount: 150 }));
    await call(createOrder, 'POST', { orderId: first.json.data.id });
    rzp.fetch = async (id) => ({ id, amount: 144900, status: 'paid' });
    const c = await call(orderById, 'PUT', { status: 'cancelled' }, { id: first.json.data.id });
    assert.equal(c.status, 409);
    assert.equal(c.json.code, 'ALREADY_PAID');
    assert.equal(orderDoc(first.json.data.id).status, 'pending');
    assert.equal(coupon().usedCount, 1);
  });
});

/* ══ Contract 4: pay again for the same unpaid order ══ */

describe('POST /api/payments/create-order again for the same unpaid order', () => {
  test('returns the same Razorpay order (current total), so a late payment on the first window still matches', async () => {
    signInAs(NEW);
    const o = await post(online({ couponDiscount: 150 }));
    const id = o.json.data.id;
    const a = await call(createOrder, 'POST', { orderId: id });
    assert.equal(a.status, 200);
    assert.equal(a.json.data.amount, 144900);
    const rzpId = a.json.data.id;
    assert.equal(orderDoc(id).payment.razorpayOrderId, rzpId);

    const b = await call(createOrder, 'POST', { orderId: id });
    assert.equal(b.status, 200);
    assert.equal(b.json.data.id, rzpId);
    assert.equal(b.json.data.amount, 144900);
    assert.equal(rzpCalls.filter(([k]) => k === 'create').length, 1, 'no second Razorpay order');
    assert.equal(orderDoc(id).payment.razorpayOrderId, rzpId);

    /* Razorpay unreachable for the re-read: still the same order. */
    rzp.fetch = async () => { throw new Error('ETIMEDOUT'); };
    const c = await quietly(() => call(createOrder, 'POST', { orderId: id }));
    assert.equal(c.status, 200);
    assert.deepEqual([c.json.data.id, c.json.data.amount, c.json.data.currency], [rzpId, 144900, 'INR']);

    /* Paid there, not yet here (webhook on its way): no second payment. */
    rzp.fetch = async (rid) => ({ id: rid, amount: 144900, status: 'paid' });
    const d = await call(createOrder, 'POST', { orderId: id });
    assert.equal(d.status, 409);
    assert.equal(d.json.code, 'ALREADY_PAID');
  });
});

/* ══ GET /api/announcement (server/D) ══ */

describe('GET /api/announcement', () => {
  const get = () => announcement.GET(new Request('http://tulsi.test/api/announcement'));
  const read = async () => { const r = await get(); return { status: r.status, cc: r.headers.get('cache-control'), json: await r.json() }; };
  const site = (a) => db.store.get('settings').set('site', { announcement: a });

  test('not configured: the default TULSI10 offer is only active when that coupon really works', async () => {
    let r = await read();
    assert.deepEqual(r.json, { success: true, enabled: true, message: 'Welcome Offer: Flat 10% OFF on your first jewellery order', code: 'TULSI10', active: true });
    assert.equal(r.cc, 'public, max-age=60');
    for (const change of [{ isActive: false }, { expiresAt: '2020-01-01T00:00:00.000Z' }, { startsAt: '2099-01-01T00:00:00.000Z' }, { maxUses: 3, usedCount: 3 }]) {
      db = fakeFirestore({ coupons: { welcome: { ...COUPON, code: 'TULSI10', value: 10, ...change } }, settings: { site: {} } });
      r = await read();
      assert.equal(r.json.active, false, JSON.stringify(change));
    }
    db = fakeFirestore({ coupons: {}, settings: { site: {} } });
    assert.equal((await read()).json.active, false, 'no such coupon');
  });

  test('switched off: inactive, without looking at coupons; no code: just the message', async () => {
    site({ enabled: false, message: 'Diwali sale', code: 'TULSI10' });
    let reads = 0;
    const col = db.collection.bind(db);
    db.collection = (n) => { if (n === 'coupons') reads += 1; return col(n); };
    assert.deepEqual((await read()).json, { success: true, enabled: false, message: 'Diwali sale', code: 'TULSI10', active: false });
    assert.equal(reads, 0);
    db = fakeFirestore({ settings: { site: { announcement: { enabled: true, message: 'Free gift wrap', code: '' } } } });
    assert.deepEqual((await read()).json, { success: true, enabled: true, message: 'Free gift wrap', code: '', active: true });
  });

  test('one read a minute per instance, shared by every visitor; a failure is not cached', async () => {
    let reads = 0;
    const col = db.collection.bind(db);
    db.collection = (n) => { if (n === 'settings') reads += 1; return col(n); };
    await Promise.all([read(), read(), read()]);
    await read();
    assert.equal(reads, 1);

    db = fakeFirestore({});
    let fail = true;
    const col2 = db.collection.bind(db);
    db.collection = (n) => (fail && n === 'settings' ? { doc: () => ({ get: async () => { throw new Error('UNAVAILABLE'); } }) } : col2(n));
    const bad = await quietly(read);
    assert.equal(bad.status, 500);
    assert.equal(bad.json.active, false);
    assert.equal(bad.cc, 'no-store');
    fail = false;
    assert.equal((await read()).json.success, true, 'the next request reads again');
  });
});
