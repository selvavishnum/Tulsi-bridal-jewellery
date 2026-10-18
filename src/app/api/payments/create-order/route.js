import { NextResponse } from 'next/server';
import { getAccess, ROLES } from '@/lib/requireRole';
import { ownsOrder } from '@/lib/orderOwnership';
import Razorpay from 'razorpay';
import { getDB } from '@/lib/firebase';

/* POST /api/payments/create-order { orderId } — the Razorpay order to pay
   this order with (the same one again for a retry at the same amount).

   Answers:
     200 { success: true, data: <Razorpay order> }
     409 { code: 'ORDER_CANCELLED', replaced } this order can't be paid any
         more: it was cancelled, or replaced by a newer order of the
         customer's (replaced: true — the newer one holds its coupon use /
         points discount). Place a new order; never pay this one.
     409 { code: 'ALREADY_PAID' }  paid already — here, or on Razorpay and
         we haven't heard yet (late UPI approval). Never pay it again; open
         the order.
     400 / 401 / 403 / 404 / 500 { message } (no code) — anything else, e.g.
         online payment paused by the store, or Razorpay unreachable. Show
         the message; the order itself is unchanged and stays payable.
   Only the two codes mean "this order is finished": checkout gives up its
   unpaid attempt on those, never on a plain error. */
export async function POST(request) {
  try {
    const access = await getAccess();
    const session = access.session;
    if (!session) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const orderId = body.orderId || body.receipt;
    if (!orderId) {
      return NextResponse.json({ success: false, message: 'orderId is required' }, { status: 400 });
    }

    const db = getDB();
    const orderRef = db.collection('orders').doc(String(orderId));
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    const order = orderDoc.data();

    /* Only the owner (or an admin) may start a payment for this order.
       Guard against nullish values matching each other. */
    if (!ownsOrder(order, session.user) && access.tier !== ROLES.SUPER_ADMIN) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    /* Cancelled first: money that arrived after a cancel is being refunded
       (paidAfterCancel) — the shopper must not be sent to it as if placed.
       A pending attempt whose coupon use / points a newer order took over
       (saved before replaced attempts were cancelled) is finished too. */
    const replaced = order.cancelReason === 'replaced'
      || (order.status === 'pending' && !!(order.couponMovedTo || order.loyaltyMovedTo));
    if (order.status === 'cancelled' || replaced) {
      return NextResponse.json({
        success: false,
        code: 'ORDER_CANCELLED',
        replaced,
        message: replaced
          ? 'This payment attempt was replaced by your newer order, so it can’t be paid. Please check My Orders.'
          : 'This order was cancelled.',
      }, { status: 409 });
    }
    if (order.payment?.status === 'paid') {
      return NextResponse.json({ success: false, code: 'ALREADY_PAID', message: 'This order is already paid. Please check My Orders.' }, { status: 409 });
    }

    /* Admin can pause online payment site-wide (e.g. while Razorpay KYC is
       pending). Re-checked here so a stale/cached checkout page can't bypass
       the toggle by calling this route directly. */
    const settingsDoc = await db.collection('settings').doc('site').get();
    if (settingsDoc.data()?.onlinePaymentEnabled === false) {
      return NextResponse.json(
        { success: false, message: 'Online payment is temporarily unavailable. Please choose Cash on Delivery.' },
        { status: 400 }
      );
    }

    /* Amount comes from the stored order, never from the client */
    const amountPaise = Math.round(Number(order.total) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise < 100) {
      return NextResponse.json({ success: false, message: 'Order total is invalid' }, { status: 400 });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    /* Called again for the same unpaid order (the shopper closed the
       payment window and taps Pay again): re-use its Razorpay order rather
       than replace it. A UPI payment approved late on the first window then
       still matches this order (verify and the webhook look the order up by
       payment.razorpayOrderId), and Razorpay itself refuses a second payment
       for an order already paid. */
    const existingId = order.payment?.razorpayOrderId;
    if (existingId && Number(order.payment?.amountDue) === amountPaise) {
      let existing = null;
      try {
        existing = await razorpay.orders.fetch(existingId);
      } catch (e) {
        console.error('[create-order] could not re-read Razorpay order', existingId, e?.error?.description || e?.message);
      }
      if (existing?.status === 'paid') {
        return NextResponse.json({ success: false, code: 'ALREADY_PAID', message: 'We have received the payment for this order. Please check My Orders.' }, { status: 409 });
      }
      if (!existing || Number(existing.amount) === amountPaise) {
        return NextResponse.json({ success: true, data: existing || { id: existingId, entity: 'order', amount: amountPaise, currency: 'INR', receipt: String(orderId) } });
      }
    }

    const rzpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: String(orderId),
    });

    /* Bind the Razorpay order to this order so verification can check it later */
    await orderRef.update({
      'payment.razorpayOrderId': rzpOrder.id,
      'payment.amountDue': amountPaise,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, data: rzpOrder });
  } catch (error) {
    /* The razorpay SDK throws { statusCode, error: { description } } on API
       errors — that shape has no .message, so the real reason was being lost
       and the client only ever saw a blank/generic failure. */
    const message = error?.error?.description || error?.message || 'Payment setup failed. Please try again.';
    console.error('[create-order] failed:', error?.error || error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
