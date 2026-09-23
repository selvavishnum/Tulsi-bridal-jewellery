/* ─────────────────────────────────────────────
   Security regression tests for the AppSec audit fixes — the real route
   handlers and libraries, with only the session, Firestore, email and
   WhatsApp swapped for fakes.
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { saveOtp, verifyOtp, isValidEmail, MAX_OTP_ATTEMPTS } from '../src/lib/otp.js';
import { hit, clientIp } from '../src/lib/rateLimit.js';
import { ownsOrder } from '../src/lib/orderOwnership.js';
import { escapeHtml } from '../src/lib/escapeHtml.js';
import { parseCouponInput, checkCouponValue } from '../src/lib/coupons.js';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
process.env.NEXTAUTH_SECRET = 'test-secret';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const signInAs = (user) => { session = user ? { user } : null; };
const getServerSession = async () => session;
const sentMail = [];

mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module('next-auth/react', { namedExports: { getSession: async () => session } });
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
mock.module(src('lib/email.js'), {
  namedExports: {
    ...Object.fromEntries(['sendOrderConfirmation', 'sendOrderNotificationToAdmin', 'sendStatusUpdateEmail', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'isConfigured'].map((n) => [n, noop])),
    esc: (v) => String(v ?? ''),
    sendOTPEmail: async (to, code) => { sentMail.push({ to, code }); return true; },
  },
});
mock.module(src('lib/whatsapp.js'), { namedExports: Object.fromEntries(['sendOrderWhatsAppToAdmin', 'sendOrderWhatsAppToCustomer', 'sendStatusWhatsApp', 'sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])) });

const route = (p) => import(src(`app/api/${p}/route.js`));
const [register, sendOtp, orders, orderById, returns, loyalty, trackOrder, coupons, couponById] = await Promise.all([
  route('auth/register'), route('auth/send-otp'), route('orders'), route('orders/[id]'), route('returns'),
  route('loyalty'), route('track-order'), route('coupons'), route('coupons/[id]'),
]);
const { safeLocalPath } = await import(src('lib/postLoginRedirect.js'));

let ipCounter = 0;
async function call(mod, method, { url = 'http://tulsi.test/api', body, params = {}, ip } = {}) {
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || `10.0.0.${++ipCounter % 250}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const res = await mod[method](request, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
}

const ADDRESS = { fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' };
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  session = null;
  sentMail.length = 0;
  db = fakeFirestore({
    users: {
      u1: { email: 'priya@x.test', name: 'Priya', loyaltyPoints: 120, emailVerified: true },
      u2: { email: 'guest@x.test', name: 'Attacker', emailVerified: false },
    },
    products: { p1: { name: 'Jhumka', price: 1000, stock: 5, isActive: true, vendorId: 'tulsi' } },
    coupons: { c1: { code: 'ONCE', type: 'fixed', value: 100, maxUses: 1, usedCount: 0, usedBy: [], isActive: true } },
    orders: {
      g1: { orderNumber: 'TBJ1', guestEmail: 'guest@x.test', status: 'delivered', deliveredAt: new Date().toISOString(), total: 1000, payment: { status: 'paid' }, items: [], shippingAddress: { ...ADDRESS, email: 'guest@x.test' } },
      o1: { orderNumber: 'TBJ2', userId: 'u1', status: 'confirmed', total: 1000, payment: { status: 'paid' }, items: [] },
      old: { orderNumber: 'TBJ3', userId: 'u1', status: 'delivered', deliveredAt: new Date(Date.now() - 30 * DAY).toISOString(), total: 1000, payment: { status: 'paid' }, items: [] },
    },
    settings: { site: {} },
  });
});

/* ── Authentication ── */

test('OTP: a code dies after 5 wrong guesses — the right code no longer works', async () => {
  await saveOtp(db, 'owner@tulsi.test', '123456');
  for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) assert.equal(await verifyOtp(db, 'owner@tulsi.test', String(100000 + i)), false);
  assert.equal(await verifyOtp(db, 'owner@tulsi.test', '123456'), false, 'brute force closed');
});

test('OTP: right code works once; stored as a hash, never in the clear; expires', async () => {
  await saveOtp(db, 'a@x.test', '654321');
  const stored = JSON.stringify([...db.store.get('otp_codes').values()]);
  assert.ok(!stored.includes('654321'), 'plaintext code at rest');
  assert.equal(await verifyOtp(db, 'a@x.test', '654321'), true);
  assert.equal(await verifyOtp(db, 'a@x.test', '654321'), false, 'single use');
  await saveOtp(db, 'b@x.test', '111111', Date.now() - 11 * 60 * 1000);
  assert.equal(await verifyOtp(db, 'b@x.test', '111111'), false, 'expired');
});

