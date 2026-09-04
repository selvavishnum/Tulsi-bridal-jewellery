import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { getDB } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
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
    const isOwner =
      (!!order.userId && order.userId === session.user.id) ||
      (!!order.guestEmail && order.guestEmail === session.user.email);
    if (!isOwner && session.user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    if (order.payment?.status === 'paid') {
      return NextResponse.json({ success: false, message: 'Order is already paid' }, { status: 400 });
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
