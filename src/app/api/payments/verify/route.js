import { NextResponse } from 'next/server';
import { getAccess, ROLES } from '@/lib/requireRole';
import { ownsOrder } from '@/lib/orderOwnership';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { getDB } from '@/lib/firebase';
import { settlePaidOrder } from '@/lib/settlePayment';

/* Timing-safe hex digest comparison */
function signatureMatches(expected, received) {
  if (typeof received !== 'string' || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
}

export async function POST(request) {
  try {
    const access = await getAccess();
    const session = access.session;
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

    /* Only the owner (or an admin) may settle this order.
       Guard against nullish values matching each other. */
    if (!ownsOrder(order, session.user) && access.tier !== ROLES.SUPER_ADMIN) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    /* Already settled — nothing to do, and never deduct stock twice */
    if (order.payment?.status === 'paid') {
      return NextResponse.json({ success: true, message: 'Payment already verified' });
    }

    /* The signature proves a payment happened, but not that it was for THIS order.
       Bind it to the Razorpay order id recorded at create-order time. The id must
       be present — its absence means create-order never ran for this order. */
    if (!order.payment?.razorpayOrderId || order.payment.razorpayOrderId !== razorpayOrderId) {
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
    /* "authorized" is a hold on the customer's card, not money received —
       it lapses if never captured. Capture it now; only a captured payment
       confirms the order (the payment.captured webhook is the backstop). */
    if (payment.status === 'authorized') {
      try {
        payment = await razorpay.payments.capture(razorpayPaymentId, Number(payment.amount), payment.currency || 'INR');
      } catch (e) {
        const again = await razorpay.payments.fetch(razorpayPaymentId).catch(() => null);
        if (again?.status !== 'captured') {
          console.error('[verify] capture failed:', e?.error?.description || e.message);
          return NextResponse.json({ success: false, message: 'Payment is still being confirmed by the bank. Your order will update automatically — please check My Orders in a few minutes.' }, { status: 202 });
        }
        payment = again;
      }
      if (payment.status !== 'captured') {
        return NextResponse.json({ success: false, message: 'Payment is still being confirmed. Please check My Orders shortly.' }, { status: 202 });
      }
    }

    /* Mark paid and deduct stock — shared with the Razorpay webhook receiver
       (src/app/api/payments/webhook/route.js) so there is exactly one code
       path that ever applies these side effects, no matter which of the two
       entry points gets there first; its own transaction handles the race
       between them. */
    await settlePaidOrder(db, orderRef, { razorpayPaymentId, razorpaySignature });

    return NextResponse.json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    const message = error?.error?.description || error?.message || 'Payment verification failed. Please try again.';
    console.error('[verify] failed:', error?.error || error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
