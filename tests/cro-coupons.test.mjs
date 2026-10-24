/* ─────────────────────────────────────────────
   Welcome offer (TULSI10) — first-order-only coupons through the REAL
   route handlers:
     POST /api/coupons/validate   (cart / checkout / Buy Now drawer preview)
     POST /api/orders             (the decision: discount applied or not)

   Only the edges are swapped out (as in store-charges.test.mjs): the
   NextAuth session, the nextauth route's authOptions, Firestore (in-memory
   fake), email and WhatsApp. Each request comes from its own IP so the
   coupon-check rate limit (20 an hour per IP) never interferes.

   Also checks the client side of the contract against the real endpoint:
   validateCoupon() (src/components/checkout/validateCoupon.js) classifies
   the first-order refusal as definite (the remembered code is forgotten),
   and the Buy Now drawer's summary (checkoutRules) shows exactly the total
   the server charges.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore, INC } from './helpers/fakeFirestore.mjs';
import { checkoutAmounts, couponDiscountFor, unitPriceOf } from '../src/components/checkout/checkoutRules.js';
import { validateCoupon } from '../src/components/checkout/validateCoupon.js';

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
const [orders, validate] = await Promise.all([route('orders'), route('coupons/validate')]);

let ipN = 0;
const freshIp = () => { ipN += 1; return `10.7.${Math.floor(ipN / 250)}.${(ipN % 250) + 1}`; };
async function call(mod, body) {
  const res = await mod.POST(new Request('http://tulsi.test/api', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() }, body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json() };
}
const check = (code, orderAmount = 2000) => call(validate, { code, orderAmount });
const quietly = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

/* ── Customers ── */
const NEW = { id: 'u-new', email: 'new@x.test', emailVerified: true };            // no orders at all
const RETURNING = { id: 'u-old', email: 'old@x.test', emailVerified: true };      // a paid, delivered order
const COD_BUYER = { id: 'u-cod', email: 'cod@x.test', emailVerified: true };      // a COD order (not yet delivered)
const TRIED = { id: 'u-try', email: 'try@x.test', emailVerified: true };          // only an abandoned online attempt + a cancelled order
const SAME_EMAIL = { id: 'u-fresh', email: 'guestbuyer@x.test', emailVerified: true }; // new account, earlier guest COD order on that email

