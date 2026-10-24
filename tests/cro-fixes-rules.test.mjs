/* ─────────────────────────────────────────────
   CRO fixes — the pure rules both sides of checkout share, as tables:

     couponDiscountFor      THE discount formula (src/lib/coupons.js), also
                            re-exported by checkoutRules for the screens
     shownCouponDiscount    a server figure holds only for its own subtotal
     couponShortfall /      "Add ₹X more to use CODE" and the minimum read
     minimumFromMessage     back from either server message
     isDefiniteCouponRejection  when a remembered code is forgotten
     couponStateRefusal /   who may use a code at all; what counts as a
     isPlacedOrder          placed (first) order
     parseCouponInput       the admin form's blank / cleared fields
     loyaltyDiscountFor     the Points Discount shown = what the order takes
     keptAttemptStillHolds  the auto-apply cool-down (10 minutes, same
                            basket, below the minimum)

   The guiding rule these protect: what a customer is shown on the
   Place-order button is what they are charged, and an abandoned online
   payment never costs them their coupon.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  couponDiscountFor, couponStateRefusal, isPlacedOrder, parseCouponInput, couponRefusalMessage, phone10,
} from '../src/lib/coupons.js';
import * as rules from '../src/components/checkout/checkoutRules.js';
import { keptAttemptStillHolds, KEPT_RETRY_MS } from '../src/components/checkout/useAutoApplyPendingCoupon.js';

const { shownCouponDiscount, couponShortfall, minimumFromMessage, isDefiniteCouponRejection, checkoutAmounts } = rules;
const DEFAULT_CHARGES = (await import('../src/lib/storeCharges.js')).DEFAULT_CHARGES;

/* ══ THE formula ══ */

describe('couponDiscountFor — one formula for the coupon check, the order and every screen', () => {
  const pct = (value, extra = {}) => ({ type: 'percentage', value, ...extra });
  const fixed = (value, extra = {}) => ({ type: 'fixed', value, ...extra });

  /* [label, coupon, subtotal, discount] */
  const TABLE = [
    ['10% of ₹1,500', pct(10), 1500, 150],
    ['10% of ₹4,500 (3 pieces)', pct(10), 4500, 450],
    ['10% of ₹1,499 rounds to the rupee', pct(10), 1499, 150],
    ['10% of ₹1,494 rounds down', pct(10), 1494, 149],
    ['a percentage above 100 is 100%', pct(150), 800, 800],
    ['₹500 fixed', fixed(500), 6000, 500],
    ['fixed never more than the order', fixed(500), 300, 300],
    ['exactly the minimum: applies', fixed(500, { minOrderAmount: 5000 }), 5000, 500],
    ['₹1 below the minimum: nothing', fixed(500, { minOrderAmount: 5000 }), 4999, 0],
    ['below a % code’s minimum: nothing', pct(10, { minOrderAmount: 5000 }), 4500, 0],
    ['capped: 10% of ₹1,50,000 at max ₹500', pct(10, { maxDiscount: 500 }), 150000, 500],
    ['the cap above the discount changes nothing', pct(10, { maxDiscount: 500 }), 1500, 150],
    ['cap applies to a fixed code too', fixed(800, { maxDiscount: 500 }), 6000, 500],
    ['cap 0 = no cap', pct(10, { maxDiscount: 0 }), 150000, 15000],
    ['cap null = no cap', pct(10, { maxDiscount: null }), 150000, 15000],
    ['cap blank string = no cap', pct(10, { maxDiscount: '' }), 150000, 15000],
    ['a negative cap is ignored', pct(10, { maxDiscount: -50 }), 1500, 150],
    ['minimum and cap together, minimum met', pct(20, { minOrderAmount: 5000, maxDiscount: 1500 }), 20000, 1500],
    ['minimum and cap together, minimum missed', pct(20, { minOrderAmount: 5000, maxDiscount: 1500 }), 4000, 0],
    ['values stored as strings (older coupons)', { type: 'percentage', value: '10', minOrderAmount: '1000', maxDiscount: '120' }, 1500, 120],
    ['empty basket', pct(10), 0, 0],
    ['negative subtotal', pct(10), -100, 0],
    ['non-numeric subtotal', pct(10), 'abc', 0],
    ['no coupon', null, 1500, 0],
    ['a coupon without a value', { type: 'fixed' }, 1500, 0],
  ];
  for (const [label, coupon, subtotal, expected] of TABLE) {
    test(label, () => assert.equal(couponDiscountFor(coupon, subtotal), expected));
  }

  test('the screens use the very same function (no second copy to drift)', () => {
    assert.equal(rules.couponDiscountFor, couponDiscountFor);
  });

  test('never negative, never more than the subtotal, whatever the input', () => {
    const coupons = [pct(5), pct(100), fixed(1), fixed(99999), pct(10, { maxDiscount: 1 }), fixed(500, { minOrderAmount: 2000 })];
    for (const c of coupons) {
      for (const sub of [0, 1, 99, 1500, 1999, 2000, 123456]) {
        const d = couponDiscountFor(c, sub);
        assert.ok(Number.isInteger(d) && d >= 0 && d <= sub, `${JSON.stringify(c)} on ${sub} → ${d}`);
      }
    }
  });
});

