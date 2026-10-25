/* ─────────────────────────────────────────────
   Conversion add-ons — the pure helpers, imported directly (no mocks):

     src/lib/whatsappOrder.js               "Order on WhatsApp" deep link
     src/lib/welcomeOffer.js                welcome bar settings, dismissal,
                                            the remembered (tapped) code
     src/lib/coupons.js                     firstOrderOnly input,
                                            isPlacedOrder, hasPlacedOrder
     src/lib/storeCharges.js                the bar's truthful delivery line
     src/components/product/stockStatus.js  the REAL low-stock badge copy

   The pending-coupon helpers read window.localStorage, so each of those
   tests installs a fake window on globalThis (and removes it after).

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WHATSAPP, whatsappNumber, whatsappOrderUrl } from '../src/lib/whatsappOrder.js';
import {
  DEFAULT_ANNOUNCEMENT, normalizeAnnouncement, DISMISS_KEY, dismissToken,
  PENDING_COUPON_KEY, setPendingCoupon, getPendingCoupon, clearPendingCoupon,
} from '../src/lib/welcomeOffer.js';
import { parseCouponInput, isPlacedOrder, hasPlacedOrder } from '../src/lib/coupons.js';
import { DEFAULT_CHARGES, freeShippingLine } from '../src/lib/storeCharges.js';
import { stockStatus, LOW_STOCK_MAX } from '../src/components/product/stockStatus.js';

const DAY = 86_400_000;

/* ══ whatsappNumber ══ */

describe('whatsappNumber', () => {
  test('an Indian mobile in any common spelling → 91 + 10 digits', () => {
    for (const raw of ['+91 76958 68787', '76958 68787', '7695868787', '076958 68787', '+91-76958-68787', '(+91) 769 586 8787', '91 7695868787', '0091 76958 68787']) {
      assert.equal(whatsappNumber(raw), '917695868787', raw);
    }
  });

  test('an international number is kept as its digits', () => {
    assert.equal(whatsappNumber('+44 20 7946 0958'), '442079460958');
    assert.equal(whatsappNumber('+971 50 123 4567'), '971501234567');
  });

  test('anything unusable falls back to the store number (or the given fallback)', () => {
    assert.equal(DEFAULT_WHATSAPP, '917695868787');
    for (const raw of ['', null, undefined, 'call us', '12345', '5123456789', '1'.repeat(16), {}, 0]) {
      assert.equal(whatsappNumber(raw), DEFAULT_WHATSAPP, String(raw));
    }
    assert.equal(whatsappNumber('nope', '919000000000'), '919000000000');
  });

  test('never a number with a leading 0 (wa.me needs the international form)', () => {
    /* A trunk-prefixed landline or an unrecognised 0… number can't be turned
       into a working link: the store number is used instead. */
    for (const raw of ['044 2345 6789', '00 0123 456 789', '0 1234 567 890']) {
      const n = whatsappNumber(raw);
      assert.match(n, /^[1-9]\d{10,14}$/, `${raw} → ${n}`);
    }
  });
});

/* ══ whatsappOrderUrl ══ */