const ADDRESS = { fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' };
/* What the Buy Now drawer posts: one line, the fees it showed, the code. */
const buyNow = (extra = {}) => ({ items: [{ product: 'p1', quantity: 1 }], shippingAddress: ADDRESS, payment: { method: 'cod' }, couponCode: 'TULSI10', ...extra });
const coupon = (id) => db.store.get('coupons').get(id);
const orderDocs = () => [...(db.store.get('orders')?.values() || [])];

const COUPON = { type: 'percentage', maxUses: 1000, usedCount: 0, usedBy: [], isActive: true, minOrderAmount: 0, expiresAt: null };

beforeEach(() => {
  session = null;
  db = fakeFirestore({
    products: {
      p1: { name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 5, isActive: true },
    },
    coupons: {
      welcome: { ...COUPON, code: 'TULSI10', value: 10, firstOrderOnly: true },
      fest: { ...COUPON, code: 'FEST5', value: 5 },
      bigfirst: { ...COUPON, code: 'BIGFIRST', value: 500, type: 'fixed', minOrderAmount: 5000, firstOrderOnly: true },
      off: { ...COUPON, code: 'OLDFIRST', value: 10, isActive: false, firstOrderOnly: true },
    },
    orders: {
      paid: { orderNumber: 'TBJ1', userId: 'u-old', guestEmail: 'old@x.test', status: 'delivered', payment: { method: 'razorpay', status: 'paid' }, createdAt: '2026-09-01T10:00:00.000Z' },
      cod: { orderNumber: 'TBJ2', userId: 'u-cod', guestEmail: 'cod@x.test', status: 'processing', payment: { method: 'cod', status: 'pending' }, createdAt: '2026-10-01T10:00:00.000Z' },
      abandoned: { orderNumber: 'TBJ3', userId: 'u-try', guestEmail: 'try@x.test', status: 'pending', payment: { method: 'razorpay', status: 'pending' }, createdAt: '2026-10-02T10:00:00.000Z' },
      cancelled: { orderNumber: 'TBJ4', userId: 'u-try', guestEmail: 'try@x.test', status: 'cancelled', payment: { method: 'cod', status: 'pending' }, createdAt: '2026-10-03T10:00:00.000Z' },
      guest: { orderNumber: 'TBJ5', userId: null, guestEmail: 'guestbuyer@x.test', status: 'pending', payment: { method: 'cod', status: 'pending' }, createdAt: '2026-10-04T10:00:00.000Z' },
    },
    users: { 'u-new': { email: 'new@x.test' }, 'u-old': { email: 'old@x.test' } },
    settings: { site: {} },
  });
});

/* ══ POST /api/coupons/validate ══ */

describe('validate: first-order-only coupon', () => {
  test('signed-in first-timer: the discount, flagged firstOrderOnly', async () => {
    signInAs(NEW);
    const r = await check('TULSI10', 2000);
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
    assert.equal(r.json.data.discount, 200);
    assert.equal(r.json.data.firstOrderOnly, true);
    assert.deepEqual(r.json.data.coupon, { id: 'welcome', code: 'TULSI10', type: 'percentage', value: 10, minOrderAmount: 0, maxDiscount: null, firstOrderOnly: true }, 'no usage bookkeeping leaks');
  });

  test('a cancelled order or an abandoned online payment does not make a returning customer', async () => {
    signInAs(TRIED);
    const r = await check('TULSI10', 1500);
    assert.equal(r.status, 200);
    assert.equal(r.json.data.discount, 150);
  });

  test('signed-in repeat customer (paid order, or a COD order): 400 with the reason and FIRST_ORDER_ONLY', async () => {
    for (const user of [RETURNING, COD_BUYER]) {
      signInAs(user);
      const r = await check('tulsi10', 2000);
      assert.equal(r.status, 400, user.id);
      assert.deepEqual(r.json, { success: false, code: 'FIRST_ORDER_ONLY', message: 'This code is for your first order only.' });
    }
  });

  test('a new account whose email already has a guest order: refused (matched by email)', async () => {
    signInAs(SAME_EMAIL);
    const r = await check('TULSI10');
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'FIRST_ORDER_ONLY');
  });

  test('signed in with only an email (no account id): checked once the email is proven, never on an unverified one', async () => {
    signInAs({ email: 'old@x.test', emailVerified: true });
    assert.equal((await check('TULSI10')).json.code, 'FIRST_ORDER_ONLY');
    signInAs({ email: 'old@x.test' });
    assert.equal((await check('TULSI10')).status, 200, 'no order-history oracle for an unproven email');
  });

  test('signed out: a preview of the discount, flagged firstOrderOnly (checkout signs in and decides)', async () => {
    signInAs(null);
    const r = await check('TULSI10', 3000);
    assert.equal(r.status, 200);
    assert.equal(r.json.data.discount, 300);
    assert.equal(r.json.data.firstOrderOnly, true);
    assert.equal(r.json.data.coupon.firstOrderOnly, true);
  });

  test('the first-order check comes before the minimum: a returning customer is not asked to add more', async () => {
    signInAs(RETURNING);
    assert.equal((await check('BIGFIRST', 100)).json.code, 'FIRST_ORDER_ONLY');
    signInAs(NEW);
    const r = await check('BIGFIRST', 100);
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'Minimum order amount is ₹5000');
    assert.equal(r.json.code, undefined);
    assert.equal((await check('BIGFIRST', 6000)).json.data.discount, 500);
  });

  test('an inactive first-order code says inactive (no order lookup needed)', async () => {
    signInAs(RETURNING);
    const r = await check('OLDFIRST');
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'Coupon is inactive');
  });

  test('a first-order lookup that fails is a 500, never a free pass', async () => {
    signInAs(NEW);
    const realCollection = db.collection;
    db.collection = (name) => (name === 'orders' ? { where: () => { throw new Error('UNAVAILABLE'); } } : realCollection(name));
    const r = await check('TULSI10');
    assert.equal(r.status, 500);
    assert.equal(r.json.success, false);
  });
});