/* ══ What the screens show ══ */

describe('shownCouponDiscount — a server figure holds only for the subtotal it was given for (finding C)', () => {
  const TULSI10 = { code: 'TULSI10', type: 'percentage', value: 10, minOrderAmount: 0 };
  const BIG = { code: 'BIGFIRST', type: 'fixed', value: 500, minOrderAmount: 5000 };
  const TABLE = [
    ['applied at 3 pieces, still 3', TULSI10, 4500, { subtotal: 4500, discount: 450 }, 450],
    ['applied at 3 pieces, now 1 → recomputed', TULSI10, 1500, { subtotal: 4500, discount: 450 }, 150],
    ['the 409 COUPON_CHANGED figure for this subtotal wins over the formula', TULSI10, 1500, { subtotal: 1500, discount: 120 }, 120],
    ['no pin → formula', TULSI10, 1500, null, 150],
    ['a pin without a subtotal is no pin', TULSI10, 1500, { subtotal: null, discount: 999 }, 150],
    ['a pin that isn’t a number is no pin', TULSI10, 1500, { subtotal: 1500, discount: 'x' }, 150],
    ['qty lowered below the minimum (finding BN-2) → ₹0', BIG, 4500, { subtotal: 6000, discount: 500 }, 0],
    ['pinned figure rounded and never more than the order', TULSI10, 1500, { subtotal: 1500, discount: 99999.4 }, 1500],
    ['no coupon → 0 even with a pin', null, 1500, { subtotal: 1500, discount: 150 }, 0],
  ];
  for (const [label, coupon, subtotal, pin, expected] of TABLE) {
    test(label, () => assert.equal(shownCouponDiscount(coupon, subtotal, pin), expected));
  }

  test('the button total follows: 3 → 1 piece shows what the server charges', () => {
    const shown = shownCouponDiscount(TULSI10, 1500, { subtotal: 4500, discount: 450 });
    const { payableTotal } = checkoutAmounts({ subtotal: 1500, discount: shown, paymentMethod: 'cod', charges: DEFAULT_CHARGES });
    /* The order endpoint: 1500 − couponDiscountFor(1500) + ₹99 shipping (no COD fee above ₹500). */
    assert.equal(payableTotal, 1500 - couponDiscountFor(TULSI10, 1500) + 99);
    assert.equal(payableTotal, 1449);
  });
});

