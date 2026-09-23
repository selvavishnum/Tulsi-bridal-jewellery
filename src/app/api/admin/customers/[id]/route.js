import { NextResponse } from 'next/server';
import { getDB, docToObj, snapshotToArr } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { ROLES, toFulfillmentOrder } from '@/lib/access';

export async function GET(request, { params }) {
  try {
    const auth = await requireRole(CAN.viewCustomers);
    if (auth.error) return auth.error;

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
    const orders = snapshotToArr(ordersSnap)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map((o) => (auth.tier === ROLES.SUPER_ADMIN ? o : toFulfillmentOrder(o))); // no cost/margin fields below Super Admin

    return NextResponse.json({ success: true, user, orders });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
