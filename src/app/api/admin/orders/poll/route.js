import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

/* Lightweight endpoint for the admin sidebar to poll every few seconds.
   Uses a Firestore count() aggregate instead of fetching full order docs,
   so frequent polling stays cheap. */
export async function GET(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const since = new URL(request.url).searchParams.get('since');
    if (!since) return NextResponse.json({ success: false, message: 'since is required' }, { status: 400 });

    const db = getDB();
    const newSnap = await db.collection('orders').where('createdAt', '>', since).get();
    const count = newSnap.size;

    let latest = null;
    if (count > 0) {
      const docs = newSnap.docs.sort((a, b) => (b.data().createdAt || '').localeCompare(a.data().createdAt || ''));
      const d = docs[0].data();
      latest = {
        orderNumber: d.orderNumber,
        total: d.total,
        name: d.shippingAddress?.name || d.shippingAddress?.fullName || d.guestEmail || 'Customer',
      };
    }

    return NextResponse.json({ success: true, data: { count, latest } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
