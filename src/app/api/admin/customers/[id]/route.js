import { NextResponse } from 'next/server';
import { getDB, docToObj, snapshotToArr } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET(request, { params }) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { id } = await params;
    const db = getDB();

    const [userDoc, ordersSnap] = await Promise.all([
      db.collection('users').doc(id).get(),
      db.collection('orders').where('userId', '==', id).get(),
    ]);

    if (!userDoc.exists) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    const rawUser = docToObj(userDoc);
    const { password, ...user } = rawUser;
    const orders = snapshotToArr(ordersSnap).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );

    return NextResponse.json({ success: true, user, orders });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
