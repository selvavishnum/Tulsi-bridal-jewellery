/* GET /api/admin/analytics?range=today|yesterday|7d|30d&part=all|live
   Visitor analytics for the admin dashboard — every visitor, guests and
   customers alike (see src/lib/analytics/report.js).
   part=live returns only the live block (polled every ~15s by the page). */
import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { liveReport, cartsReport, rangeReport, RANGES } from '@/lib/analytics/report';
import { istDateKey } from '@/lib/siteVisits';

export const dynamic = 'force-dynamic';

/* A dashboard left open refreshes often; one admin tab or five should cost
   the same Firestore reads. Per-instance. Concurrent callers share one
   computation (the 15 s live poll and the full refresh often coincide). */
const cache = new Map();
const TTL_MS = {
  live: 5_000,
  /* Abandonment works on a 30-minute scale. */
  carts: 2 * 60_000,
  /* Today moves; finished days don't. */
  today: 30_000,
  yesterday: 15 * 60_000,
  '7d': 5 * 60_000,
  '30d': 5 * 60_000,
};
function cached(key, ttl, fn, { fresh = false } = {}) {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.promise;
  if (cache.size > 50) cache.clear();
  const promise = fn();
  cache.set(key, { at: Date.now(), promise });
  /* A failure is not cached. */
  promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); });
  return promise;
}

async function livePart(db) {
  const [live, carts] = await Promise.all([
    cached('live', TTL_MS.live, () => liveReport(db, new Date(), { carts: false })),
    cached('carts', TTL_MS.carts, () => cartsReport(db)),
  ]);
  return { ...live, carts };
}

export async function GET(request) {
  const auth = await requireRole(CAN.viewReports);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const range = Object.hasOwn(RANGES, searchParams.get('range')) ? searchParams.get('range') : 'today';
    const part = searchParams.get('part') === 'live' ? 'live' : 'all';
    /* The Refresh button: recompute the range now. */
    const fresh = searchParams.get('fresh') === '1';
    const db = getDB();

    if (part === 'live') {
      return NextResponse.json({ success: true, data: { live: await livePart(db) } }, { headers: { 'cache-control': 'no-store' } });
    }
    const [live, report] = await Promise.all([
      livePart(db),
      /* Keyed by the IST date: "Yesterday" and the 7 / 30 day windows move at midnight. */
      cached(`range:${range}:${istDateKey(new Date())}`, TTL_MS[range], () => rangeReport(db, { range }), { fresh }),
    ]);
    return NextResponse.json({ success: true, data: { live, report } }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[admin/analytics] failed:', e);
    return NextResponse.json({ success: false, message: 'Could not load analytics. Please try again.' }, { status: 500 });
  }
}
