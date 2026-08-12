import { NextResponse } from 'next/server';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { getDB } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

/* Timing-safe hex digest comparison */
function signatureMatches(expected, received) {
  if (typeof received !== 'string' || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
}

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = await request.json();

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !orderId) {
      return NextResponse.json({ success: false, message: 'Missing payment fields' }, { status: 400 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (!signatureMatches(expectedSignature, razorpaySignature)) {
      return NextResponse.json({ success: false, message: 'Payment verification failed' }, { status: 400 });
    }

    const db = getDB();
    const orderRef = db.collection('orders').doc(String(orderId));
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }

    const order = orderDoc.data();

    /* Only the owner (or an admin) may settle this order */
    const isOwner = order.userId === session.user.id || order.guestEmail === session.user.email;
    if (!isOwner && session.user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    /* Already settled — nothing to do, and never deduct stock twice */
    if (order.payment?.status === 'paid') {
      return NextResponse.json({ success: true, message: 'Payment already verified' });
    }

    /* The signature proves a payment happened, but not that it was for THIS order.
       Bind it to the Razorpay order id recorded at create-order time. */
    if (order.payment?.razorpayOrderId !== razorpayOrderId) {
      return NextResponse.json(
        { success: false, message: 'Payment does not belong to this order' },
        { status: 400 }
      );
    }

    /* Confirm with Razorpay directly that this payment is real, settled against
       the expected order, and for the full amount due. */
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    let payment;
    try {
      payment = await razorpay.payments.fetch(razorpayPaymentId);
    } catch {
      return NextResponse.json({ success: false, message: 'Could not confirm payment with Razorpay' }, { status: 502 });
    }

    const amountDue = Number(order.payment?.amountDue ?? Math.round(Number(order.total) * 100));

    if (
      payment.order_id !== razorpayOrderId ||
      !['captured', 'authorized'].includes(payment.status) ||
      Number(payment.amount) < amountDue
    ) {
      return NextResponse.json({ success: false, message: 'Payment verification failed' }, { status: 400 });
    }

    /* Mark paid and deduct stock atomically, so a partial failure can never
       leave the order flagged as deducted without the stock actually moving. */
    const items = (order.items || []).filter((i) => i.product);
    const paidAt = new Date().toISOString();

    await db.runTransaction(async (tx) => {
      const freshOrder = await tx.get(orderRef);
      if (freshOrder.data()?.payment?.status === 'paid') return; // settled by a concurrent request

      const prodRefs = items.map((i) => db.collection('products').doc(i.product));
      const prodDocs = prodRefs.length ? await Promise.all(prodRefs.map((r) => tx.get(r))) : [];

      tx.update(orderRef, {
        'payment.status': 'paid',
        'payment.razorpayPaymentId': razorpayPaymentId,
        'payment.razorpaySignature': razorpaySignature,
        'payment.paidAt': paidAt,
        status: 'confirmed',
        stockDeducted: true,
        updatedAt: paidAt,
      });

      if (!freshOrder.data()?.stockDeducted) {
        prodDocs.forEach((prodDoc, idx) => {
          if (!prodDoc.exists) return;
          const qty = Math.max(0, Math.floor(Number(items[idx].quantity) || 0));
          tx.update(prodRefs[idx], { stock: Math.max(0, (Number(prodDoc.data().stock) || 0) - qty) });
        });
      }
    });

    return NextResponse.json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
