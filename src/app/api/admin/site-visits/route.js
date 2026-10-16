/* GET /api/admin/site-visits — the visitor cards on /admin/customers.
   Reads the visitor-analytics rollups (src/lib/analytics); days from
   before the switch fall back to the legacy siteVisits counters, and the
   all-time numbers add both together. */
import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { lastNDateKeys, istStartOfDay } from '@/lib/siteVisits';
import { readDaily, countOf, mergeRollups } from '@/lib/analytics/report';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const auth = await requireRole(CAN.viewReports);
    if (auth.error) return auth.error;

    const db = getDB();
    const dateKeys = lastNDateKeys(7);
    const weekStart = istStartOfDay(new Date(Date.now() - 6 * 86_400_000)).toISOString();

    const [rollups, legacySnaps, legacyAllSnap, totalsSnap, week] = await Promise.all([
      readDaily(db, dateKeys),
      Promise.all(dateKeys.map((k) => db.collection('siteVisits').doc(k).get())),
      db.collection('siteVisitsMeta').doc('allTime').get(),
      db.collection('analytics_totals').get(),
      countOf(db.collection('analytics_visitors').where('lastSeenAt', '>=', weekStart)),
    ]);

    let legacyOnlyVisitors = 0;
    const days = dateKeys.map((date, i) => {
      const fresh = rollups.days[i] || {};
      const legacy = legacySnaps[i].data() || {};
      const tracked = Number(fresh.sessions) > 0 || Number(fresh.pageviews) > 0;
      if (!tracked) legacyOnlyVisitors += Number(legacy.uniqueVisitors) || 0;
      return {
        date,
        pageViews: tracked ? Number(fresh.pageviews) || 0 : Number(legacy.pageViews) || 0,
        uniqueVisitors: tracked ? Number(fresh.visitors) || 0 : Number(legacy.uniqueVisitors) || 0,
      };
    });

    const today = days[days.length - 1];
    const totals = mergeRollups(totalsSnap.docs.map((d) => d.data()));
    const legacyAll = legacyAllSnap.data() || {};

    return NextResponse.json({
      success: true,
      data: {
        today: { pageViews: today.pageViews, uniqueVisitors: today.uniqueVisitors },
        last7Days: {
          pageViews: days.reduce((a, d) => a + d.pageViews, 0),
          /* Distinct browsers over the week (not a sum of daily uniques). */
          uniqueVisitors: week.n + legacyOnlyVisitors,
        },
        allTime: {
          pageViews: (Number(legacyAll.totalPageViews) || 0) + (Number(totals.pageviews) || 0),
          uniqueVisitors: (Number(legacyAll.totalUniqueVisitors) || 0) + (Number(totals.newVisitors) || 0),
        },
        days,
      },
    });
  } catch (e) {
    console.error('[admin/site-visits] failed:', e);
    return NextResponse.json({ success: false, message: 'Could not load visitor numbers.' }, { status: 500 });
  }
}