describe('loyaltyDiscountFor — the Points Discount shown is what the order endpoint takes', () => {
  /* The orders route: Math.min(parked, Math.floor(subtotal * 0.2)). */
  const server = (parked, subtotal) => Math.min(parked, Math.floor(subtotal * 0.2));
  const TABLE = [
    ['₹100 redeemed on ₹1,500', 100, 1500, 100],
    ['₹1,000 redeemed on ₹1,500 → 20% = ₹300 (was shown ₹1,000)', 1000, 1500, 300],
    ['exactly 20%', 300, 1500, 300],
    ['20% rounds down', 100, 499, 99],
    ['nothing redeemed', 0, 1500, 0],
    ['empty basket', 100, 0, 0],
  ];
  for (const [label, parked, subtotal, expected] of TABLE) {
    test(label, () => {
      assert.equal(rules.loyaltyDiscountFor(parked, subtotal), expected);
      assert.equal(rules.loyaltyDiscountFor(parked, subtotal), server(parked, subtotal));
    });
  }
  test('the share is the order endpoint’s own (no drift)', () => {
    const route = readFileSync(new URL('../src/app/api/orders/route.js', import.meta.url), 'utf8');
    assert.equal(rules.MAX_LOYALTY_SHARE, Number(/const MAX_LOYALTY_SHARE = ([\d.]+)/.exec(route)?.[1]));
  });
});

describe('below a minimum: what is still needed, read back from either server message', () => {
  const BIG = { code: 'BIGFIRST', type: 'fixed', value: 500, minOrderAmount: 5000 };
  test('couponShortfall', () => {
    assert.equal(couponShortfall(BIG, 4500), 500);
    assert.equal(couponShortfall(BIG, 4999.5), 1, 'rounded up — never “add ₹0 more”');
    assert.equal(couponShortfall(BIG, 5000), 0);
    assert.equal(couponShortfall({ ...BIG, minOrderAmount: undefined }, 10), 0);
    assert.equal(couponShortfall(null, 10), 0);
  });

  test('minimumFromMessage reads the validate 400 and the order 409 messages', () => {
    /* POST /api/coupons/validate */
    assert.equal(minimumFromMessage('Minimum order amount is ₹5000'), 5000);
    /* POST /api/orders 409 COUPON_CHANGED (min_order) */
    const msg409 = couponRefusalMessage('min_order', { code: 'BIGFIRST', minOrderAmount: 5000 });
    assert.equal(msg409, 'Minimum order amount is ₹5,000 for BIGFIRST.');
    assert.equal(minimumFromMessage(msg409), 5000);
    assert.equal(minimumFromMessage('Minimum order amount is ₹1,25,000 for X'), 125000, 'Indian digit grouping');
    assert.equal(minimumFromMessage('Coupon has expired'), 0);
    assert.equal(minimumFromMessage(undefined), 0);
  });

  test('a minimum refusal keeps the remembered code; every other 400/404 forgets it; offline/429/5xx keep it', () => {
    const TABLE = [
      [400, 'Minimum order amount is ₹5000', false],
      [400, 'This code is for your first order only.', true],
      [400, 'You have already used this coupon.', true],
      [400, 'This coupon isn’t active yet', true],
      [400, 'Coupon has expired', true],
      [400, 'Coupon usage limit reached', true],
      [404, 'Invalid coupon code', true],
      [429, 'Too many coupon attempts. Please try again later.', false],
      [500, 'boom', false],
      [0, '', false],
    ];
    for (const [status, message, definite] of TABLE) {
      assert.equal(isDefiniteCouponRejection(status, message), definite, `${status} ${message}`);
    }
  });
});

/* ══ Server-side rules ══ */

