/* ─────────────────────────────────────────────
   Checkout rules shared by the /checkout page and the Buy Now drawer.

   Display copies of what POST /api/orders enforces: the server recomputes
   every price, fee, coupon and limit, so these only decide what the
   customer sees before submitting.

   Pure module (imports only the shared charges and coupon rules) — safe in
   tests.
   ───────────────────────────────────────────── */
import { computeCharges } from '../../lib/storeCharges.js';
import { couponDiscountFor } from '../../lib/coupons.js';

/* Mirrors the enforced limit in src/app/api/orders/route.js — shown here only
   for the customer's benefit before they submit. The server is authoritative. */
export const COD_MAX_ORDER_VALUE = 20000;

/* Mirrors the order endpoint (MAX_LOYALTY_SHARE in src/app/api/orders/route.js):
   parked loyalty points pay for at most this share of the subtotal; the
   rest stays parked for a later order. Display copy — the server decides. */
export const MAX_LOYALTY_SHARE = 0.2;

/** The most points discount an order of this subtotal can take (₹). */
export function loyaltyCapFor(subtotal) {
  return Math.floor(Math.max(0, Number(subtotal) || 0) * MAX_LOYALTY_SHARE);
}

/** The points discount an order takes from `parked` ₹ of redeemed points. */
export function loyaltyDiscountFor(parked, subtotal) {
  return Math.max(0, Math.min(Number(parked) || 0, loyaltyCapFor(subtotal)));
}

/* Indian mobile number, 10 digits starting 6–9 (what checkout asks for). */
export const PHONE_RE = /^[6-9]\d{9}$/;

/* What's typed, pasted or autofilled into the mobile field → at most 10
   digits. Autofill and paste often bring the country code or trunk zero
   ("+91 98765 43210", "098765 43210"); those are dropped only when the
   length says that's what they are, so a number being typed is never cut. */
export function normalizeMobileInput(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 14 && d.startsWith('0091')) d = d.slice(4);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

/* The order endpoint refuses quantities above this on one line. */
export const MAX_LINE_QTY = 999;

/**
 * Every amount the summary shows, from the admin's current charges.
 * Same rule the server applies (src/lib/storeCharges.js): switching the
 * payment method re-computes instantly.
 */
export function checkoutAmounts({ subtotal, discount = 0, loyaltyDiscount = 0, paymentMethod, charges, codAvailable = true }) {
  const { shipping: shippingCost } = computeCharges({ subtotal, paymentMethod: null, charges });
  const total = subtotal - discount + shippingCost;
  const codFeeIfSelected = computeCharges({ subtotal, paymentMethod: 'cod', charges }).codFee;
  const { codFee } = computeCharges({ subtotal, paymentMethod, charges });
  const codBlockedByValue = (total - loyaltyDiscount) > COD_MAX_ORDER_VALUE;
  const codBlocked = codBlockedByValue || !codAvailable;
  const payableTotal = total - loyaltyDiscount + codFee;
  return { shippingCost, total, codFee, codFeeIfSelected, codBlockedByValue, codBlocked, payableTotal };
}

/** Never let a disabled option sit selected. */
export function correctedPaymentMethod(method, { codBlocked, onlinePaymentEnabled }) {
  if (method === 'cod' && codBlocked && onlinePaymentEnabled) return 'razorpay';
  if (method === 'razorpay' && !onlinePaymentEnabled) return 'cod';
  return method;
}

/* A saved address → the checkout form's address fields. */
export function fillFromAddress(prev, a) {
  return {
    ...prev,
    fullName: a.fullName || prev.fullName,
    phone: a.phone || prev.phone,
    street: a.street,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
  };
}

/* What a customer pays for one piece (as the order endpoint prices it). */
export function unitPriceOf(product) {
  return Number(product?.discountPrice) || Number(product?.price) || 0;
}

/* How many of this piece can be ordered: its stock, capped at what one
   order line allows. A missing stock figure is 0 — the server treats it so. */
export function maxOrderQty(product) {
  const stock = Math.floor(Number(product?.stock) || 0);
  return Math.max(0, Math.min(MAX_LINE_QTY, stock));
}

/* A quantity within 1..max (1 when nothing is in stock: the order is
   blocked separately). */
