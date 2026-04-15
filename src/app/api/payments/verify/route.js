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
    await db.collection('orders').doc(orderId).update({
      'payment.status': 'paid',
      'payment.razorpayOrderId': razorpayOrderId,
      'payment.razorpayPaymentId': razorpayPaymentId,
      'payment.razorpaySignature': razorpaySignature,
      'payment.paidAt': new Date().toISOString(),
      status: 'confirmed',
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