describe('who may use a code, and what counts as a placed order', () => {
  const NOW = new Date('2026-10-18T06:00:00.000Z');
  const live = { isActive: true, maxUses: 0, usedCount: 0, startsAt: null, expiresAt: null };
  const TABLE = [
    ['live, unlimited (maxUses 0)', { ...live, usedCount: 1e6 }, {}, null],
    ['switched off', { ...live, isActive: false }, {}, 'inactive'],
    ['missing', null, {}, 'inactive'],
    ['Valid From tomorrow', { ...live, startsAt: '2026-10-19T00:00:00.000Z' }, {}, 'not_started'],
    ['Valid From an hour ago', { ...live, startsAt: '2026-10-18T05:00:00.000Z' }, {}, null],
    ['expired yesterday', { ...live, expiresAt: '2026-10-17T00:00:00.000Z' }, {}, 'expired'],
    ['used up', { ...live, maxUses: 3, usedCount: 3 }, {}, 'limit'],
    ['used up — by this customer’s own unpaid attempt', { ...live, maxUses: 3, usedCount: 3 }, { ownUseCounted: true }, null],
    ['one use left', { ...live, maxUses: 3, usedCount: 2 }, {}, null],
    ['an old coupon saved with maxUses 100', { ...live, maxUses: 100, usedCount: 100 }, {}, 'limit'],
  ];
  for (const [label, c, opts, expected] of TABLE) {
    test(`couponStateRefusal: ${label}`, () => assert.equal(couponStateRefusal(c, { now: NOW, ...opts }), expected));
  }

  test('isPlacedOrder: COD or paid, never cancelled, never an abandoned online attempt', () => {
    const TABLE = [
      [{ status: 'pending', payment: { method: 'cod', status: 'pending' } }, true],
      [{ status: 'confirmed', payment: { method: 'razorpay', status: 'paid' } }, true],
      [{ status: 'delivered', payment: { method: 'razorpay', status: 'paid' } }, true],
      [{ status: 'pending', payment: { method: 'razorpay', status: 'pending' } }, false],
      [{ status: 'pending', payment: { method: 'razorpay', status: 'failed' } }, false],
      [{ status: 'cancelled', payment: { method: 'cod', status: 'pending' } }, false],
      [{ status: 'cancelled', payment: { method: 'razorpay', status: 'paid' }, paidAfterCancel: true }, false],
      [null, false],
    ];
    for (const [order, placed] of TABLE) assert.equal(isPlacedOrder(order), placed, JSON.stringify(order));
  });

  test('phone10: the delivery phone as the first-order check matches it', () => {
    for (const [raw, p] of [['9876543210', '9876543210'], ['+91 98765 43210', '9876543210'], ['+91-98765-43210', '9876543210'], ['098765 43210', '9876543210'], ['98765', ''], ['', ''], [undefined, '']]) {
      assert.equal(phone10(raw), p, String(raw));
    }
  });

  test('every refusal reason has a customer-facing message', () => {
    for (const r of ['not_found', 'inactive', 'not_started', 'expired', 'limit', 'used', 'min_order', 'sign_in_required', 'first_order_only', 'check_failed', 'something_new']) {
      const m = couponRefusalMessage(r, { code: 'TULSI10', minOrderAmount: 5000 });
      assert.ok(typeof m === 'string' && m.length > 10, r);
      assert.doesNotMatch(m, /undefined|NaN/, r);
    }
  });
});

