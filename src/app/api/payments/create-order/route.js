import { NextResponse } from 'next/server';
import { getAccess, ROLES } from '@/lib/requireRole';
import { ownsOrder } from '@/lib/orderOwnership';
import Razorpay from 'razorpay';
import { getDB } from '@/lib/firebase';

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

    if (order.payment?.status === 'paid') {
      return NextResponse.json({ success: false, message: 'Order is already paid' }, { status: 400 });
    }
    if (order.status === 'cancelled') {
      return NextResponse.json({ success: false, message: 'This order was cancelled.' }, { status: 400 });
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
