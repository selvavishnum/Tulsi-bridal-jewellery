import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDB } from '@/lib/firebase';
import { isAbandonedAttempt } from '@/lib/coupons';
import { applyOrderUpdate, OrderStateError } from '@/lib/orderStatus';
import { razorpayClient, razorpayState, paysInFull } from '@/lib/razorpayState';
import { settlePaidOrder } from '@/lib/settlePayment';

export const maxDuration = 60;

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // unpaid for a day → expired
const MAX_PER_RUN = 200;
const PAGE = 500; // pending online orders read per page
const SCAN_BUDGET_MS = 15_000; // stop reading pages after this
const PARALLEL = 5;
const BUDGET_MS = 45_000; // stop starting new ones well inside maxDuration

/* GET /api/cron/expire-unpaid-orders — daily clean-up (vercel.json cron,
   04:30 UTC = 10:00 IST: the customer may be messaged, so not at night).
   Cancels online orders that were never paid and are more than a day old,
   oldest first, at most MAX_PER_RUN a run, through the normal cancel path
   (applyOrderUpdate → reverseOrderRewards), so the coupon use and the
   parked loyalty discount they hold go back to the customer. Those cancels
   are quiet: no email or WhatsApp — the customer never placed these orders.

   Never one that may have been paid: when Razorpay is configured each is
   checked there first (razorpayState). One Razorpay reports paid is
   confirmed now through settlePaidOrder (a missed webhook) — which is the
   one thing here that is not quiet: it sends the customer their "order
   confirmed" (email + WhatsApp, once, after the response) like the webhook
   would have. If its payment can't be read, it is skipped and logged; one
   with a payment in progress (or that can't be checked) is skipped and
   logged, and looked at again tomorrow. Vercel calls it with
   "Authorization: Bearer <CRON_SECRET>". */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const got = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (!secret || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const db = getDB();
  const cutoff = started - MAX_AGE_MS;
  const ageOf = (d) => new Date(d.data().createdAt).getTime();

  /* Every pending online order, a page at a time in document-id order —
     equality filters and the id only (no composite index) — so newer ones
     can't hide older stale ones behind a fixed limit. */
  const stale = [];
  let after = null;
  let scanComplete = false;
  while (Date.now() - started < SCAN_BUDGET_MS) {
    let q = db.collection('orders')
      .where('status', '==', 'pending').where('payment.method', '==', 'razorpay')
      .orderBy('__name__');
    if (after) q = q.startAfter(after);
    const page = await q.limit(PAGE).get();
    for (const d of page.docs) {
      const at = ageOf(d);
      if (isAbandonedAttempt(d.data()) && Number.isFinite(at) && at < cutoff) stale.push(d);
    }
    if (page.docs.length < PAGE) {
      scanComplete = true;
      break;
    }
    after = page.docs[page.docs.length - 1].id;
  }
  stale.sort((a, b) => ageOf(a) - ageOf(b));
  const due = stale.slice(0, MAX_PER_RUN);

  const razorpay = razorpayClient();

  const expired = [];
  const settled = [];
  const skipped = [];
  const failed = [];
  async function expire(d) {
    const rzpId = d.data().payment?.razorpayOrderId;
    if (razorpay && rzpId) {
      const { state, payment } = await razorpayState(razorpay, rzpId, { tag: '[cron expire-unpaid]' });
      /* Paid and we never heard (the webhook was missed): confirm it now,
         as the webhook would have — never cancel it. */
      if (state === 'paid' && paysInFull(d.data(), payment)) {
        try {
          const { paidAfterCancel } = await settlePaidOrder(db, d.ref, { razorpayPaymentId: payment.id });
          console.warn(`[cron expire-unpaid] order ${d.id}: Razorpay ${rzpId} was paid — ${paidAfterCancel ? 'recorded for a refund' : 'confirmed'}`);
          if (paidAfterCancel) skipped.push({ id: d.id, reason: 'refund_due' });
          else settled.push(d.id);
        } catch (e) {
          console.error('[cron expire-unpaid] settling order', d.id, 'failed:', e?.message);
          failed.push({ id: d.id, reason: e?.message || 'failed' });
        }
        return;
      }
      if (state !== 'unpaid') {
        console.warn(`[cron expire-unpaid] skipped order ${d.id}: Razorpay ${rzpId} is ${state}`);
        skipped.push({ id: d.id, reason: `razorpay_${state}` });
        return;
      }
    }
    try {
      await applyOrderUpdate(db, d.id, { status: 'cancelled', extra: { cancelReason: 'expired' } }, {
        notify: false,
        /* Re-checked on the fresh document: paid or moved on since the read. */
        check(current) {
          if (!isAbandonedAttempt(current)) throw new OrderStateError('no longer an unpaid online order');
        },
      });
      expired.push(d.id);
    } catch (e) {
      if (e instanceof OrderStateError) skipped.push({ id: d.id, reason: 'changed' });
      else {
        console.error('[cron expire-unpaid] order', d.id, 'failed:', e?.message);
        failed.push({ id: d.id, reason: e?.message || 'failed' });
      }
    }
  }

  let done = 0;
  for (; done < due.length; done += PARALLEL) {
    if (Date.now() - started > BUDGET_MS) break;
    await Promise.all(due.slice(done, done + PARALLEL).map(expire));
  }
  done = Math.min(done, due.length);

  return NextResponse.json({
    success: true,
    checked: done,
    expired,
    settled,
    skipped,
    failed,
    /* Stale orders left for the next run: over this run's bound or time
       budget. If the scan itself ran out of time (scanComplete false),
       there may be more than this. */
    remaining: stale.length - done,
    scanComplete,
  });
}
