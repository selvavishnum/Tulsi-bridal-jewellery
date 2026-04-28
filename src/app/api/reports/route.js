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

    // Fetch all orders (no composite index needed — single orderBy)
    const ordersSnap = await db.collection('orders').orderBy('createdAt', 'desc').get();
    const allOrders = snapshotToArr(ordersSnap);
    const paidOrders = allOrders.filter((o) => o.payment?.status === 'paid');
    const monthOrders = allOrders.filter((o) => o.createdAt >= monthStart && o.createdAt <= monthEnd);
    const monthPaidOrders = paidOrders.filter((o) => o.createdAt >= monthStart && o.createdAt <= monthEnd);

    const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const monthRevenue = monthPaidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    // Fetch all rentals
    const rentalsSnap = await db.collection('rentals').orderBy('createdAt', 'desc').get();
    const allRentals = snapshotToArr(rentalsSnap);
    const monthRentals = allRentals.filter((r) => r.createdAt >= monthStart && r.createdAt <= monthEnd);

    // Products and customers count (simple collection fetch, no composite index)
    const [productsSnap, usersSnap] = await Promise.all([
      db.collection('products').get(),
      db.collection('users').get(),
    ]);
    const totalProducts = snapshotToArr(productsSnap).filter((p) => p.isActive !== false).length;
    const totalCustomers = snapshotToArr(usersSnap).filter((u) => u.role === 'customer').length;

    // Recent paid orders (last 5)
    const recentOrders = paidOrders.slice(0, 5);

    // Top products by units sold
    const salesMap = {};
    for (const order of paidOrders) {
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
    const monthlyData = Object.values(monthlyMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6);

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
          totalProducts,
          totalCustomers,
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
