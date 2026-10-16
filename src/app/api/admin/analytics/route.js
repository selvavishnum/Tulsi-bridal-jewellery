/* GET /api/admin/analytics?range=today|yesterday|7d|30d&part=all|live
   Visitor analytics for the admin dashboard — every visitor, guests and
   customers alike (see src/lib/analytics/report.js).
   part=live returns only the live block (polled every ~15s by the page). */
import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { liveReport, rangeReport, RANGES } from '@/lib/analytics/report';

export const dynamic = 'force-dynamic';

/* A dashboard left open refreshes often; one admin tab or five should cost
   the same Firestore reads. Per-instance, short-lived. */
const cache = new Map();
const TTL_MS = { live: 5_000, range: 30_000 };
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function GET(request) {
  const auth = await requireRole(CAN.viewReports);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const range = Object.hasOwn(RANGES, searchParams.get('range')) ? searchParams.get('range') : 'today';
    const part = searchParams.get('part') === 'live' ? 'live' : 'all';
    const db = getDB();

    const live = await cached('live', TTL_MS.live, () => liveReport(db));
    if (part === 'live') {
      return NextResponse.json({ success: true, data: { live } }, { headers: { 'cache-control': 'no-store' } });
    }
    const report = await cached(`range:${range}`, TTL_MS.range, () => rangeReport(db, { range }));
    return NextResponse.json({ success: true, data: { live, report } }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[admin/analytics] failed:', e);
    return NextResponse.json({ success: false, message: 'Could not load analytics. Please try again.' }, { status: 500 });
  }
}
