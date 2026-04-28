import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import { startOfMonth, endOfMonth } from 'date-fns';

export async function GET(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();

    const now = new Date();
    const monthStart = startOfMonth(now).toISOString();
    const monthEnd = endOfMonth(now).toISOString();

    // Fetch all paid orders
    const ordersSnap = await db.collection('orders').where('payment.status', '==', 'paid').get();
    const allOrders = snapshotToArr(ordersSnap);

    const monthOrders = allOrders.filter((o) => o.createdAt >= monthStart && o.createdAt <= monthEnd);
    const totalRevenue = allOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const monthRevenue = monthOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    // Rentals
    const rentalsSnap = await db.collection('rentals').where('payment.status', '==', 'paid').get();
    const allRentals = snapshotToArr(rentalsSnap);
    const monthRentals = allRentals.filter((r) => r.createdAt >= monthStart && r.createdAt <= monthEnd);

    // Products and customers count
    const [productsSnap, customersSnap] = await Promise.all([
      db.collection('products').where('isActive', '==', true).count().get(),
      db.collection('users').where('role', '==', 'customer').count().get(),
    ]);

    // Recent orders (last 5)
    const recentSnap = await db.collection('orders')
      .where('payment.status', '==', 'paid')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    const recentOrders = snapshotToArr(recentSnap);

    // Top products by units sold (computed from order items)
    const salesMap = {};
    for (const order of allOrders) {
      for (const item of (order.items || [])) {
        if (!salesMap[item.product]) {
          salesMap[item.product] = { name: item.name, totalSold: 0, revenue: 0 };
        }
        salesMap[item.product].totalSold += item.quantity || 0;
        salesMap[item.product].revenue += (item.price || 0) * (item.quantity || 0);
      }
    }
    const topProducts = Object.entries(salesMap)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.totalSold - a.totalSold)
      .slice(0, 5);

    // Monthly revenue data (last 6 months)
    const monthlyMap = {};
    for (const order of allOrders) {
      const d = new Date(order.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, orders: 0, revenue: 0 };
      monthlyMap[key].orders += 1;
      monthlyMap[key].revenue += order.total || 0;
    }
    const monthlyData = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          totalOrders: allOrders.length,
          monthOrders: monthOrders.length,
          totalRevenue,
          monthRevenue,
          totalRentals: allRentals.length,
          monthRentals: monthRentals.length,
          totalProducts: productsSnap.data().count,
          totalCustomers: customersSnap.data().count,
        },
        recentOrders,
        topProducts,
        monthlyData,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
