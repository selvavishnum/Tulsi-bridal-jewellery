import { NextResponse } from 'next/server';
import { getDB, docToObj, FieldValue } from '@/lib/firebase';
import { sendStatusUpdateEmail } from '@/lib/email';
import { sendStatusWhatsApp } from '@/lib/whatsapp';
import { awardLoyaltyPoints, reverseOrderRewards } from '@/lib/loyalty';
import { toCustomerOrder } from '@/lib/settlement';
import { getAccess } from '@/lib/requireRole';
import { ROLES, CAN, FULFILLMENT_STATUSES, toFulfillmentOrder } from '@/lib/access';
import { ownsOrder } from '@/lib/orderOwnership';
import { postDeliverySettlement, reverseOrderSettlements } from '@/lib/vendorLedger';

class OrderStateError extends Error {}

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const access = await getAccess();
    const session = access.session;
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const doc = await db.collection('orders').doc(id).get();
    if (!doc.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    const order = docToObj(doc);
    if (CAN.manageOrders.includes(access.tier)) return NextResponse.json({ success: true, data: order });
    if (CAN.viewOrders.includes(access.tier)) return NextResponse.json({ success: true, data: toFulfillmentOrder(order) });
    /* Same ownership rule as the order list and cancel (orderOwnership.js). */
    if (!ownsOrder(order, session.user)) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ success: true, data: toCustomerOrder(order) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function PUT(request, context) {
  try {
    const { id } = await context.params;
    const access = await getAccess();
    const session = access.session;
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const body = await request.json();
    const { status, trackingNumber, courierName, notes, shippingCostActual } = body;
    const ref = db.collection('orders').doc(id);
    const isSuper = CAN.manageOrders.includes(access.tier); // full order control
    /* Sales and business staff can read orders but not change them: for a
       write they are ordinary customers (cancel their own order only). */
    const isFulfilment = access.tier === ROLES.ORDER_MANAGER;
    /* "Staff" here = may act on any order. Fulfilment staff only move orders
       through packing and shipping; confirming (stock), delivering (money)
       and cancelling stay with SUPER_ADMIN, as does the courier charge
       (it feeds vendor payouts). */
    const isAdmin = isSuper || isFulfilment;
    if (isFulfilment && ((status && !FULFILLMENT_STATUSES.includes(status)) || shippingCostActual !== undefined)) {
      return NextResponse.json({ success: false, message: 'Forbidden: fulfilment staff can only mark orders Packed or Shipped' }, { status: 403 });
    }

    let shippingCostPatch;
    if (isSuper && shippingCostActual !== undefined && shippingCostActual !== '') {
      const n = Number(shippingCostActual);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ success: false, message: 'Shipping cost must be a number ≥ 0' }, { status: 400 });
      }
      shippingCostPatch = n;
    }

    /* Non-admin: can only cancel own pending/confirmed orders */
    if (!isAdmin) {
      if (status !== 'cancelled') {
        return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
      }
      const orderDoc = await ref.get();
      if (!orderDoc.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
      const order = orderDoc.data();
      if (!ownsOrder(order, session.user)) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
      if (!['pending', 'confirmed'].includes(order.status)) {
        return NextResponse.json({ success: false, message: `Order cannot be cancelled — it is already ${order.status}` }, { status: 400 });
      }
    }

    /* The whole read-decide-write cycle runs inside one transaction so a
       second PUT racing in at the same moment (another admin tab, a
       double-click, a retried request) can't read the same pre-decrement
       stock number this one just read — Firestore serializes/retries
       transactions that touch the same documents instead of letting both
       compute from stale data. */
    let currentOrder = {};
    await db.runTransaction(async (tx) => {
      const currentDoc = await tx.get(ref);
      if (!currentDoc.exists) throw new Error('Order not found');
      currentOrder = currentDoc.data();
      /* Re-checked inside the transaction: the check above ran on a read
         that an admin could have overtaken (e.g. marked it shipped) before
         this write lands. */
      if (!isAdmin && !['pending', 'confirmed'].includes(currentOrder.status)) {
        throw new OrderStateError(`Order cannot be cancelled — it is already ${currentOrder.status}`);
      }
      /* Fulfilment works on confirmed orders only: packing a still-pending
         COD order would skip the confirmation step that deducts stock. */
      /* Fulfilment staff only touch orders inside the packing/shipping window
         — not pending (unconfirmed), delivered or cancelled ones, for any
         field including tracking and notes. */
      if (isFulfilment && !['confirmed', 'processing', 'shipped'].includes(currentOrder.status)) {
        throw new OrderStateError(`This order is ${currentOrder.status} — fulfilment can only update confirmed, packed or shipped orders.`);
      }
      if (isFulfilment && status) {
        const from = currentOrder.status;
        const ok = (status === 'processing' && from === 'confirmed')
          || (status === 'shipped' && ['confirmed', 'processing'].includes(from));
        if (!ok) throw new OrderStateError(`Can't move an order from ${from} to ${status === 'processing' ? 'Packed' : status} — it must be confirmed first.`);
      }

      const update = { updatedAt: new Date().toISOString() };

      if (status) {
        update.status = status;
        if (status === 'delivered') {
          update.deliveredAt = new Date().toISOString();
          /* COD is collected on delivery — mark it paid so points can be awarded */
          if (currentOrder.payment?.method === 'cod' && currentOrder.payment?.status !== 'paid') {
            update['payment.status'] = 'paid';
            update['payment.paidAt'] = new Date().toISOString();
          }
        }
        if (status === 'cancelled') update.cancelledAt = new Date().toISOString();

        /* Deduct stock on confirmation — skip if already deducted (e.g. by payment verification) */
        if (status === 'confirmed' && !currentOrder.stockDeducted) {
          const items = (currentOrder.items || []).filter((i) => i.product);
          const prodRefs = items.map((i) => db.collection('products').doc(i.product));
          const prodDocs = prodRefs.length ? await Promise.all(prodRefs.map((r) => tx.get(r))) : [];

          /* Stock can't go negative (floored at 0 below), but if concurrent
             orders already emptied it out from under this one, that's a
             real oversell — record it instead of silently pretending the
             order shipped from stock that wasn't there, so an admin can
             follow up (refund/backorder) rather than the gap going unnoticed. */
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
          update.stockRestoredAt = new Date().toISOString();
        }
      }
      /* Fulfilment fields are admin-only — a customer's cancel request used
         to be able to set its own tracking number, courier and notes. */
      if (isAdmin) {
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
      await awardLoyaltyPoints(ref).catch((e) => console.error('[Loyalty] award failed:', e.message));
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
        // e.g. delivered before an online payment was confirmed — say so rather than skip silently
        if (result.skipped && !/No vendor items/.test(result.skipped)) settlementNote = result.skipped;
      }
      if (status === 'cancelled' && currentOrder.status === 'delivered') {
        await reverseOrderSettlements(db, id, { reason: 'cancelled after delivery' });
      }
    } catch (e) {
      settlementError = e.message;
      console.error('[settlement] order', id, 'failed:', e.message);
    }

    const updated = await ref.get();
    const updatedOrder = docToObj(updated);

    /* Send status update — email + WhatsApp */
    if (status && status !== currentOrder.status) {
      await Promise.all([
        sendStatusUpdateEmail(updatedOrder, status).catch((e) => console.error('[Email] Status update failed:', e.message)),
        sendStatusWhatsApp(updatedOrder, status).catch((e) => console.error('[WhatsApp] Status update failed:', e.message)),
      ]);
    }

    if (!isAdmin) return NextResponse.json({ success: true, data: toCustomerOrder(updatedOrder) });
    if (isFulfilment) return NextResponse.json({ success: true, data: toFulfillmentOrder(updatedOrder) });
    return NextResponse.json({
      success: true,
      data: updatedOrder,
      ...(settlementError && { settlementError }),
      ...(settlementNote && { settlementNote }),
    });
  } catch (error) {
    const statusCode = error instanceof OrderStateError ? 400 : 500;
    return NextResponse.json({ success: false, message: error.message }, { status: statusCode });
  }
}
