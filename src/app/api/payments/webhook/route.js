import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDB } from '@/lib/firebase';
import { settlePaidOrder } from '@/lib/settlePayment';

/* Server-to-server reconciliation for Razorpay. The client-triggered
   /api/payments/verify call is the primary path (it runs right after
   checkout succeeds in the browser and gives the customer an instant
   result), but if the browser tab closes or the network drops before that
   fetch completes, Razorpay has still captured the money and the order
   would otherwise stay 'pending' forever with no record of the payment.
   This listener is Razorpay's own server calling back to catch exactly
   that case — configure it in the Razorpay dashboard as
   https://<domain>/api/payments/webhook with the 'payment.captured' event,
   and set RAZORPAY_WEBHOOK_SECRET to the secret shown there (this is a
   separate secret from RAZORPAY_KEY_SECRET). */

/* Timing-safe hex digest comparison — mirrors the one in
   src/app/api/payments/verify/route.js. */
function signatureMatches(expected, received) {
  if (typeof received !== 'string' || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
}

export async function POST(request) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      // Not configured — nothing to verify against, so nothing to trust. Ack
      // with 200 so Razorpay doesn't retry forever, but do no processing.
      console.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not set — ignoring webhook delivery');
      return NextResponse.json({ success: false, message: 'Webhook not configured' }, { status: 200 });
    }

    /* Must verify against the exact raw bytes Razorpay signed — request.json()
       would re-serialize and silently break every signature. */
    const rawBody = await request.text();
    const receivedSignature = request.headers.get('x-razorpay-signature');

    const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!signatureMatches(expectedSignature, receivedSignature)) {
      return NextResponse.json({ success: false, message: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(rawBody);

    if (event.event !== 'payment.captured' && event.event !== 'order.paid') {
      // Ack and ignore — we only act on a confirmed capture.
      return NextResponse.json({ success: true, ignored: event.event });
    }

    const paymentEntity = event.payload?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id;
    const razorpayPaymentId = paymentEntity?.id;
    if (!razorpayOrderId || paymentEntity?.status !== 'captured') {
      return NextResponse.json({ success: true, ignored: 'no captured payment in payload' });
    }

    const db = getDB();
    const matches = await db.collection('orders').where('payment.razorpayOrderId', '==', razorpayOrderId).limit(1).get();
    if (matches.empty) {
      // Nothing to reconcile against (yet, or ever, if this was a stray
      // event) — ack so Razorpay stops retrying rather than erroring.
      console.error('[webhook] no order found for razorpayOrderId', razorpayOrderId);
      return NextResponse.json({ success: true, ignored: 'no matching order' });
    }

    const orderRef = matches.docs[0].ref;
    const order = matches.docs[0].data();

    /* Amount is re-checked against what create-order recorded, same as the
       client-verify path — never trust the webhook payload's amount alone. */
    const amountDue = Number(order.payment?.amountDue ?? Math.round(Number(order.total) * 100));
    if (Number(paymentEntity.amount) < amountDue) {
      console.error('[webhook] amount mismatch for order', orderRef.id, paymentEntity.amount, 'vs', amountDue);
      return NextResponse.json({ success: false, message: 'Amount mismatch' }, { status: 400 });
    }

    await settlePaidOrder(db, orderRef, { razorpayPaymentId });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[webhook] failed:', error?.message || error);
    // 500 so Razorpay retries — this branch means we couldn't process it,
    // not that the event was invalid.
    return NextResponse.json({ success: false, message: 'Webhook processing failed' }, { status: 500 });
  }
}
