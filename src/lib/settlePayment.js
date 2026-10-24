import { after } from 'next/server';
import { awardLoyaltyPoints } from '@/lib/loyalty';
import { notifyVendorsOfOrder } from '@/lib/vendorNotify';
import { sendOrderConfirmation } from '@/lib/email';
import { sendOrderWhatsAppToCustomer } from '@/lib/whatsapp';
import { toCustomerOrder } from '@/lib/settlement';

/* The customer's "order confirmed" (email + WhatsApp) for an online order,
   sent once, after the response, and claimed first:
     customerConfirmClaimedAt  set in the transaction that confirms the
                               order — the one call that sets it sends;
                               set back to null if a send failed
     customerConfirmedAt       set once everything went out
     customerConfirmedVia      the channels that went out when another
                               failed (a retry sends only the rest)
   A call that finds the order paid, confirmed and not yet told about (the
   claim released, or its holder's request died: older than the lease) takes
   the claim and sends — nothing else is redone. An order paid before these
   fields existed was told when it was placed: left alone. */
const CHANNELS = ['email', 'whatsapp'];
const CHANNEL_TAG = { email: '[Email]', whatsapp: '[WhatsApp]' };
const CLAIM_LEASE_MS = 5 * 60_000;

/* Marks an order paid and deducts stock exactly once, no matter how many
   times — or from how many entry points — this runs for the same order.
   The client-triggered /api/payments/verify call and the Razorpay webhook
   both call this after independently verifying the payment is real; this
   function only handles applying the side effects safely once, via a
   transaction with an idempotency check as its first read. Money is
   already captured by the time either caller gets here, so stock is
   floored at 0 (never rejected) — any shortfall is recorded on the order
   for an admin to follow up rather than silently absorbed.

   Returns { alreadySettled, paidAfterCancel }: paidAfterCancel = the money
   arrived for an order that had been cancelled or replaced — it was
   recorded and flagged for a refund (refundDue), nothing else. A repeat
   call (verify, then the webhook) gives the same paidAfterCancel.

   The customer is told after the response (after()), or at once where
   there is no request (tests, scripts): a slow mail server or WhatsApp
   can't hold up verify or the webhook. */
export async function settlePaidOrder(db, orderRef, { razorpayPaymentId, razorpaySignature } = {}) {
  const paidAt = new Date().toISOString();
  let alreadySettled = false;
  let paidAfterCancel = false;
  let refundRecorded = false;
  let toTell = null; // the channels this call claimed the customer's "order confirmed" for
  let toldVia = [];

  await db.runTransaction(async (tx) => {
    /* Reset: Firestore may run this more than once. */
    alreadySettled = false;
    paidAfterCancel = false;
    refundRecorded = false;
    toTell = null;
    toldVia = [];
    const freshOrder = await tx.get(orderRef);
    if (!freshOrder.exists) throw new Error('Order not found');
    const current = freshOrder.data() || {};
    if (current.payment?.status === 'paid') {
      alreadySettled = true;
      paidAfterCancel = current.paidAfterCancel === true;
      /* Confirmed, but the customer was never told (the send failed, or its
         request died): this call sends it, nothing else is redone. */
      toTell = paidAfterCancel ? null : confirmationDue(current, Date.now());
      if (toTell) {
        toldVia = current.customerConfirmedVia || [];
        tx.update(orderRef, { customerConfirmClaimedAt: paidAt });
      }
      return;
    }
    /* A payment attempt whose coupon use or parked loyalty discount a newer
       order of the customer's took over (POST /api/orders replaces it) —
       one saved before replaced attempts were cancelled in the same step.
       Confirming it would give that discount twice. */
    const replacedBy = current.status === 'pending' ? (current.couponMovedTo || current.loyaltyMovedTo || null) : null;
    /* Paid for an order that was already cancelled (e.g. a second tab, or
       replaced by a newer order): record the money and flag a refund
       (refundDue — "Refund due" in the admin's orders), but don't revive
       the order, deduct stock, award points or apply any discount again. */
    if (current.status === 'cancelled' || replacedBy) {
      const cancelledUpdate = { 'payment.status': 'paid', 'payment.paidAt': paidAt, paidAfterCancel: true, refundDue: true, updatedAt: paidAt };
      if (razorpayPaymentId) cancelledUpdate['payment.razorpayPaymentId'] = razorpayPaymentId;
      if (replacedBy) Object.assign(cancelledUpdate, { status: 'cancelled', cancelReason: 'replaced', replacedBy, cancelledAt: paidAt });
      tx.update(orderRef, cancelledUpdate);
      alreadySettled = true; // no side effects below
      paidAfterCancel = true;
      refundRecorded = true;
      return;
    }

    const items = (current.items || []).filter((i) => i.product);
    const prodRefs = items.map((i) => db.collection('products').doc(i.product));
    const prodDocs = prodRefs.length ? await Promise.all(prodRefs.map((r) => tx.get(r))) : [];

    const orderUpdate = {
      'payment.status': 'paid',
      'payment.paidAt': paidAt,
      status: 'confirmed',
      stockDeducted: true,
      updatedAt: paidAt,
    };
    if (razorpayPaymentId) orderUpdate['payment.razorpayPaymentId'] = razorpayPaymentId;
    if (razorpaySignature) orderUpdate['payment.razorpaySignature'] = razorpaySignature;
    /* The customer's "order confirmed" is claimed here, with the
       confirmation, so no other call sends it (COD is told when placed). */
    if (current.payment?.method !== 'cod') {
      orderUpdate.customerConfirmClaimedAt = paidAt;
      toTell = CHANNELS;
    }

    const oversold = [];
    prodDocs.forEach((prodDoc, idx) => {
      if (!prodDoc.exists) return;
      const currentStock = Number(prodDoc.data().stock) || 0;
      const qty = Math.max(0, Math.floor(Number(items[idx].quantity) || 0));
      const shortfall = qty - currentStock;
      if (shortfall > 0) oversold.push({ product: items[idx].product, name: items[idx].name, shortBy: shortfall });
      tx.update(prodRefs[idx], { stock: Math.max(0, currentStock - qty) });
    });
    if (oversold.length > 0) orderUpdate.oversoldItems = oversold;

    tx.update(orderRef, orderUpdate);
  });

  if (refundRecorded) console.warn('[settlePayment] payment for cancelled/replaced order', orderRef.id, '— refund due');
  if (!alreadySettled) {
    await awardLoyaltyPoints(orderRef).catch((e) => console.error('[Loyalty] award failed:', e.message));
    /* Online order is now real: tell its vendors (once — flag on the order). */
    await notifyVendorsOfOrder(db, orderRef.id).catch((e) => console.error('[Email] Vendor notification failed:', e.message));
  }
  /* ...and the customer: an online order is placed when it is paid, so
     its "order confirmed" email and WhatsApp go now (POST /api/orders
     sends them for COD only) — to the one call that claimed them above,
     never for a payment being refunded. */
  if (toTell) {
    const channels = toTell;
    const already = toldVia;
    await afterResponse(() => tellCustomer(orderRef, channels, already));
  }
  return { alreadySettled, paidAfterCancel };
}

