import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { lastNDateKeys } from '@/lib/siteVisits';

export async function GET() {
  try {
    const auth = await requireRole(CAN.viewReports);
    if (auth.error) return auth.error;

    const db = getDB();
    const dateKeys = lastNDateKeys(7);
    const todayKey = dateKeys[dateKeys.length - 1];

    const [daySnaps, allTimeSnap] = await Promise.all([
      Promise.all(dateKeys.map((k) => db.collection('siteVisits').doc(k).get())),
      db.collection('siteVisitsMeta').doc('allTime').get(),
    ]);

    const days = dateKeys.map((key, i) => {
      const d = daySnaps[i].data() || {};
      return { date: key, pageViews: d.pageViews || 0, uniqueVisitors: d.uniqueVisitors || 0 };
    });

    const today = days.find((d) => d.date === todayKey) || { pageViews: 0, uniqueVisitors: 0 };
    const week = days.reduce(
      (acc, d) => ({ pageViews: acc.pageViews + d.pageViews, uniqueVisitors: acc.uniqueVisitors + d.uniqueVisitors }),
      { pageViews: 0, uniqueVisitors: 0 }
    );
    const allTime = allTimeSnap.data() || {};

    return NextResponse.json({
      success: true,
      data: {
        today: { pageViews: today.pageViews, uniqueVisitors: today.uniqueVisitors },
        last7Days: { pageViews: week.pageViews, uniqueVisitors: week.uniqueVisitors },
        allTime: {
          pageViews: allTime.totalPageViews || 0,
          uniqueVisitors: allTime.totalUniqueVisitors || 0,
        },
        days,
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
