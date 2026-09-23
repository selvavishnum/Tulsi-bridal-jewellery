import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';

export async function GET() {
  try {
    const auth = await requireRole(CAN.viewCustomers);
    if (auth.error) return auth.error;

    const db = getDB();
    const [usersSnap, ordersSnap] = await Promise.all([
      db.collection('users').orderBy('createdAt', 'desc').get(),
      db.collection('orders').get(),
    ]);

    const users = snapshotToArr(usersSnap).map(({ password, ...u }) => u);
    const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Group orders by userId
    const ordersByUser = {};
    for (const o of orders) {
      const uid = o.userId;
      if (!uid) continue;
      if (!ordersByUser[uid]) ordersByUser[uid] = [];
      ordersByUser[uid].push(o);
    }

    const enriched = users.map((u) => {
      const uid = u.id || u._id;
      const userOrders = ordersByUser[uid] || [];
      const totalOrders = userOrders.length;
      const totalSpent = userOrders.reduce((s, o) => s + (o.total || 0), 0);
      const lastOrderAt = userOrders.length
        ? userOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].createdAt
        : null;
      return { ...u, totalOrders, totalSpent, lastOrderAt };
    });

    return NextResponse.json({ success: true, data: enriched });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