describe('validate: ordinary coupons are unchanged', () => {
  test('a returning customer still gets an ordinary code, flagged firstOrderOnly: false', async () => {
    signInAs(RETURNING);
    const r = await check('FEST5', 2000);
    assert.equal(r.status, 200);
    assert.equal(r.json.data.discount, 100);
    assert.equal(r.json.data.firstOrderOnly, false);
    assert.equal(r.json.data.coupon.firstOrderOnly, false);
  });

  test('signed out, lower-case code: same answer', async () => {
    assert.equal((await check('fest5', 1000)).json.data.discount, 50);
  });

  test('unknown, expired, used-up and missing codes keep their answers', async () => {
    db.store.get('coupons').set('exp', { ...COUPON, code: 'GONE', value: 5, expiresAt: '2020-01-01T00:00:00.000Z' });
    db.store.get('coupons').set('full', { ...COUPON, code: 'FULL', value: 5, maxUses: 3, usedCount: 3 });
    assert.deepEqual((await check('NOPE')).json, { success: false, message: 'Invalid coupon code' });
    assert.equal((await check('NOPE')).status, 404);
    assert.equal((await check('GONE')).json.message, 'Coupon has expired');
    assert.equal((await check('FULL')).json.message, 'Coupon usage limit reached');
    assert.equal((await call(validate, { orderAmount: 100 })).status, 400);
  });
});

/* ══ POST /api/orders ══ */

describe('orders: first-order-only coupon', () => {
  test('first order: the discount is applied, the use is counted for this customer', async () => {
    signInAs(NEW);
    const r = await call(orders, buyNow());
    assert.equal(r.status, 201);
    assert.equal(r.json.data.subtotal, 1500);
    assert.equal(r.json.data.discount, 150);
    assert.equal(r.json.data.couponCode, 'TULSI10');
    assert.equal(r.json.data.total, 1500 - 150 + 99, 'shipping ₹99 below ₹2,000; no COD fee above ₹500 (defaults)');
    assert.equal(coupon('welcome').usedCount, 1);
    assert.deepEqual(coupon('welcome').usedBy, ['u:u-new']);
  });

  test('repeat customer: the order still goes through, without the discount, and the use is not counted', async () => {
    for (const user of [RETURNING, COD_BUYER, SAME_EMAIL]) {
      signInAs(user);
      const r = await call(orders, buyNow());
      assert.equal(r.status, 201, user.id);
      assert.equal(r.json.data.discount, 0, user.id);
      assert.equal(r.json.data.couponCode, null, user.id);
      assert.equal(r.json.data.total, 1500 + 99, user.id);
    }
    assert.equal(coupon('welcome').usedCount, 0);
    assert.deepEqual(coupon('welcome').usedBy, []);
    const saved = orderDocs().filter((o) => o.userId === 'u-old' && o.orderNumber !== 'TBJ1');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].coupon, null);
    assert.equal(saved[0].couponUserKey, undefined);
  });

  test('a customer with only an abandoned online attempt and a cancelled order: still their first order', async () => {
    signInAs(TRIED);
    const r = await call(orders, buyNow());
    assert.equal(r.status, 201);
    assert.equal(r.json.data.discount, 150);
  });

  test('once a first order is placed (COD), the next one does not get it again', async () => {
    signInAs(NEW);
    assert.equal((await call(orders, buyNow())).json.data.discount, 150);
    const again = await call(orders, buyNow());
    assert.equal(again.status, 201);
    assert.equal(again.json.data.discount, 0);
    assert.equal(coupon('welcome').usedCount, 1);
  });

  test('an ordinary coupon still applies to a returning customer', async () => {
    signInAs(RETURNING);
    const r = await call(orders, buyNow({ couponCode: 'fest5' }));
    assert.equal(r.status, 201);
    assert.equal(r.json.data.discount, 75);
    assert.equal(r.json.data.couponCode, 'FEST5');
  });

  test('a guest (no session) never gets a first-order code, whatever the email; an ordinary code still applies', async () => {
    signInAs(null);
    const repeat = await call(orders, buyNow({ guestEmail: 'GuestBuyer@x.test' }));
    assert.equal(repeat.status, 201);
    assert.equal(repeat.json.data.discount, 0);
    const first = await call(orders, buyNow({ guestEmail: 'brand.new@x.test' }));
    assert.equal(first.status, 201);
    assert.equal(first.json.data.discount, 0, 'a fresh email is not a first order without an account');
    const fest = await call(orders, buyNow({ guestEmail: 'brand.new2@x.test', couponCode: 'FEST5' }));
    assert.equal(fest.json.data.discount, 75);
  });

  test('if the first-order lookup fails, the code is not applied and the order still goes through', async () => {
    signInAs(NEW);
    const realCollection = db.collection;
    db.collection = (name) => {
      const col = realCollection(name);
      if (name !== 'orders') return col;
      return { ...col, where: () => ({ select: () => ({ limit: () => ({ get: async () => { throw new Error('UNAVAILABLE'); } }) }) }) };
    };
    const r = await quietly(() => call(orders, buyNow()));
    assert.equal(r.status, 201);
    assert.equal(r.json.data.discount, 0);
    assert.equal(coupon('welcome').usedCount, 0);
  });

  test('the Buy Now drawer shows exactly what the server charges (welcome code, shipping and COD fee)', async () => {
    db.store.get('settings').set('store_settings', { cod_fee_waive_above: null });
    const charges = { enable_shipping_fee: true, shipping_fee_amount: 99, free_shipping_threshold: 2000, enable_cod_fee: true, cod_fee_amount: 49, cod_fee_waive_above: null };
    signInAs(NEW);
    const product = db.store.get('products').get('p1');
    for (const [qty, method] of [[1, 'cod'], [2, 'cod'], [1, 'razorpay']]) {
      const subtotal = unitPriceOf(product) * qty;
      const validated = await check('TULSI10', subtotal);
      const discount = couponDiscountFor(validated.json.data.coupon, subtotal);
      assert.equal(discount, validated.json.data.discount, 'the drawer’s local formula = the server’s');
      const shown = checkoutAmounts({ subtotal, discount, paymentMethod: method, charges });
      const r = await call(orders, buyNow({ items: [{ product: 'p1', quantity: qty }], payment: { method }, shippingCost: shown.shippingCost, codFee: shown.codFee }));
      assert.equal(r.status, 201, `qty ${qty} ${method}: ${r.json.message}`);
      assert.equal(r.json.data.total, shown.payableTotal, `qty ${qty} ${method}`);
      db.store.get('orders').clear(); // stay a first-timer for the next case
      Object.assign(coupon('welcome'), { usedCount: 0, usedBy: [] });
    }
  });
});

