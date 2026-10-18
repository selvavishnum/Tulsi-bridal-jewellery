import { awardLoyaltyPoints } from '@/lib/loyalty';
import { notifyVendorsOfOrder } from '@/lib/vendorNotify';

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
   recorded and flagged for a refund (refundDue), nothing else. */
export async function settlePaidOrder(db, orderRef, { razorpayPaymentId, razorpaySignature } = {}) {
  const paidAt = new Date().toISOString();
  let alreadySettled = false;
  let paidAfterCancel = false;

  await db.runTransaction(async (tx) => {
    const freshOrder = await tx.get(orderRef);
    if (!freshOrder.exists) throw new Error('Order not found');
    const current = freshOrder.data() || {};
    if (current.payment?.status === 'paid') {
      alreadySettled = true;
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

  if (paidAfterCancel) console.warn('[settlePayment] payment for cancelled/replaced order', orderRef.id, '— refund due');
  if (!alreadySettled) {
    await awardLoyaltyPoints(orderRef).catch((e) => console.error('[Loyalty] award failed:', e.message));
    /* Online order is now real: tell its vendors (once — flag on the order). */
    await notifyVendorsOfOrder(db, orderRef.id).catch((e) => console.error('[Email] Vendor notification failed:', e.message));
  }
  return { alreadySettled, paidAfterCancel };
}