/* The channels still to send for an order that is paid and confirmed, or
   null: nothing to send (COD, cancelled, already told, told before claims
   existed, or someone is sending it right now). */
function confirmationDue(order, now) {
  if (order.payment?.method === 'cod' || order.status === 'cancelled' || order.customerConfirmedAt) return null;
  if (order.customerConfirmClaimedAt === undefined) return null;
  const claimed = Date.parse(order.customerConfirmClaimedAt);
  if (Number.isFinite(claimed) && now - claimed < CLAIM_LEASE_MS) return null;
  const due = CHANNELS.filter((c) => !(order.customerConfirmedVia || []).includes(c));
  return due.length ? due : null;
}

/* After the response when inside a request (Next's after()); right now
   where there is none (tests, scripts) or after() isn't available. */
async function afterResponse(task) {
  try {
    after(task);
  } catch {
    await task();
  }
}

/* Sends the claimed channels. All out → customerConfirmedAt. One failed
   (it threw, or the mail server refused) → the claim is released and the
   channels that went out are remembered, so the next call that finds the
   order paid sends only the rest. Never throws. */
async function tellCustomer(orderRef, channels, already) {
  const delivered = [];
  try {
    const snap = await orderRef.get();
    if (!snap.exists) return;
    /* Cancelled between the claim and the send: the cancellation message
       has gone (or will), so no "order confirmed" after it. The claim just
       lapses — confirmationDue never retries a cancelled order. */
    if (snap.data().status === 'cancelled' || snap.data().paidAfterCancel) return;
    const order = toCustomerOrder({ id: snap.id, _id: snap.id, ...snap.data() });
    const send = {
      /* sendOrderConfirmation answers false when the mail server refused it. */
      email: async () => { if ((await sendOrderConfirmation(order)) === false) throw new Error('mail not sent'); },
      whatsapp: () => sendOrderWhatsAppToCustomer(order),
    };
    await Promise.all(channels.map((c) => Promise.resolve().then(send[c]).then(
      () => { delivered.push(c); },
      (e) => console.error(`${CHANNEL_TAG[c]} Customer confirmation failed:`, e?.message),
    )));
    const failed = channels.some((c) => !delivered.includes(c));
    await orderRef.update(failed
      ? { customerConfirmClaimedAt: null, customerConfirmedVia: [...already, ...delivered] }
      : { customerConfirmedAt: new Date().toISOString() });
  } catch (e) {
    /* Not released: the claim lapses and a later call sends it. */
    console.error('[settlePayment] customer confirmation bookkeeping failed:', orderRef.id, e?.message);
  }
}