/* ══ validateCoupon() against the real endpoint ══ */

describe('validateCoupon (client) ↔ /api/coupons/validate', () => {
  const fetchImpl = (url, init) => {
    assert.equal(url, '/api/coupons/validate');
    return validate.POST(new Request(`http://tulsi.test${url}`, { ...init, headers: { ...init.headers, 'x-forwarded-for': freshIp() } }));
  };

  test('first-timer: accepted with the first-order flag', async () => {
    signInAs(NEW);
    const r = await validateCoupon(' tulsi10 ', 2000, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.code, 'TULSI10');
    assert.equal(r.discount, 200);
    assert.equal(r.firstOrderOnly, true);
  });

  test('repeat customer: refused with the server’s reason, and definite — the remembered code is forgotten', async () => {
    signInAs(RETURNING);
    const r = await validateCoupon('TULSI10', 2000, { fetchImpl });
    assert.deepEqual(r, { ok: false, code: 'TULSI10', refused: true, definite: true, status: 400, message: 'This code is for your first order only.' });
  });

  test('below the minimum: refused but not definite — kept for a bigger basket', async () => {
    signInAs(NEW);
    const r = await validateCoupon('BIGFIRST', 100, { fetchImpl });
    assert.equal(r.refused, true);
    assert.equal(r.definite, false);
    assert.equal(r.message, 'Minimum order amount is ₹5000');
  });

  test('rate-limited (429): neither refused nor definite', async () => {
    signInAs(NEW);
    const ip = '10.99.0.1';
    const limitedFetch = (url, init) => validate.POST(new Request(`http://tulsi.test${url}`, { ...init, headers: { ...init.headers, 'x-forwarded-for': ip } }));
    let r;
    for (let i = 0; i < 21; i += 1) r = await validateCoupon('TULSI10', 2000, { fetchImpl: limitedFetch });
    assert.equal(r.status, 429);
    assert.equal(r.refused, false);
    assert.equal(r.definite, false);
  });
});
