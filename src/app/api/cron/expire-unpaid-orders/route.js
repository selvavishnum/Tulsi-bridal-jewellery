import { NextResponse } from 'next/server';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { getDB } from '@/lib/firebase';
import { isAbandonedAttempt } from '@/lib/coupons';
import { applyOrderUpdate, OrderStateError } from '@/lib/orderStatus';

export const maxDuration = 60;

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // unpaid for a day → expired
const MAX_PER_RUN = 200;
const SCAN = 500; // pending online orders read per run
const PARALLEL = 5;
const BUDGET_MS = 45_000; // stop starting new ones well inside maxDuration

/* What Razorpay says about a Razorpay order: 'unpaid' (created, or only
   failed payment attempts — safe to expire), 'paid', 'attempted' (a payment
   is authorized / in progress, or the attempts can't be read) or 'unknown'
   (Razorpay unreachable). Only 'unpaid' may be cancelled. */
async function razorpayState(razorpay, razorpayOrderId) {
  let rzpOrder;
  try {
    rzpOrder = await razorpay.orders.fetch(String(razorpayOrderId));
  } catch (e) {
    console.error('[cron expire-unpaid] Razorpay order check failed:', razorpayOrderId, e?.error?.description || e?.message);
    return 'unknown';
  }
  if (rzpOrder?.status === 'paid') return 'paid';
  if (rzpOrder?.status === 'created') return 'unpaid';
  if (rzpOrder?.status !== 'attempted') return 'unknown';
  /* Attempted: expired only when every attempt failed (a declined UPI,
     then the shopper gave up). An authorized payment may still be
     captured — never cancel it. */
  try {
    const items = (await razorpay.orders.fetchPayments(String(razorpayOrderId)))?.items;
    return Array.isArray(items) && items.length > 0 && items.every((p) => p?.status === 'failed') ? 'unpaid' : 'attempted';
  } catch {
    return 'attempted';
  }
}

/* GET /api/cron/expire-unpaid-orders — daily clean-up (vercel.json cron).
   Cancels online orders that were never paid and are more than a day old,
   at most MAX_PER_RUN a run, through the normal cancel path
   (applyOrderUpdate → reverseOrderRewards), so the coupon use and the
   parked loyalty discount they hold go back to the customer. Quietly: no
   email or WhatsApp — the customer never placed these orders.

   Never one that may have been paid: when Razorpay is configured each is
   checked there first; one Razorpay reports paid or with a payment in
   progress (or can't be checked) is skipped and logged, and looked at
   again tomorrow. Vercel calls it with "Authorization: Bearer <CRON_SECRET>". */
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
  /* Equality filters only (no composite index). */
  const snap = await db.collection('orders')
    .where('status', '==', 'pending').where('payment.method', '==', 'razorpay')
    .limit(SCAN).get();
  const stale = snap.docs.filter((d) => {
    const o = d.data();
    const at = new Date(o.createdAt).getTime();
    return isAbandonedAttempt(o) && Number.isFinite(at) && at < cutoff;
  });
  const due = stale.slice(0, MAX_PER_RUN);

  const configured = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  const razorpay = configured ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }) : null;

  const expired = [];
  const skipped = [];
  const failed = [];
  async function expire(d) {
    const rzpId = d.data().payment?.razorpayOrderId;
    if (razorpay && rzpId) {
      const state = await razorpayState(razorpay, rzpId);
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
    skipped,
    failed,
    /* Left for the next run: over this run's bound or time budget. */
    remaining: stale.length - done,
  });
}
