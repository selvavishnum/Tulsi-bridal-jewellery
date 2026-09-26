/* ─────────────────────────────────────────────
   The one code path that changes an order's status.

   Used by the admin order route and the vendor portal, so stock, loyalty,
   coupon, vendor-settlement and notification side effects can never drift
   apart between them. Who may make which change is the caller's job — it
   passes a `check(currentOrder)` that runs inside the transaction (on the
   fresh document) and throws OrderStateError to refuse.
   ───────────────────────────────────────────── */
import { docToObj, FieldValue } from '@/lib/firebase';
import { sendStatusUpdateEmail } from '@/lib/email';
import { sendStatusWhatsApp } from '@/lib/whatsapp';
import { awardLoyaltyPoints, reverseOrderRewards } from '@/lib/loyalty';
import { postDeliverySettlement, reverseOrderSettlements } from '@/lib/vendorLedger';

export class OrderStateError extends Error {}

/**
 * @param {object} db
 * @param {string} id  order id
 * @param {object} change  { status?, trackingNumber?, courierName?, notes?, shippingCostPatch?, extra? }
 * @param {object} opts
 *   check(currentOrder)      throw OrderStateError to refuse (runs in the transaction)
 *   writeFulfilmentFields    may set tracking / courier / notes / courier charge
 *   codPaidOnDelivery        "delivered" also marks COD cash as received (staff only —
 *                            a vendor saying "delivered" doesn't prove Tulsi has the cash)
 * @returns {{ before, after, settlementError, settlementNote }}
 */
export async function applyOrderUpdate(db, id, change, opts = {}) {
  const { status, trackingNumber, courierName, notes, shippingCostPatch, extra } = change;
  const { check, writeFulfilmentFields = false, codPaidOnDelivery = true } = opts;
  const ref = db.collection('orders').doc(id);

  /* The whole read-decide-write cycle runs inside one transaction so a
     second update racing in (another tab, a double-click, a retry) can't
     read the same pre-decrement stock number this one just read. */
  let currentOrder = {};
  await db.runTransaction(async (tx) => {
    const currentDoc = await tx.get(ref);
    if (!currentDoc.exists) throw new OrderStateError('Order not found');
    currentOrder = currentDoc.data();
    if (check) check(currentOrder);

    const now = new Date().toISOString();
    const update = { updatedAt: now, ...(extra || {}) };

    if (status) {
      update.status = status;
      if (status === 'shipped' && currentOrder.status !== 'shipped') update.shippedAt = now;
      if (status === 'delivered') {
        update.deliveredAt = currentOrder.deliveredAt && currentOrder.status === 'delivered' ? currentOrder.deliveredAt : now;
        /* COD is collected on delivery — mark it paid so points can be awarded */
        if (codPaidOnDelivery && currentOrder.payment?.method === 'cod' && currentOrder.payment?.status !== 'paid') {
          update['payment.status'] = 'paid';
          update['payment.paidAt'] = now;
        }
      }
      if (status === 'cancelled') update.cancelledAt = now;

      /* Deduct stock on confirmation — skip if already deducted (e.g. by payment verification) */
      if (status === 'confirmed' && !currentOrder.stockDeducted) {
        const items = (currentOrder.items || []).filter((i) => i.product);
        const prodRefs = items.map((i) => db.collection('products').doc(i.product));
        const prodDocs = prodRefs.length ? await Promise.all(prodRefs.map((r) => tx.get(r))) : [];
        /* Stock is floored at 0; a shortfall is a real oversell and is
           recorded for an admin to follow up (refund/backorder). */
        const oversold = [];
        prodDocs.forEach((prodDoc, idx) => {
          if (!prodDoc.exists) return;
          const item = items[idx];
          const currentStock = Number(prodDoc.data().stock) || 0;
          const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
          const shortfall = qty - currentStock;
          if (shortfall > 0) oversold.push({ product: item.product, name: item.name, shortBy: shortfall });
          tx.update(prodRefs[idx], { stock: Math.max(0, currentStock - qty) });
        });
        update.stockDeducted = true;
        if (oversold.length > 0) update.oversoldItems = oversold;
      }

      /* Restore stock on cancellation — only if it was actually deducted
         and only once (stockDeducted flips back to false immediately). */
      if (status === 'cancelled' && currentOrder.stockDeducted && currentOrder.status !== 'cancelled') {
        for (const item of (currentOrder.items || [])) {
          if (!item.product) continue;
          const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
          if (qty > 0) tx.update(db.collection('products').doc(item.product), { stock: FieldValue.increment(qty) });
        }
        update.stockDeducted = false;
        update.stockRestoredAt = now;
      }
    }
    if (writeFulfilmentFields) {
      if (trackingNumber !== undefined) update.trackingNumber = trackingNumber;
      if (courierName !== undefined) update.courierName = courierName;
      if (notes !== undefined) update.notes = notes;
      if (shippingCostPatch !== undefined) {
        update.shippingCostActual = shippingCostPatch;
        update.shippingCostSource = 'manual';
      }
    }
    tx.update(ref, update);
  });

  /* Cancelled: take back points earned, hand back loyalty spent and
     release the coupon use — once (flags on the order). */
  if (status === 'cancelled' && currentOrder.status !== 'cancelled') {
    await reverseOrderRewards(db, ref).catch((e) => console.error('[Loyalty] reversal failed:', e.message));
  }
  /* Awarded only for a paid order, and only once (guarded by pointsAwarded) */
  if (status === 'delivered') {
    await awardLoyaltyPoints(ref, db).catch((e) => console.error('[Loyalty] award failed:', e.message));
  }

  /* Vendor earnings: credited on delivery (held for the return window),
     refreshed if the real shipping charge is corrected afterwards, and
     reversed if a delivered order is cancelled. Each call is idempotent. */
  let settlementError = null;
  let settlementNote = null;
  try {
    const deliveredNow = status ? status === 'delivered' : currentOrder.status === 'delivered';
    if (status === 'delivered' || (shippingCostPatch !== undefined && deliveredNow)) {
      const result = await postDeliverySettlement(db, id, { recalculate: shippingCostPatch !== undefined });
      if (result.skipped && !/No vendor items/.test(result.skipped)) settlementNote = result.skipped;
    }
    if (status === 'cancelled' && currentOrder.status === 'delivered') {
      await reverseOrderSettlements(db, id, { reason: 'cancelled after delivery' });
    }
  } catch (e) {
    settlementError = e.message;
    console.error('[settlement] order', id, 'failed:', e.message);
  }

  const after = docToObj(await ref.get());

  /* Tell the customer — email + WhatsApp — on a real status change. */
  if (status && status !== currentOrder.status) {
    await Promise.all([
      sendStatusUpdateEmail(after, status).catch((e) => console.error('[Email] Status update failed:', e.message)),
      sendStatusWhatsApp(after, status).catch((e) => console.error('[WhatsApp] Status update failed:', e.message)),
    ]);
  }
  return { before: currentOrder, after, settlementError, settlementNote };
}
