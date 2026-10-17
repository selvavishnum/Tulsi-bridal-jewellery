/* Coupon fields staff may set, validated. Usage bookkeeping (usedCount,
   usedBy) is written only by checkout and cancellation, never from a
   request. No '@/…' imports: hasPlacedOrder takes the db as an argument. */
const CODE = /^[A-Z0-9_-]{3,30}$/;

/** @returns {{ data: object } | { error: string }} — partial when `partial`. */
export function parseCouponInput(body, { partial = false } = {}) {
  const b = body || {};
  const data = {};
  const has = (k) => b[k] !== undefined;

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
  const maxUses = b.maxUses ?? b.usageLimit;
  if (maxUses !== undefined || !partial) {
    const n = maxUses === undefined || maxUses === '' ? 100 : Number(maxUses);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return { error: 'Usage limit must be a whole number of at least 1.' };
    data.maxUses = n;
  }
  if (has('minOrderAmount') || !partial) {
    const n = Number(b.minOrderAmount || 0);
    if (!Number.isFinite(n) || n < 0) return { error: 'Minimum order must be ₹0 or more.' };
    data.minOrderAmount = n;
  }
  const exp = b.expiresAt ?? b.validUntil;
  if (exp !== undefined || !partial) {
    if (exp === null || exp === '' || exp === undefined) data.expiresAt = null;
    else if (Number.isNaN(new Date(exp).getTime())) return { error: 'Enter a valid expiry date.' };
    else data.expiresAt = new Date(exp).toISOString();
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

/* Percentage coupons stay within 1–100% of the order. */
export function checkCouponValue(merged) {
  if (merged.type === 'percentage' && (merged.value <= 0 || merged.value > 100)) return 'A percentage must be between 1 and 100.';
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

/**
 * Has this customer placed an order before? By account id, and by email —
 * the order's guestEmail (every order stores the customer's email there)
 * and the email on its shipping address. Bounded, single-field equality
 * queries only (no composite index needed). Takes the Firestore Admin db.
 * @param {object} db
 * @param {{ userId?: string|null, email?: string|null }} who
 * @returns {Promise<boolean>}
 */
export async function hasPlacedOrder(db, { userId, email } = {}) {
  const orders = db.collection('orders');
  const lookups = [];
  if (userId) lookups.push(orders.where('userId', '==', String(userId)));
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (e) {
    lookups.push(orders.where('guestEmail', '==', e));
    lookups.push(orders.where('shippingAddress.email', '==', e));
  }
  if (!lookups.length) return false;
  const snaps = await Promise.all(lookups.map((q) => q.select('status', 'payment').limit(PLACED_ORDER_SCAN).get()));
  return snaps.some((snap) => snap.docs.some((d) => isPlacedOrder(d.data())));
}