export function clampQty(qty, max) {
  const q = Math.round(Number(qty) || 1);
  return Math.max(1, Math.min(Math.max(1, max), q));
}

/* THE coupon formula (src/lib/coupons.js: minimum order, percentage or
   fixed, optional cap) — the same one /api/coupons/validate and /api/orders
   use, so changing the quantity updates the discount without another
   (rate-limited) validation call. */
export { couponDiscountFor };

/**
 * The coupon discount to show on this subtotal. `pin` is a figure the server
 * gave for one exact subtotal ({ subtotal, discount }: the coupon check, or
 * a 409 COUPON_CHANGED from the order endpoint); it is used while the
 * subtotal is still that one, and the formula takes over once it changes.
 */
export function shownCouponDiscount(coupon, subtotal, pin) {
  if (!coupon) return 0;
  const sub = Math.max(0, Number(subtotal) || 0);
  const pinned = pin && pin.subtotal !== null && pin.subtotal !== undefined ? Number(pin.discount) : NaN;
  if (Number.isFinite(pinned) && Number(pin.subtotal) === sub) return Math.max(0, Math.min(Math.round(pinned), sub));
  return couponDiscountFor(coupon, sub);
}

/** How much more the order needs before the coupon's minimum is met (0 when it is). */
export function couponShortfall(coupon, subtotal) {
  const min = Number(coupon?.minOrderAmount) || 0;
  const sub = Math.max(0, Number(subtotal) || 0);
  return coupon && sub < min ? Math.ceil(min - sub) : 0;
}

/* "Minimum order amount is ₹5,000" → 5000 (0 when the message has none). */
export function minimumFromMessage(message) {
  const m = /minimum order[^\d]*(\d[\d,]*(?:\.\d+)?)/i.exec(String(message || ''));
  return m ? Number(m[1].replace(/,/g, '')) || 0 : 0;
}

/* /api/coupons/validate answers 400 (inactive, expired, used up, first
   order only, minimum not met) or 404 (no such code) when the code can't be
   used. Anything else — offline, 429 rate limit, 5xx — says nothing about
   the code, so a remembered code is kept for next time. "Minimum order
   amount" is about this basket, not the code: a bigger order can still use
   it, so that one is not definite either. */
export function isDefiniteCouponRejection(status, message = '') {
  if (status !== 400 && status !== 404) return false;
  return !/minimum order/i.test(String(message || ''));
}

/* Where checkout lands after an order is placed. */
export function orderSuccessPath(orderNumber, email) {
  return `/order-success?orderNumber=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}`;
}

/* The product page with Buy Now reopened for that quantity once it has
   loaded (?buynow=<qty>, see src/components/product/useBuyNowReturn.js). */
export function buyNowReturnPath(productId, qty) {
  return `/product/${encodeURIComponent(String(productId || ''))}?buynow=${Math.max(1, Math.round(Number(qty) || 1))}`;
}

/* Sign-in from the Buy Now drawer: come back to the product with the
   drawer reopened for the same quantity. */
export function buyNowSignInUrl(productId, qty) {
  return `/login?callbackUrl=${encodeURIComponent(buyNowReturnPath(productId, qty))}`;
}

export const BUY_NOW_RELOADING = 'Opening checkout…';
export const BUY_NOW_REFRESH = 'Couldn’t open checkout — please refresh the page';

/**
 * The Buy Now drawer's code failed to load. Retrying import() in the same
 * page never helps: the bundler's runtime (Turbopack) keeps the failed
 * chunk load and hands it back on every later import(). A fresh page load
 * does help (and fetches the current build's chunks after a deploy).
 *   → { reloadTo, message }: load `reloadTo` (the product with Buy Now
 *     reopened), saying `message`;
 *   → { reloadTo: null, message } when this page load already came from
 *     ?buynow: loading it again would loop, so ask for a refresh and stop.
 */
export function buyNowLoadFailure({ productId, qty, openedWithBuyNow }) {
  if (openedWithBuyNow) return { reloadTo: null, message: BUY_NOW_REFRESH };
  return { reloadTo: buyNowReturnPath(productId, qty), message: BUY_NOW_RELOADING };
}