describe('parseCouponInput — what the admin form sends (finding server/B, server/F)', () => {
  const base = { code: 'tulsi10', type: 'percentage', value: 10 };
  /* [label, extra fields, partial?, expected subset of data] */
  const TABLE = [
    ['Usage Limit left blank (placeholder "Unlimited") → unlimited', { usageLimit: '' }, false, { maxUses: 0 }],
    ['Usage Limit missing (older form) → unlimited', {}, false, { maxUses: 0 }],
    ['Usage Limit null → unlimited', { usageLimit: null }, false, { maxUses: 0 }],
    ['Usage Limit 25', { usageLimit: 25 }, false, { maxUses: 25 }],
    ['Usage Limit "25" (string from an input)', { usageLimit: '25' }, false, { maxUses: 25 }],
    ['maxUses wins over usageLimit', { maxUses: 7, usageLimit: 25 }, false, { maxUses: 7 }],
    ['an edit clearing the limit', { usageLimit: '' }, true, { maxUses: 0 }],
    ['Max Discount 500', { maxDiscount: 500 }, false, { maxDiscount: 500 }],
    ['Max Discount blank → no cap', { maxDiscount: '' }, false, { maxDiscount: null }],
    ['Max Discount 0 → no cap', { maxDiscount: 0 }, false, { maxDiscount: null }],
    ['Valid From a date → midnight in India', { validFrom: '2026-12-01' }, false, { startsAt: '2026-11-30T18:30:00.000Z' }],
    ['Valid From a full timestamp is kept', { startsAt: '2026-12-01T10:00:00.000Z' }, false, { startsAt: '2026-12-01T10:00:00.000Z' }],
    ['Valid From blank → straight away', { validFrom: '' }, false, { startsAt: null }],
    ['an edit clearing cap and start', { maxDiscount: '', validFrom: '' }, true, { maxDiscount: null, startsAt: null }],
  ];
  for (const [label, extra, partial, expected] of TABLE) {
    test(label, () => {
      const r = parseCouponInput(partial ? extra : { ...base, ...extra }, { partial });
      assert.equal(r.error, undefined, r.error);
      for (const [k, v] of Object.entries(expected)) assert.deepEqual(r.data[k], v, k);
    });
  }

  test('an edit that doesn’t send a field leaves it alone', () => {
    const r = parseCouponInput({ value: 15 }, { partial: true });
    assert.deepEqual(r.data, { value: 15 });
  });

  test('refused: negative or fractional limit, negative cap, bad date, start after expiry', () => {
    for (const extra of [{ usageLimit: -1 }, { usageLimit: 2.5 }, { usageLimit: 'lots' }, { maxDiscount: -5 }, { validFrom: 'next week' }, { validFrom: '2027-01-02', validUntil: '2027-01-01' }, { validFrom: '2027-01-01T10:00:00.000Z', validUntil: '2027-01-01T10:00:00.000Z' }]) {
      assert.ok(parseCouponInput({ ...base, ...extra }).error, JSON.stringify(extra));
    }
  });
});

/* ══ The auto-apply cool-down (finding D) ══ */

describe('keptAttemptStillHolds — a kept code is not re-checked on every page open', () => {
  const NOW = 1_800_000_000_000;
  const kept = (over = {}) => ({ code: 'WELCOME5K', orderAmount: 1500, minOrder: 0, at: NOW, ...over });

  test('the cool-down is 10 minutes', () => assert.equal(KEPT_RETRY_MS, 10 * 60_000));

  /* [label, attempt, code, orderAmount, now, skip?] */
  const TABLE = [
    ['same code, same basket, just now → skip', kept(), 'WELCOME5K', 1500, NOW + 1000, true],
    ['same basket, 9 min 59 s later → skip', kept(), 'WELCOME5K', 1500, NOW + KEPT_RETRY_MS - 1000, true],
    ['same basket, 10 minutes later → check again', kept(), 'WELCOME5K', 1500, NOW + KEPT_RETRY_MS, false],
    ['same basket, an hour later → check again', kept(), 'WELCOME5K', 1500, NOW + 3_600_000, false],
    ['a different subtotal (offline / 429 last time) → check', kept(), 'WELCOME5K', 1600, NOW + 1000, false],
    ['a different code → check', kept(), 'TULSI10', 1500, NOW + 1000, false],
    ['below its minimum, bigger basket but still below → skip', kept({ minOrder: 5000 }), 'WELCOME5K', 4999, NOW + 1000, true],
    ['below its minimum, smaller basket → skip', kept({ minOrder: 5000 }), 'WELCOME5K', 1000, NOW + 1000, true],
    ['the basket reaches the minimum → check', kept({ minOrder: 5000 }), 'WELCOME5K', 5000, NOW + 1000, false],
    ['nothing remembered → check', null, 'WELCOME5K', 1500, NOW, false],
    ['a corrupt record (no time) → check', kept({ at: 'garbage' }), 'WELCOME5K', 1500, NOW, false],
    ['a clock that went backwards stays within the window', kept({ at: NOW + 5000 }), 'WELCOME5K', 1500, NOW, true],
  ];
  for (const [label, attempt, code, amount, now, skip] of TABLE) {
    test(label, () => assert.equal(keptAttemptStillHolds(attempt, code, amount, now), skip));
  }
});
