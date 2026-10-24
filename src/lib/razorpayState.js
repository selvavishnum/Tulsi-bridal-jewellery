import Razorpay from 'razorpay';
import { settlePaidOrder } from '@/lib/settlePayment';

/* What Razorpay says about an online order's payment, read the same way by
   checkout (POST /api/orders, before it takes an abandoned attempt over;
   create-order and the page's own give-up, before they answer "already
   paid") and the daily clean-up (cron/expire-unpaid-orders). */

/* What checkout says when an earlier payment may still go through (409
   EARLIER_PAYMENT_PENDING): one in progress, or one Razorpay says is paid
   although it can't be confirmed from here (the webhook will). */
export const PAYMENT_IN_PROGRESS_MESSAGE = 'Your earlier payment is still being processed. Please wait a few minutes and check My Orders before paying again.';
export const PAYMENT_UNCHECKED_MESSAGE = "We couldn't check your earlier payment just now. Please try again in a minute.";

/* The Razorpay client, or null when Razorpay isn't configured. */
export function razorpayClient() {
  const { RAZORPAY_KEY_ID: key_id, RAZORPAY_KEY_SECRET: key_secret } = process.env;
  return key_id && key_secret ? new Razorpay({ key_id, key_secret }) : null;
}

/* A payment that took no money and never will: declined, or refunded — an
   authorization never captured is released by Razorpay as 'refunded'. */
const DEAD = new Set(['failed', 'refunded']);

/* Rejects once `ms` has passed: a slow Razorpay must not hold up the caller. */
function within(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), Math.max(0, ms)); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * What Razorpay says about a Razorpay order:
 *   'unpaid'    created, or every payment failed or was refunded — nothing
 *               on it can still be paid: safe to cancel or take over
 *   'paid'      a payment was captured — `payment` is that payment
 *               ({ id, amount, … }), or null if the payments can't be read
 *   'attempted' a payment is authorized or still in progress (or the
 *               payments can't be read) — it may still be captured
 *   'unknown'   Razorpay unreachable, too slow (timeoutMs) or an odd answer
 * Only 'unpaid' means "never paid".
 * @returns {Promise<{ state: string, payment: object|null }>}
 */
export async function razorpayState(razorpay, razorpayOrderId, { timeoutMs = 5000, tag = '[razorpay]' } = {}) {
  const deadline = Date.now() + timeoutMs;
  const ask = (call) => within(call(), deadline - Date.now());
  let rzpOrder;
  try {
    rzpOrder = await ask(() => razorpay.orders.fetch(String(razorpayOrderId)));
  } catch (e) {
    console.error(`${tag} Razorpay order check failed:`, razorpayOrderId, e?.error?.description || e?.message);
    return { state: 'unknown', payment: null };
  }
  if (rzpOrder?.status === 'created') return { state: 'unpaid', payment: null };
  if (rzpOrder?.status !== 'paid' && rzpOrder?.status !== 'attempted') return { state: 'unknown', payment: null };
  /* Paid or attempted: the payments say which one, and which payment. */
  const otherwise = { state: rzpOrder.status === 'paid' ? 'paid' : 'attempted', payment: null };
  let items;
  try {
    items = (await ask(() => razorpay.orders.fetchPayments(String(razorpayOrderId))))?.items;
  } catch {
    return otherwise;
  }
  if (!Array.isArray(items)) return otherwise;
  const captured = items.find((p) => p?.status === 'captured');
  if (captured) return { state: 'paid', payment: captured };
  if (items.length > 0 && items.every((p) => DEAD.has(p?.status))) return { state: 'unpaid', payment: null };
  return otherwise;
}

/* The captured payment covers what the order asked for — checked before
   confirming it, as verify and the webhook do. */
export function paysInFull(order, payment) {
  const due = Number(order?.payment?.amountDue ?? Math.round(Number(order?.total) * 100));
  return !!payment?.id && Number.isFinite(due) && Number(payment.amount) >= due;
}

/**
 * An unpaid online order, and what Razorpay says about its payment — an
 * order Razorpay reports paid is confirmed right here, through the same
 * path as verify and the webhook (settlePaidOrder: stock, points, the
 * customer's "order confirmed"), so every route that finds a payment we
 * hadn't heard about confirms it the same way.
 * @param {object} order the order's data (payment.razorpayOrderId, amountDue)
 * @returns {Promise<{ state: string, paidAfterCancel?: boolean }>}
 *   'unpaid' | 'attempted' | 'unknown'  as razorpayState — nothing was done
 *   'settled'  paid, and settled now; paidAfterCancel: the order had been
 *              cancelled or replaced — recorded for a refund, not placed
 *   'unsure'   Razorpay says paid but the payment can't be read, doesn't
 *              cover the order, or settling failed — left to the webhook
 */
export async function settleIfPaid(db, orderRef, order, razorpay, { timeoutMs, tag = '[razorpay]' } = {}) {
  const { state, payment } = await razorpayState(razorpay, order?.payment?.razorpayOrderId, { timeoutMs, tag });
  if (state !== 'paid') return { state };
  if (!paysInFull(order, payment)) return { state: 'unsure' };
  try {
    const { paidAfterCancel } = await settlePaidOrder(db, orderRef, { razorpayPaymentId: payment.id });
    return { state: 'settled', paidAfterCancel };
  } catch (e) {
    console.error(`${tag} settling order`, orderRef.id, 'failed:', e?.message);
    return { state: 'unsure' };
  }
}