describe('whatsappOrderUrl', () => {
  const PRODUCT = { name: 'Temple Jhumka & Studs #2', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500 };
  const URL_P1 = 'https://tulsijewels.in/product/p1';
  const textOf = (href) => new URL(href).searchParams.get('text');
  const linesOf = (href) => textOf(href).split('\n');

  test('a wa.me link to the store with name, SKU, price, quantity and the product URL, one per line', () => {
    const href = whatsappOrderUrl({ phone: '+91 76958 68787', product: PRODUCT, qty: 2, url: URL_P1 });
    assert.ok(href.startsWith('https://wa.me/917695868787?text='), href);
    assert.deepEqual(linesOf(href), [
      "Hi Tulsi Jewels! I'd like to order:",
      '*Temple Jhumka & Studs #2*',
      'SKU: TJ-ER-104',
      'Price: ₹1,500',
      'Quantity: 2',
      URL_P1,
    ]);
  });

  test('the message is fully URL-encoded: &, #, +, spaces, newlines and ₹ cannot break the link', () => {
    const href = whatsappOrderUrl({ phone: '', product: { ...PRODUCT, name: 'Kundan + Polki & Pearl #1 set' }, url: `${URL_P1}?utm_source=ig&x=1#reviews` });
    const raw = href.slice(href.indexOf('?text=') + 6);
    assert.doesNotMatch(raw, /[ \n&#+?]/, 'no raw separators inside the text value');
    assert.match(raw, /%0A/, 'newlines encoded');
    assert.match(raw, /%E2%82%B9/, '₹ encoded');
    assert.equal(new URL(href).searchParams.size, 1, 'text is the only query parameter');
    assert.equal(new URL(href).hash, '', 'the product URL’s #fragment stays inside the text');
    assert.equal(linesOf(href)[1], '*Kundan + Polki & Pearl #1 set*');
    assert.equal(linesOf(href).at(-1), `${URL_P1}?utm_source=ig&x=1#reviews`);
  });

  test('price: the offer price when there is one, else the list price; Indian digit grouping; none when unknown', () => {
    assert.ok(linesOf(whatsappOrderUrl({ phone: '', product: { name: 'A', price: 125000 } })).includes('Price: ₹1,25,000'));
    assert.ok(linesOf(whatsappOrderUrl({ phone: '', product: { name: 'A', price: '999.6' } })).includes('Price: ₹1,000'), 'rounded');
    for (const product of [{ name: 'A' }, { name: 'A', price: 0 }, { name: 'A', price: 'n/a' }]) {
      assert.ok(!textOf(whatsappOrderUrl({ phone: '', product })).includes('Price'), JSON.stringify(product));
    }
  });

  test('optional lines are left out: no SKU, quantity 1 (the default), no URL', () => {
    const lines = linesOf(whatsappOrderUrl({ phone: '', product: { name: 'Choker', price: 4000 } }));
    assert.deepEqual(lines, ["Hi Tulsi Jewels! I'd like to order:", '*Choker*', 'Price: ₹4,000']);
    assert.ok(!textOf(whatsappOrderUrl({ phone: '', product: PRODUCT, qty: 1 })).includes('Quantity'));
    assert.ok(textOf(whatsappOrderUrl({ phone: '', product: PRODUCT, qty: 3 })).includes('Quantity: 3'));
  });

  test('a missing product still makes a usable message; long values are capped', () => {
    assert.equal(linesOf(whatsappOrderUrl({ phone: '', product: null }))[1], '*this piece*');
    assert.equal(linesOf(whatsappOrderUrl({ phone: '', product: { name: '' } }))[1], '*this piece*');
    const lines = linesOf(whatsappOrderUrl({ phone: '', product: { name: 'N'.repeat(500), sku: 'S'.repeat(100) }, url: `https://x.test/${'u'.repeat(600)}` }));
    assert.equal(lines[1], `*${'N'.repeat(120)}*`);
    assert.equal(lines[2], `SKU: ${'S'.repeat(40)}`);
    assert.equal(lines.at(-1).length, 300);
  });

  test('the number: the store’s configured one when usable, else the built-in store number', () => {
    assert.ok(whatsappOrderUrl({ phone: '98400 12345', product: PRODUCT }).startsWith('https://wa.me/919840012345?'));
    for (const phone of ['', undefined, null, 'n/a']) {
      assert.ok(whatsappOrderUrl({ phone, product: PRODUCT }).startsWith(`https://wa.me/${DEFAULT_WHATSAPP}?`), String(phone));
    }
  });
});

/* ══ normalizeAnnouncement / dismissal ══ */

describe('normalizeAnnouncement', () => {
  test('not configured (or junk) → the default welcome offer', () => {
    const def = { enabled: true, message: 'Welcome Offer: Flat ₹100 OFF on your first order', code: 'TULSI100' };
    assert.deepEqual({ ...DEFAULT_ANNOUNCEMENT }, def);
    for (const s of [undefined, null, {}, { phone: '+91 1' }, { announcement: null }, { announcement: 'on' }, { announcement: {} }]) {
      assert.deepEqual(normalizeAnnouncement(s), def, JSON.stringify(s));
    }
    assert.ok(Object.isFrozen(DEFAULT_ANNOUNCEMENT));
  });

  test('the owner’s settings: on/off, message and code', () => {
    assert.deepEqual(
      normalizeAnnouncement({ announcement: { enabled: false, message: 'Bridal week: ₹1000 off sets', code: 'bride1000' } }),
      { enabled: false, message: 'Bridal week: ₹1000 off sets', code: 'BRIDE1000' },
    );
    assert.equal(normalizeAnnouncement({ announcement: { enabled: 'false' } }).enabled, true, 'only a real boolean switches it off');
  });

  test('code: trimmed and upper-cased; an invalid one is dropped (never shown), empty means no code', () => {
    const code = (c) => normalizeAnnouncement({ announcement: { code: c } }).code;
    assert.equal(code('  tulsi100 '), 'TULSI100');
    assert.equal(code('FEST_2026-A'), 'FEST_2026-A');
    assert.equal(code(''), '');
    for (const bad of ['AB', 'X!', 'TEN OFF', 'A'.repeat(31), '<b>']) assert.equal(code(bad), '', bad);
    assert.equal(code(42), 'TULSI100', 'not a string → default');
  });

  test('message: no markup characters, at most 140 characters, empty → the default message', () => {
    const msg = (m) => normalizeAnnouncement({ announcement: { message: m } }).message;
    assert.equal(msg('  Diwali <sale> 20% off  '), 'Diwali sale 20% off');
    assert.equal(msg('x'.repeat(200)).length, 140);
    assert.equal(msg('   '), DEFAULT_ANNOUNCEMENT.message);
    assert.equal(msg('<>'), DEFAULT_ANNOUNCEMENT.message);
  });

  test('dismissal is per message + code: a new offer shows again', () => {
    const a = normalizeAnnouncement({});
    assert.equal(DISMISS_KEY, 'tj-announce-dismissed');
    assert.equal(dismissToken(a), `TULSI100|${a.message}`);
    assert.equal(dismissToken(a), dismissToken(normalizeAnnouncement({ announcement: { code: 'tulsi100' } })));
    assert.notEqual(dismissToken(a), dismissToken({ ...a, code: 'NEW15' }));
    assert.notEqual(dismissToken(a), dismissToken({ ...a, message: 'Flat 15% OFF' }));
    assert.ok(dismissToken({ code: 'A'.repeat(30), message: 'm'.repeat(500) }).length <= 200);
  });
});

/* ══ The remembered code (tap in the bar → applied at checkout) ══ */

function fakeStorage({ failSet = false, failGet = false, failRemove = false } = {}) {
  const m = new Map();
  return {
    m,
    getItem: (k) => { if (failGet) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (failSet) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => { if (failRemove) throw new Error('SecurityError'); m.delete(k); },
  };
}

describe('pending coupon', () => {
  let storage;
  beforeEach(() => { storage = fakeStorage(); globalThis.window = { localStorage: storage }; });
  afterEach(() => { delete globalThis.window; });

  test('tapping a code remembers it (upper-cased), checkout reads it back, then forgets it', () => {
    assert.equal(PENDING_COUPON_KEY, 'tj-pending-coupon');
    assert.equal(getPendingCoupon(), null);
    const before = Date.now();
    assert.equal(setPendingCoupon(' tulsi10 '), true);
    const saved = JSON.parse(storage.m.get(PENDING_COUPON_KEY));
    assert.equal(saved.code, 'TULSI10');
    assert.ok(saved.at >= before && saved.at <= Date.now());
    assert.equal(getPendingCoupon(), 'TULSI10');
    assert.equal(setPendingCoupon('FEST5'), true, 'a newer tap replaces it');
    assert.equal(getPendingCoupon(), 'FEST5');
    clearPendingCoupon();
    assert.equal(getPendingCoupon(), null);
    assert.equal(storage.m.has(PENDING_COUPON_KEY), false);
  });

  test('an invalid code is refused and nothing is stored', () => {
    for (const c of ['', null, undefined, 'AB', 'X!', 'TEN OFF', 'A'.repeat(31)]) {
      assert.equal(setPendingCoupon(c), false, String(c));
    }
    assert.equal(storage.m.size, 0);
  });

  test('kept for 30 days, then ignored', () => {
    const put = (at, code = 'TULSI10') => storage.m.set(PENDING_COUPON_KEY, JSON.stringify({ code, at }));
    put(Date.now() - 29 * DAY);
    assert.equal(getPendingCoupon(), 'TULSI10');
    put(Date.now() - 31 * DAY);
    assert.equal(getPendingCoupon(), null);
  });

  test('tampered or old-format storage is ignored, never thrown or passed on', () => {
    for (const raw of ['not json', '"TULSI10"', 'null', '{}', JSON.stringify({ code: '<img src=x>', at: Date.now() }), JSON.stringify({ code: 'TULSI10' }), JSON.stringify({ code: 'tulsi10', at: Date.now() })]) {
      storage.m.set(PENDING_COUPON_KEY, raw);
      assert.equal(getPendingCoupon(), null, raw);
    }
  });

  test('private mode / full storage: nothing thrown, and a failed save is reported as not saved', () => {
    globalThis.window = { localStorage: fakeStorage({ failSet: true, failGet: true, failRemove: true }) };
    assert.equal(setPendingCoupon('TULSI10'), false);
    assert.equal(getPendingCoupon(), null);
    assert.doesNotThrow(() => clearPendingCoupon());
  });

  test('site data blocked (reading window.localStorage throws): not saved, nothing thrown', () => {
    globalThis.window = {};
    Object.defineProperty(globalThis.window, 'localStorage', { get() { throw new Error('SecurityError: access denied'); } });
    /* The bar shows "Use code … at checkout" instead of promising to apply it. */
    assert.equal(setPendingCoupon('TULSI10'), false);
    assert.equal(getPendingCoupon(), null);
    assert.doesNotThrow(() => clearPendingCoupon());
  });

  test('server render (no window): nothing saved, nothing thrown', () => {
    delete globalThis.window;
    assert.equal(setPendingCoupon('TULSI10'), false);
    assert.equal(getPendingCoupon(), null);
    assert.doesNotThrow(() => clearPendingCoupon());
  });
});

/* ══ parseCouponInput: firstOrderOnly ══ */

describe('parseCouponInput firstOrderOnly', () => {
  const BASE = { code: 'tulsi10', type: 'percentage', value: 10 };

  test('create: off unless ticked; ticked is stored', () => {
    assert.equal(parseCouponInput(BASE).data.firstOrderOnly, false);
    assert.equal(parseCouponInput({ ...BASE, firstOrderOnly: true }).data.firstOrderOnly, true);
    assert.equal(parseCouponInput({ ...BASE, firstOrderOnly: false }).data.firstOrderOnly, false);
    assert.deepEqual(parseCouponInput({ ...BASE, firstOrderOnly: true }).data, {
      code: 'TULSI10', type: 'percentage', value: 10, maxUses: 0, minOrderAmount: 0, maxDiscount: null, startsAt: null, expiresAt: null, firstOrderOnly: true,
    });
  });

  test('only a real true/false is accepted', () => {
    for (const v of ['true', 'yes', 1, 0, null, {}]) {
      const r = parseCouponInput({ ...BASE, firstOrderOnly: v });
      assert.equal(r.error, 'First order only must be on or off.', JSON.stringify(v));
      assert.equal(r.data, undefined);
    }
  });

  test('edit: left alone unless sent', () => {
    assert.deepEqual(parseCouponInput({ value: 15 }, { partial: true }).data, { value: 15 });
    assert.deepEqual(parseCouponInput({ firstOrderOnly: true }, { partial: true }).data, { firstOrderOnly: true });
    assert.deepEqual(parseCouponInput({ firstOrderOnly: false, isActive: true }, { partial: true }).data, { isActive: true, firstOrderOnly: false });
    assert.ok(parseCouponInput({ firstOrderOnly: 'off' }, { partial: true }).error);
  });
});

/* ══ isPlacedOrder ══ */

test('isPlacedOrder: paid online or cash on delivery counts; cancelled or an unpaid online attempt does not', () => {
  const cases = [
    [{ status: 'delivered', payment: { method: 'razorpay', status: 'paid' } }, true],
    [{ status: 'pending', payment: { method: 'razorpay', status: 'paid' } }, true],
    [{ status: 'pending', payment: { method: 'cod', status: 'pending' } }, true],
    [{ status: 'shipped', payment: { method: 'cod' } }, true],
    [{ status: 'pending', payment: { method: 'razorpay', status: 'pending' } }, false],
    [{ status: 'pending', payment: { method: 'razorpay', status: 'failed' } }, false],
    [{ status: 'cancelled', payment: { method: 'razorpay', status: 'paid' } }, false],
    [{ status: 'cancelled', payment: { method: 'cod', status: 'pending' } }, false],
    [{ status: 'pending' }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ];
  for (const [order, want] of cases) assert.equal(isPlacedOrder(order), want, JSON.stringify(order));
});

/* ══ hasPlacedOrder ══ */

/* A recording stand-in for db.collection('orders') that understands dotted
   field paths (shippingAddress.email), which tests/helpers/fakeFirestore
   does not. Only what hasPlacedOrder may use: where('==') → select → limit → get. */
function ordersDb(orders, { fail = false } = {}) {
  const queries = [];
  const at = (doc, f) => f.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
  const query = (q) => ({
    where(field, op, value) {
      assert.equal(op, '==', 'single-field equality only (no composite index)');
      assert.equal(q.filters.length, 0, 'one filter per lookup');
      return query({ ...q, filters: [[field, value]] });
    },
    select: (...fields) => query({ ...q, fields }),
    limit: (n) => query({ ...q, limit: n }),
    async get() {
      queries.push(q);
      if (fail) throw new Error('UNAVAILABLE');
      const docs = Object.entries(orders)
        .filter(([, d]) => q.filters.every(([f, v]) => at(d, f) === v))
        .slice(0, q.limit ?? Infinity)
        .map(([id, d]) => ({ id, data: () => structuredClone(d) }));
      return { docs, empty: !docs.length, size: docs.length };
    },
  });
  return {
    queries,
    collection(name) { assert.equal(name, 'orders'); return query({ filters: [], fields: null, limit: null }); },
  };
}

describe('hasPlacedOrder', () => {
  const PAID = { status: 'delivered', payment: { method: 'razorpay', status: 'paid' } };
  const COD = { status: 'pending', payment: { method: 'cod', status: 'pending' } };
  const UNPAID = { status: 'pending', payment: { method: 'razorpay', status: 'pending' } };
  const CANCELLED = { status: 'cancelled', payment: { method: 'cod', status: 'pending' } };
  const ORDERS = {
    o1: { userId: 'u-paid', guestEmail: 'paid@x.test', shippingAddress: { email: 'paid@x.test' }, ...PAID },
    o2: { userId: 'u-cod', guestEmail: 'cod@x.test', shippingAddress: { email: 'cod@x.test' }, ...COD },
    o3: { userId: 'u-try', guestEmail: 'try@x.test', shippingAddress: { email: 'try@x.test' }, ...UNPAID },
    o4: { userId: 'u-try', guestEmail: 'try@x.test', shippingAddress: { email: 'try@x.test' }, ...CANCELLED },
    o5: { userId: null, guestEmail: 'guest@x.test', shippingAddress: { email: 'guest@x.test' }, ...COD },
    o6: { userId: 'u-other', guestEmail: 'acct@x.test', shippingAddress: { email: 'gift.sender@x.test' }, ...PAID },
  };

  test('by account: a paid or COD order counts', async () => {
    assert.equal(await hasPlacedOrder(ordersDb(ORDERS), { userId: 'u-paid' }), true);
    assert.equal(await hasPlacedOrder(ordersDb(ORDERS), { userId: 'u-cod' }), true);
  });

  test('by account: only cancelled orders and an unpaid online attempt → still a first order', async () => {
    assert.equal(await hasPlacedOrder(ordersDb(ORDERS), { userId: 'u-try', email: 'try@x.test' }), false);
    assert.equal(await hasPlacedOrder(ordersDb(ORDERS), { userId: 'u-new', email: 'new@x.test' }), false);
  });

  test('by email: the order’s guestEmail, any case or spacing — never the shipping-address email (a gift recipient)', async () => {
    assert.equal(await hasPlacedOrder(ordersDb(ORDERS), { email: 'guest@x.test' }), true, 'guest COD order');
    assert.equal(await hasPlacedOrder(ordersDb(ORDERS), { userId: 'u-new', email: '  Guest@X.Test ' }), true, 'new account, same email');
    assert.equal(await hasPlacedOrder(ordersDb(ORDERS), { email: 'gift.sender@x.test' }), false, 'shipping-address email is not the customer');
    assert.equal(await hasPlacedOrder(ordersDb(ORDERS), { email: 'nobody@x.test' }), false);
  });

  test('by delivery phone: the number as typed and its last 10 digits', async () => {
    const PHONES = {
      p1: { userId: 'u-a', guestEmail: 'a@x.test', shippingAddress: { phone: '+91 98765 43210' }, ...COD },
      p2: { userId: 'u-b', guestEmail: 'b@x.test', shippingAddress: { phone: '9123456780' }, ...PAID },
      p3: { userId: 'u-c', guestEmail: 'c@x.test', shippingAddress: { phone: '9000000001' }, ...UNPAID },
    };
    assert.equal(await hasPlacedOrder(ordersDb(PHONES), { userId: 'u-new', phone: '+91 98765 43210' }), true, 'same raw form');
    assert.equal(await hasPlacedOrder(ordersDb(PHONES), { userId: 'u-new', phone: '+91-91234-56780' }), true, '10-digit form');
    assert.equal(await hasPlacedOrder(ordersDb(PHONES), { userId: 'u-new', phone: '9000000001' }), false, 'an unpaid attempt on that phone');
    assert.equal(await hasPlacedOrder(ordersDb(PHONES), { userId: 'u-new', phone: '98765' }), false, 'too short to match');
    const db = ordersDb(PHONES);
    await hasPlacedOrder(db, { phone: '+91 98765 43210' });
    assert.deepEqual(db.queries.map((q) => q.filters), [[['shippingAddress.phone', '+91 98765 43210']], [['shippingAddress.phone', '9876543210']]]);
    const same = ordersDb(PHONES);
    await hasPlacedOrder(same, { phone: '9876543210' });
    assert.equal(same.queries.length, 1, 'one query when the typed form is already 10 digits');
  });

  test('someone else’s orders never count', async () => {
    assert.equal(await hasPlacedOrder(ordersDb(ORDERS), { userId: 'u-paid-not', email: 'paid@x.test.in' }), false);
  });

  test('bounded single-field lookups: account id, guestEmail, phone — status and payment only, 25 each', async () => {
    const db = ordersDb(ORDERS);
    await hasPlacedOrder(db, { userId: 7, email: 'A@x.test', phone: '9876543210' });
    assert.deepEqual(db.queries.map((q) => q.filters), [[['userId', '7']], [['guestEmail', 'a@x.test']], [['shippingAddress.phone', '9876543210']]]);
    for (const q of db.queries) {
      assert.deepEqual(q.fields, ['status', 'payment']);
      assert.equal(q.limit, 25);
    }
    const onlyUser = ordersDb(ORDERS);
    await hasPlacedOrder(onlyUser, { userId: 'u-paid' });
    assert.equal(onlyUser.queries.length, 1);
    const onlyEmail = ordersDb(ORDERS);
    await hasPlacedOrder(onlyEmail, { email: 'paid@x.test' });
    assert.equal(onlyEmail.queries.length, 1);
  });

  test('nobody to look up → false, without a query', async () => {
    for (const who of [undefined, {}, { userId: null, email: '' }, { email: '   ' }, { email: 42 }]) {
      const db = ordersDb(ORDERS);
      assert.equal(await hasPlacedOrder(db, who), false, JSON.stringify(who));
      assert.equal(db.queries.length, 0);
    }
  });

  test('a failed read rejects (the order endpoint then withholds the discount)', async () => {
    await assert.rejects(hasPlacedOrder(ordersDb(ORDERS, { fail: true }), { userId: 'u-new' }), /UNAVAILABLE/);
  });
});

/* ══ Truthful copy ══ */

test('freeShippingLine: the bar’s delivery line follows the real shipping settings', () => {
  assert.equal(freeShippingLine(DEFAULT_CHARGES), 'Free delivery above ₹2,000');
  assert.equal(freeShippingLine({ ...DEFAULT_CHARGES, free_shipping_threshold: 15000 }), 'Free delivery above ₹15,000');
  assert.equal(freeShippingLine({ ...DEFAULT_CHARGES, enable_shipping_fee: false }), 'Free delivery on every order');
  assert.equal(freeShippingLine({ ...DEFAULT_CHARGES, free_shipping_threshold: 0 }), 'Delivery ₹99', 'never "free" when it never is');
  assert.equal(freeShippingLine(undefined), 'Free delivery above ₹2,000', 'defaults before the charges load');
});

test('stockStatus: the badge shows the real stock — low (amber) only at 1–3 pieces', () => {
  assert.equal(LOW_STOCK_MAX, 3);
  assert.deepEqual(stockStatus(0), { tone: 'out', count: 0, label: 'Out of stock' });
  for (const s of [undefined, null, -2, 'abc', NaN, 0.4]) assert.deepEqual(stockStatus(s), { tone: 'out', count: 0, label: 'Out of stock' }, String(s));
  assert.deepEqual(stockStatus(1), { tone: 'low', count: 1, label: 'Only 1 left in stock — order soon' });
  assert.deepEqual(stockStatus('2'), { tone: 'low', count: 2, label: 'Only 2 left in stock — order soon' });
  assert.deepEqual(stockStatus(3.9), { tone: 'low', count: 3, label: 'Only 3 left in stock — order soon' });
  assert.deepEqual(stockStatus(4), { tone: 'in', count: 4, label: 'In stock' });
  assert.deepEqual(stockStatus(250), { tone: 'in', count: 250, label: 'In stock' });
});
