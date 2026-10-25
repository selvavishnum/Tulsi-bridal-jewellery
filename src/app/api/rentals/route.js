import { NextResponse } from 'next/server';
import { getAccess, ROLES } from '@/lib/requireRole';
import { getDB, snapshotToArr } from '@/lib/firebase';

/* Rentals are no longer offered: the store sells fashion jewellery only. Existing bookings are still
   listed here (admin → Rentals, and the customer's own) and managed through /api/rentals/[id]. */

export async function GET(request) {
  try {
    const access = await getAccess();
    const session = access.session;
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status');

    let snap;
    if (access.tier === ROLES.SUPER_ADMIN) {
      snap = await db.collection('rentals').orderBy('createdAt', 'desc').get();
    } else {
      snap = await db.collection('rentals').where('userId', '==', session.user.id).get();
    }
    let rentals = snapshotToArr(snap).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (status) rentals = rentals.filter((r) => r.status === status);

    return NextResponse.json({ success: true, data: { rentals: rentals.slice(0, limit), total: rentals.length } });
  } catch (error) {
    console.error('[rentals]', error.message);
    return NextResponse.json({ success: false, message: 'Could not complete the booking. Please try again.' }, { status: 500 });
  }
}

/* New bookings are closed. 410 (not 404): the endpoint existed, and an old tab or a cached page that still
   posts to it gets a clear answer instead of a booking nobody will fulfil. */
export async function POST() {
  return NextResponse.json({ success: false, message: 'Rentals are no longer available.' }, { status: 410 });
}
