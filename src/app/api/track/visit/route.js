import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import { istDateKey } from '@/lib/siteVisits';
import { isBotRequest } from '@/lib/isBotRequest';

/* Unauthenticated by design — this counts every visitor to the public site,
   not just logged-in customers (that's the gap TrackingProvider left: it
   skips everything when there's no session). Being unauthenticated and
   the single "how many people visit the site" number is exactly why the
   bot filter matters most here — this is the route a crawler that ignores
   robots.txt, or any scripted client, would otherwise inflate. */
export async function POST(request) {
  try {
    if (isBotRequest(request)) return NextResponse.json({ success: false });

    const { visitorId } = await request.json();
    if (!visitorId || typeof visitorId !== 'string' || visitorId.length > 100) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const db = getDB();
    const today = istDateKey();
    const dayRef = db.collection('siteVisits').doc(today);
    const todayMarkerRef = dayRef.collection('seen').doc(visitorId);
    const allTimeRef = db.collection('siteVisitsMeta').doc('allTime');
    const everMarkerRef = allTimeRef.collection('seen').doc(visitorId);

    await db.runTransaction(async (tx) => {
      const [todayMarker, everMarker] = await Promise.all([tx.get(todayMarkerRef), tx.get(everMarkerRef)]);
      const isNewToday = !todayMarker.exists;
      const isNewEver = !everMarker.exists;
      const now = new Date().toISOString();

      tx.set(dayRef, {
        pageViews: FieldValue.increment(1),
        uniqueVisitors: FieldValue.increment(isNewToday ? 1 : 0),
      }, { merge: true });

      tx.set(allTimeRef, {
        totalPageViews: FieldValue.increment(1),
        totalUniqueVisitors: FieldValue.increment(isNewEver ? 1 : 0),
      }, { merge: true });

      if (isNewToday) tx.set(todayMarkerRef, { at: now });
      if (isNewEver) tx.set(everMarkerRef, { firstSeen: now });
    });

    return NextResponse.json({ success: true });
  } catch {
    /* Fire-and-forget from the client — never let a tracking failure matter */
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
