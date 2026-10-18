/* Coupon fields staff may set, validated. Usage bookkeeping (usedCount,
   usedBy) is written only by checkout and cancellation, never from a
   request. No '@/…' imports and nothing server-only (the shopper's screens
   import couponDiscountFor): the lookups take the db as an argument. */
const CODE = /^[A-Z0-9_-]{3,30}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/* "Valid From 2026-12-01" (the admin form's date input) starts at midnight
   in India, not at 05:30 IST (UTC midnight). A full timestamp is kept as is. */
function startOfDay(v) {
  const d = new Date(DATE_ONLY.test(String(v)) ? `${v}T00:00:00+05:30` : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** @returns {{ data: object } | { error: string }} — partial when `partial`. */
export function parseCouponInput(body, { partial = false } = {}) {
  const b = body || {};
  const data = {};
  const has = (k) => b[k] !== undefined;
  const blank = (v) => v === undefined || v === null || v === '';

  if (has('code') || !partial) {
    const code = String(b.code || '').trim().toUpperCase();
    if (!CODE.test(code)) return { error: 'Code must be 3–30 letters, numbers, - or _.' };
    data.code = code;
  }
  if (has('type') || !partial) {
    const type = b.type || 'percentage';
    if (!['percentage', 'fixed'].includes(type)) return { error: 'Type must be percentage or fixed.' };
    data.type = type;
  }
  if (has('value') || !partial) {
    const v = Number(b.value);
    if (!Number.isFinite(v) || v <= 0) return { error: 'Value must be more than 0.' };
    data.value = v;
  }
  /* Blank (the form's "Unlimited") = no limit, stored as 0 — checkout, the
     coupon check and the admin list all read ≤ 0 as unlimited. Coupons
     saved earlier with the old blank → 100 keep their 100 until edited. */
  const maxUses = b.maxUses ?? b.usageLimit;
  if (maxUses !== undefined || !partial) {
    const n = blank(maxUses) ? 0 : Number(maxUses);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return { error: 'Usage limit must be a whole number (leave it blank for unlimited).' };
    data.maxUses = n;
  }
  if (has('minOrderAmount') || !partial) {
    const n = Number(b.minOrderAmount || 0);
    if (!Number.isFinite(n) || n < 0) return { error: 'Minimum order must be ₹0 or more.' };
    data.minOrderAmount = n;
  }
  /* Max discount (₹): caps a percentage (or fixed) discount — see
     couponDiscountFor. Blank or 0 = no cap, stored as null. */
  if (has('maxDiscount') || !partial) {
    const n = blank(b.maxDiscount) ? 0 : Number(b.maxDiscount);
    if (!Number.isFinite(n) || n < 0) return { error: 'Max discount must be ₹0 or more (leave it blank for no cap).' };
    data.maxDiscount = n > 0 ? n : null;
  }
  /* Valid from: the code works from this moment (blank = straight away). */
  const from = b.startsAt ?? b.validFrom;
  if (from !== undefined || !partial) {
    if (blank(from)) data.startsAt = null;
    else {
      const iso = startOfDay(from);
      if (!iso) return { error: 'Enter a valid start date.' };
      data.startsAt = iso;
    }
  }
  const exp = b.expiresAt ?? b.validUntil;
  if (exp !== undefined || !partial) {
    if (exp === null || exp === '' || exp === undefined) data.expiresAt = null;
    else if (Number.isNaN(new Date(exp).getTime())) return { error: 'Enter a valid expiry date.' };
    else data.expiresAt = new Date(exp).toISOString();
  }
  if (data.startsAt && data.expiresAt && data.startsAt >= data.expiresAt) {
    return { error: 'The start date must be before the expiry date.' };
  }
  if (has('isActive')) data.isActive = b.isActive === true;
  /* First order only (e.g. the welcome-offer code): checkout refuses it to
     a customer who already has a placed order — see hasPlacedOrder. */
  if (has('firstOrderOnly')) {
    if (typeof b.firstOrderOnly !== 'boolean') return { error: 'First order only must be on or off.' };
    data.firstOrderOnly = b.firstOrderOnly;
  } else if (!partial) data.firstOrderOnly = false;
  if (has('description')) data.description = String(b.description).slice(0, 300);
  return { data };
}

/**
 * The discount a coupon gives on an order subtotal — THE formula, shared by
 * the coupon check, the order endpoint and the shopper's screens, so what a
 * customer is shown is what they are charged. 0 when the subtotal is below
 * the coupon's minimum. Optional cap: maxDiscount (₹, > 0).
 * @param {{ type: 'percentage'|'fixed', value: number, minOrderAmount?: number, maxDiscount?: number }} c
 */
export function couponDiscountFor(c, subtotal) {
  const sub = Math.max(0, Number(subtotal) || 0);
  if (!c || sub <= 0) return 0;
  if (sub < (Number(c.minOrderAmount) || 0)) return 0;
  const value = Math.max(0, Number(c.value) || 0);
  let d = c.type === 'percentage' ? Math.round((sub * Math.min(100, value)) / 100) : Math.min(value, sub);
  const cap = Number(c.maxDiscount) || 0;
  if (cap > 0) d = Math.min(d, cap);
  return Math.max(0, Math.min(d, sub));
}

/* Percentage coupons stay within 1–100% of the order. */
export function checkCouponValue(merged) {
  if (merged.type === 'percentage' && (merged.value <= 0 || merged.value > 100)) return 'A percentage must be between 1 and 100.';
  return null;
}

/**
 * Why a coupon can't be used at all right now, whoever asks and whatever
 * the basket: 'inactive' | 'not_started' | 'expired' | 'limit' | null.
 * `ownUseCounted`: this customer already holds one of the counted uses (an
 * unpaid online attempt) — re-using it doesn't take another, so the limit
 * doesn't stop them.
 */
export function couponStateRefusal(c, { now = new Date(), ownUseCounted = false } = {}) {
  if (!c || !c.isActive) return 'inactive';
  if (c.startsAt && new Date(c.startsAt) > now) return 'not_started';
  if (c.expiresAt && new Date(c.expiresAt) < now) return 'expired';
  const maxUses = Number(c.maxUses) || 0;
  if (!ownUseCounted && maxUses > 0 && (Number(c.usedCount) || 0) >= maxUses) return 'limit';
  return null;
}

/* An order counts as placed unless it was cancelled, and only once it is
   paid online or is cash on delivery — an abandoned Razorpay attempt
   (payment still pending) is not a first order. */
export function isPlacedOrder(order) {
  if (!order || order.status === 'cancelled') return false;
  return order.payment?.status === 'paid' || order.payment?.method === 'cod';
}

/* Per lookup. A customer with more than this many orders under one key,
   none of them placed, is vanishingly rare — the cost is one discount. */
const PLACED_ORDER_SCAN = 25;

/** Last 10 digits of an Indian mobile number ('+91 98765-43210' → '9876543210'), or ''. */
export function phone10(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * Has this customer placed an order before? By account id, by email (the
 * order's guestEmail — every order stores the customer's email there) and
 * by the delivery phone. Bounded, single-field equality queries only (no
 * composite index needed). Takes the Firestore Admin db.
 *
 * Pass `email` only when the caller has PROVED it (canMatchGuestOrders):
 * otherwise anyone could open-register someone's address and learn from a
 * refusal that they have shopped here. The shipping-address email is not
 * matched — a gift sent to a bride doesn't make her a returning customer.
 * @param {object} db
 * @param {{ userId?: string|null, email?: string|null, phone?: string|null }} who
 * @returns {Promise<boolean>}
 */
export async function hasPlacedOrder(db, { userId, email, phone } = {}) {
  const orders = db.collection('orders');
  const lookups = [];
  if (userId) lookups.push(orders.where('userId', '==', String(userId)));
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (e) lookups.push(orders.where('guestEmail', '==', e));
  /* Stored as typed (checkout sends 10 digits; older or API orders may
     carry +91 / spaces): the number as typed now, and its 10-digit form. */
  const p10 = phone10(phone);
  if (p10) {
    const raw = String(phone).trim();
    for (const p of new Set([raw, p10])) lookups.push(orders.where('shippingAddress.phone', '==', p));
  }
  if (!lookups.length) return false;
  const snaps = await Promise.all(lookups.map((q) => q.select('status', 'payment').limit(PLACED_ORDER_SCAN).get()));
  return snaps.some((snap) => snap.docs.some((d) => isPlacedOrder(d.data())));
}

/**
 * This customer's orders that used this coupon (equality filters only —
 * Firestore merges the two single-field indexes, no composite needed).
 * Pass `tx` to read inside a transaction.
 * @returns {Promise<{ placed: boolean, holders: object[] }>}
 *   placed  — one of them is a real order (isPlacedOrder): the use is spent
 *   holders — refs of the unplaced ones still holding the counted use
 *             (no couponReleased), e.g. an abandoned Razorpay attempt
 */
export async function couponUsesBy(db, { couponId, userKey }, tx = null) {
  const q = db.collection('orders')
    .where('couponUserKey', '==', String(userKey))
    .where('coupon', '==', String(couponId))
    .select('status', 'payment', 'couponReleased')
    .limit(PLACED_ORDER_SCAN);
  const snap = await (tx ? tx.get(q) : q.get());
  let placed = false;
  const holders = [];
  for (const d of snap.docs) {
    const o = d.data() || {};
    if (isPlacedOrder(o)) placed = true;
    else if (!o.couponReleased) holders.push(d.ref);
  }
  return { placed, holders };
}

/* What the shopper is told when checkout can't apply a code as shown. */
export function couponRefusalMessage(reason, { code = 'This code', minOrderAmount = 0 } = {}) {
  const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
  switch (reason) {
    case 'not_found': return `${code} is not a valid coupon code.`;
    case 'inactive': return `${code} is no longer active.`;
    case 'not_started': return `${code} isn’t active yet.`;
    case 'expired': return `${code} has expired.`;
    case 'limit': return `${code} has reached its usage limit.`;
    case 'used': return `You have already used ${code}.`;
    case 'min_order': return `Minimum order amount is ${inr(minOrderAmount)} for ${code}.`;
    case 'sign_in_required': return `Please sign in to use ${code} — it is for your first order only.`;
    case 'first_order_only': return 'This code is for your first order only.';
    case 'check_failed': return `We couldn’t check ${code} just now. Please try again.`;
    default: return `${code} can’t be used on this order.`;
  }
}