test('send-otp: rate limited per address; rejects recipient lists', async () => {
  const email = 'victim@x.test';
  for (let i = 0; i < 3; i++) assert.equal((await call(sendOtp, 'POST', { body: { email } })).status, 200);
  assert.equal((await call(sendOtp, 'POST', { body: { email } })).status, 429);
  assert.equal((await call(sendOtp, 'POST', { body: { email: 'a@x.test, b@y.test' } })).status, 400);
  assert.equal(sentMail.length, 3);
});

test('rate limiter: fixed window per key, resets after the window', async () => {
  const rule = { limit: 5, windowMs: 60_000 };
  const t = Date.now();
  for (let i = 0; i < 5; i++) assert.equal((await hit(db, 'login:x', rule, t)).allowed, true);
  assert.equal((await hit(db, 'login:x', rule, t + 1000)).allowed, false, '6th attempt in a minute');
  assert.equal((await hit(db, 'login:x', rule, t + 61_000)).allowed, true, 'new window');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
});

test('register: " victim@x" can’t make a second account; unverified; generic answer for staff emails', async () => {
  const first = await call(register, 'POST', { body: { name: 'A', email: 'Victim@X.test', password: 'password123' } });
  assert.equal(first.status, 201);
  assert.equal(first.json.data.email, 'victim@x.test');
  assert.equal(first.json.data.emailVerified, false);
  const dupe = await call(register, 'POST', { body: { name: 'B', email: '  victim@x.test', password: 'password123' } });
  assert.equal(dupe.status, 409);
  const owner = await call(register, 'POST', { body: { name: 'C', email: 'owner@tulsi.test', password: 'password123' } });
  assert.equal(owner.status, 409);
  assert.equal(owner.json.message, dupe.json.message, 'staff/owner emails not distinguishable');
  assert.equal((await call(register, 'POST', { body: { name: 'D', email: 'd@x.test', password: 'short' } })).status, 400);
});

test('open redirect: backslash, tab and protocol-relative callbackUrls are refused', () => {
  const o = 'https://tulsijewels.in';
  assert.equal(safeLocalPath('/vendor/orders?x=1', '/', o), '/vendor/orders?x=1');
  for (const evil of ['//evil.com', '/\\evil.com', '/\tevil.com', 'https://evil.com', '/\\/evil.com']) {
    assert.equal(safeLocalPath(evil, '/', o), '/', evil);
  }
});

/* ── Authorization ── */

test('guest orders: an unverified account registered with someone’s email can’t read, cancel or return them', async () => {
  const attacker = { id: 'u2', email: 'guest@x.test', emailVerified: false };
  signInAs(attacker);
  assert.equal((await call(orderById, 'GET', { params: { id: 'g1' } })).status, 403);
  assert.equal((await call(orderById, 'PUT', { params: { id: 'g1' }, body: { status: 'cancelled' } })).status, 403);
  assert.deepEqual((await call(orders, 'GET', { url: 'http://tulsi.test/api/orders' })).json.data.orders, []);
  assert.equal((await call(returns, 'POST', { body: { orderId: 'g1', reason: 'x' } })).status, 404);
  // …the real owner, having proved the email, can
  signInAs({ id: 'u9', email: 'guest@x.test', emailVerified: true });
  assert.equal((await call(orderById, 'GET', { params: { id: 'g1' } })).status, 200);
  assert.equal(ownsOrder({ userId: null, guestEmail: null }, { id: null, email: null }), false, 'nulls never match');
});

test('track-order: same 404 for a wrong email as for no order; no street or full phone', async () => {
  const wrong = await call(trackOrder, 'GET', { url: 'http://tulsi.test/api/track-order?orderNumber=TBJ1&email=nope@x.test' });
  const none = await call(trackOrder, 'GET', { url: 'http://tulsi.test/api/track-order?orderNumber=TBJ999&email=nope@x.test' });
  assert.equal(wrong.status, 404);
  assert.deepEqual(wrong.json, none.json);
  const ok = await call(trackOrder, 'GET', { url: 'http://tulsi.test/api/track-order?orderNumber=TBJ1&email=guest@x.test' });
  assert.equal(ok.status, 200);
  assert.ok(!JSON.stringify(ok.json).includes('Temple St'));
  assert.ok(!JSON.stringify(ok.json).includes('9876543210'));
});

/* ── Money ── */

