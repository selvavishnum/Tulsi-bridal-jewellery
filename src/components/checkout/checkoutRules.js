/* ─────────────────────────────────────────────
   Checkout rules shared by the /checkout page and the Buy Now drawer.

   Display copies of what POST /api/orders enforces: the server recomputes
   every price, fee, coupon and limit, so these only decide what the
   customer sees before submitting.

   Pure module (one import: the shared charges rule) — safe in tests.
   ───────────────────────────────────────────── */
import { computeCharges } from '../../lib/storeCharges.js';

/* Mirrors the enforced limit in src/app/api/orders/route.js — shown here only
   for the customer's benefit before they submit. The server is authoritative. */
export const COD_MAX_ORDER_VALUE = 20000;

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

/**
 * The discount a validated coupon gives on this subtotal — the same formula
 * as /api/coupons/validate and /api/orders, so changing the quantity in the
 * drawer updates it without another (rate-limited) validation call.
 */
export function couponDiscountFor(coupon, subtotal) {
  if (!coupon) return 0;
  const sub = Math.max(0, Number(subtotal) || 0);
  const value = Number(coupon.value) || 0;
  if (coupon.type === 'percentage') return Math.round((sub * value) / 100);
  return Math.min(value, sub);
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

/* Sign-in from the Buy Now drawer: come back to the product with the
   drawer reopened for the same quantity (?buynow=<qty>). */
export function buyNowSignInUrl(productId, qty) {
  const back = `/product/${encodeURIComponent(String(productId || ''))}?buynow=${Math.max(1, Math.round(Number(qty) || 1))}`;
  return `/login?callbackUrl=${encodeURIComponent(back)}`;
}
