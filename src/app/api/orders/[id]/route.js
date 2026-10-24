import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { toCustomerOrder } from '@/lib/settlement';
import { getAccess } from '@/lib/requireRole';
import { ROLES, CAN, FULFILLMENT_STATUSES, toFulfillmentOrder } from '@/lib/access';
import { ownsOrder } from '@/lib/orderOwnership';
import { applyOrderUpdate, OrderStateError } from '@/lib/orderStatus';
import { isAbandonedAttempt } from '@/lib/coupons';
import { autoDispatchOnPacked } from '@/lib/shipmentDispatch';
import { razorpayClient, settleIfPaid, PAYMENT_UNCHECKED_MESSAGE } from '@/lib/razorpayState';

/* Has Razorpay been paid for this order although we haven't heard yet (a
   UPI payment approved after the window was closed; the webhook follows)?
   Then it is confirmed right here, as verify and the webhook do (stock,
   points, the customer's "order confirmed"), and the caller answers 409.
   → 'settled' (paid and confirmed now), 'unsure' (Razorpay says paid but the
   payment can't be confirmed from here — the webhook will), or null: not
   paid as far as can be told — not configured, Razorpay unreachable, or the
   order was cancelled meanwhile (the money is being refunded) all count as
   no, and the cancel goes ahead (or finds it already cancelled). */
async function paidOnRazorpay(db, ref, order) {
  const razorpay = order.payment?.razorpayOrderId ? razorpayClient() : null;
  if (!razorpay) return null;
  const { state, paidAfterCancel } = await settleIfPaid(db, ref, order, razorpay, { tag: '[orders PUT]' });
  if (state === 'settled') return paidAfterCancel ? null : 'settled';
  return state === 'unsure' ? 'unsure' : null;
}

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
    const unpaidOnly = body.unpaidOnly === true;
    /* Staff confirm they refunded a prepaid order the courier returned. */
    if (body.refundDone === true) {
      if (!CAN.manageOrders.includes(access.tier)) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
      await db.collection('orders').doc(id).update({ refundDue: false, refundedAt: new Date().toISOString(), refundedBy: session.user.email || null, updatedAt: new Date().toISOString() });
      return NextResponse.json({ success: true, message: 'Marked refunded' });
    }
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

    /* Non-admin: can only cancel own pending/confirmed orders — including an
       online order whose payment was abandoned (checkout gives it up before
       placing the shopper's retry): cancelling runs reverseOrderRewards,
       which hands back its coupon use and the parked loyalty discount. */
    /* Checkout giving up its own unpaid online attempt (unpaidOnly) is
       bookkeeping, not news: the customer gets no "order cancelled" email
       or WhatsApp — they are about to place the order again. */
    let quiet = false;
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
      /* Never cancel an online order Razorpay has just been paid for. Checkout
         giving up an unpaid attempt says so (unpaidOnly): a payment
         confirmed since its page looked (the webhook) also stops it — the
         shopper would otherwise pay twice, online and again on delivery. */
      const paidOnline = order.payment?.method === 'razorpay' && order.payment?.status !== 'paid'
        ? await paidOnRazorpay(db, ref, order)
        : null;
      if ((unpaidOnly && order.payment?.status === 'paid') || paidOnline === 'settled') {
        return NextResponse.json({ success: false, code: 'ALREADY_PAID', message: 'Your payment for this order has just come through, so it has not been cancelled. Please check My Orders.' }, { status: 409 });
      }
      if (paidOnline === 'unsure') {
        return NextResponse.json({ success: false, code: 'EARLIER_PAYMENT_PENDING', orderId: id, message: PAYMENT_UNCHECKED_MESSAGE }, { status: 409 });
      }
      quiet = unpaidOnly && isAbandonedAttempt(order);
    }

    const { after: updatedOrder, settlementError, settlementNote } = await applyOrderUpdate(db, id,
      { status, trackingNumber, courierName, notes, shippingCostPatch },
      {
        notify: !quiet,
        /* Fulfilment fields are staff-only — a customer's cancel request
           used to be able to set its own tracking number, courier and notes. */
        writeFulfilmentFields: isAdmin,
        /* Re-checked inside the transaction on the fresh document: the checks
           above ran on a read another admin could have overtaken. */
        check(currentOrder) {
          if (!isAdmin && !['pending', 'confirmed'].includes(currentOrder.status)) {
            throw new OrderStateError(`Order cannot be cancelled — it is already ${currentOrder.status}`);
          }
          if (!isAdmin && unpaidOnly && currentOrder.payment?.status === 'paid') {
            throw new OrderStateError('This order has been paid, so it has not been cancelled.');
          }
          /* Fulfilment staff only touch orders inside the packing/shipping
             window — a pending COD order hasn't had its stock deducted. */
          if (isFulfilment && !['confirmed', 'processing', 'shipped'].includes(currentOrder.status)) {
            throw new OrderStateError(`This order is ${currentOrder.status} — fulfilment can only update confirmed, packed or shipped orders.`);
          }
          if (isFulfilment && status) {
            const from = currentOrder.status;
            const ok = (status === 'processing' && from === 'confirmed')
              || (status === 'shipped' && ['confirmed', 'processing'].includes(from));
            if (!ok) throw new OrderStateError(`Can't move an order from ${from} to ${status === 'processing' ? 'Packed' : status} — it must be confirmed first.`);
          }
        },
      });

    /* Packed → book the courier(s) right away, one parcel per warehouse. */
    const dispatch = isAdmin && status === 'processing' ? await autoDispatchOnPacked(db, id) : null;

    if (!isAdmin) return NextResponse.json({ success: true, data: toCustomerOrder(updatedOrder) });
    if (isFulfilment) return NextResponse.json({ success: true, data: toFulfillmentOrder(updatedOrder), ...(dispatch && { dispatch }) });
    return NextResponse.json({
      success: true,
      data: updatedOrder,
      ...(dispatch && { dispatch }),
      ...(settlementError && { settlementError }),
      ...(settlementNote && { settlementNote }),
    });
  } catch (error) {
    const statusCode = error instanceof OrderStateError ? 400 : 500;
    return NextResponse.json({ success: false, message: error.message }, { status: statusCode });
  }
}
