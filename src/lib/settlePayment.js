import { awardLoyaltyPoints } from '@/lib/loyalty';

/* Marks an order paid and deducts stock exactly once, no matter how many
   times — or from how many entry points — this runs for the same order.
   The client-triggered /api/payments/verify call and the Razorpay webhook
   both call this after independently verifying the payment is real; this
   function only handles applying the side effects safely once, via a
   transaction with an idempotency check as its first read. Money is
   already captured by the time either caller gets here, so stock is
   floored at 0 (never rejected) — any shortfall is recorded on the order
   for an admin to follow up rather than silently absorbed. */
export async function settlePaidOrder(db, orderRef, { razorpayPaymentId, razorpaySignature } = {}) {
  const paidAt = new Date().toISOString();
  let alreadySettled = false;

  await db.runTransaction(async (tx) => {
    const freshOrder = await tx.get(orderRef);
    if (!freshOrder.exists) throw new Error('Order not found');
    if (freshOrder.data()?.payment?.status === 'paid') {
      alreadySettled = true;
      return;
    }
    /* Paid for an order that was already cancelled (e.g. a second tab):
       record the money for a refund, but don't revive the order, deduct
       stock or award points. */
    if (freshOrder.data()?.status === 'cancelled') {
      const cancelledUpdate = { 'payment.status': 'paid', 'payment.paidAt': paidAt, paidAfterCancel: true, updatedAt: paidAt };
      if (razorpayPaymentId) cancelledUpdate['payment.razorpayPaymentId'] = razorpayPaymentId;
      tx.update(orderRef, cancelledUpdate);
      alreadySettled = true; // no side effects below
      return;
    }

    const items = (freshOrder.data().items || []).filter((i) => i.product);
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

  if (!alreadySettled) {
    await awardLoyaltyPoints(orderRef).catch((e) => console.error('[Loyalty] award failed:', e.message));
  }
  return { alreadySettled };
}
