import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDB } from '@/lib/firebase';

export async function POST(request) {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = await request.json();

    const body = razorpayOrderId + '|' + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      return NextResponse.json({ success: false, message: 'Payment verification failed' }, { status: 400 });
    }

    const db = getDB();
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    await orderRef.update({
      'payment.status': 'paid',
      'payment.razorpayOrderId': razorpayOrderId,
      'payment.razorpayPaymentId': razorpayPaymentId,
      'payment.razorpaySignature': razorpaySignature,
      'payment.paidAt': new Date().toISOString(),
      status: 'confirmed',
      stockDeducted: true,
      updatedAt: new Date().toISOString(),
    });

    /* Deduct stock — skip if already done (idempotent on retried verifications) */
    if (orderDoc.exists && !orderDoc.data().stockDeducted) {
      const batch = db.batch();
      for (const item of (orderDoc.data().items || [])) {
        if (!item.product) continue;
        const prodRef = db.collection('products').doc(item.product);
        const prodDoc = await prodRef.get();
        if (prodDoc.exists) {
          batch.update(prodRef, { stock: Math.max(0, (prodDoc.data().stock || 0) - item.quantity) });
        }
      }
      await batch.commit();
    }

    return NextResponse.json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