test('checkout: client prices ignored; duplicate lines can’t beat stock; bad address and recipient lists refused', async () => {
  signInAs({ id: 'u1', email: 'priya@x.test', emailVerified: true });
  const ok = await call(orders, 'POST', { body: { items: [{ product: 'p1', quantity: 1, price: 1 }], shippingAddress: ADDRESS, payment: { method: 'cod' }, total: 1 } });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.subtotal, 1000);
  const dup = await call(orders, 'POST', { body: { items: [{ product: 'p1', quantity: 5 }, { product: 'p1', quantity: 5 }], shippingAddress: ADDRESS, payment: { method: 'cod' } } });
  assert.equal(dup.status, 400, '10 of a 5-stock product via two lines');
  const xss = await call(orders, 'POST', { body: { items: [{ product: 'p1', quantity: 1 }], shippingAddress: { ...ADDRESS, street: '<img src=x onerror=alert(1)>' }, payment: { method: 'cod' } } });
  assert.equal(xss.status, 400);
  signInAs(null);
  const spam = await call(orders, 'POST', { body: { items: [{ product: 'p1', quantity: 1 }], shippingAddress: ADDRESS, payment: { method: 'cod' }, guestEmail: 'a@x.test, b@y.test' } });
  assert.equal(spam.status, 400);
});

test('coupons: maxUses and once-per-customer are enforced at checkout; cancelling gives the use back', async () => {
  signInAs({ id: 'u1', email: 'priya@x.test', emailVerified: true });
  const body = { items: [{ product: 'p1', quantity: 1 }], shippingAddress: ADDRESS, payment: { method: 'cod' }, couponCode: 'ONCE' };
  const first = await call(orders, 'POST', { body });
  assert.equal(first.status, 201);
  assert.equal(first.json.data.discount, 100);
  const again = await call(orders, 'POST', { body });
  assert.equal(again.json.data?.discount ?? 0, 0, 'second use gets no discount');
  assert.equal(db.store.get('coupons').get('c1').usedCount, 1);

  const cancel = await call(orderById, 'PUT', { params: { id: first.json.data.id }, body: { status: 'cancelled' } });
  assert.equal(cancel.status, 200);
  assert.equal(db.store.get('coupons').get('c1').usedCount, 0, 'use released on cancel');
});

test('coupons: staff can only set real coupon fields (no usedCount/usedBy rewrite), with sane values', async () => {
  assert.equal(parseCouponInput({ code: 'x', type: 'fixed', value: 1 }).error !== undefined, true);
  assert.ok(checkCouponValue({ type: 'percentage', value: 150 }));
  const parsed = parseCouponInput({ usedCount: 0, usedBy: [], value: 10 }, { partial: true });
  assert.deepEqual(parsed.data, { value: 10 });
  signInAs({ id: 's', email: 'owner@tulsi.test' });
  const res = await call(couponById, 'PUT', { params: { id: 'c1' }, body: { usedCount: 0, usedBy: [], isActive: true } });
  assert.equal(res.status, 200);
  assert.equal(db.store.get('coupons').get('c1').maxUses, 1);
  assert.equal((await call(coupons, 'POST', { body: { code: 'ONCE', type: 'fixed', value: 5 } })).status, 409, 'duplicate code');
});

test('loyalty: redeem is validated against the fresh balance; no negative or fractional amounts', async () => {
  signInAs({ id: 'u1', email: 'priya@x.test', emailVerified: true });
  assert.equal((await call(loyalty, 'POST', { body: { action: 'redeem', pointsToRedeem: 500 } })).status, 400, 'more than balance');
  assert.equal((await call(loyalty, 'POST', { body: { action: 'redeem', pointsToRedeem: -50 } })).status, 400);
  assert.equal((await call(loyalty, 'POST', { body: { action: 'redeem', pointsToRedeem: 75 } })).status, 400, 'blocks of 50');
  const ok = await call(loyalty, 'POST', { body: { action: 'redeem', pointsToRedeem: 100 } });
  assert.equal(ok.status, 200);
  const u = db.store.get('users').get('u1');
  assert.deepEqual([u.loyaltyPoints, u.pendingLoyaltyDiscount], [20, 100]);
});

test('returns: only for delivered orders inside the return window, one per order', async () => {
  signInAs({ id: 'u1', email: 'priya@x.test', emailVerified: true });
  assert.equal((await call(returns, 'POST', { body: { orderId: 'o1', reason: 'x' } })).status, 400, 'not delivered yet');
  assert.equal((await call(returns, 'POST', { body: { orderId: 'old', reason: 'x' } })).status, 400, 'window passed');
  db.store.get('orders').get('o1').status = 'delivered';
  db.store.get('orders').get('o1').deliveredAt = new Date().toISOString();
  assert.equal((await call(returns, 'POST', { body: { orderId: 'o1', reason: 'x' } })).status, 201);
  assert.equal((await call(returns, 'POST', { body: { orderId: 'o1', reason: 'x' } })).status, 400, 'second return refused');
});

/* ── Output encoding ── */

test('escapeHtml neutralises markup used in print popups', () => {
  assert.equal(escapeHtml('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(escapeHtml(null), '');
  assert.ok(isValidEmail('a@b.co') && !isValidEmail('a@b.co, c@d.co') && !isValidEmail('<a@b.co>'));
});
