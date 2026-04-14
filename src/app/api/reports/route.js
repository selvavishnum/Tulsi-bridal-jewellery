import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Rental from '@/models/Rental';
import Product from '@/models/Product';
import User from '@/models/User';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    await connectDB();

    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    const [
      totalOrders, monthOrders, totalRevenue, monthRevenue,
      totalRentals, monthRentals, totalProducts, totalCustomers,
      recentOrders, topProducts, monthlyData,
    ] = await Promise.all([
      Order.countDocuments({ 'payment.status': 'paid' }),
      Order.countDocuments({ 'payment.status': 'paid', createdAt: { $gte: monthStart, $lte: monthEnd } }),
      Order.aggregate([{ $match: { 'payment.status': 'paid' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.aggregate([{ $match: { 'payment.status': 'paid', createdAt: { $gte: monthStart, $lte: monthEnd } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Rental.countDocuments({ 'payment.status': 'paid' }),
      Rental.countDocuments({ 'payment.status': 'paid', createdAt: { $gte: monthStart, $lte: monthEnd } }),
      Product.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'customer' }),
      Order.find({ 'payment.status': 'paid' }).sort({ createdAt: -1 }).limit(5).populate('user', 'name email').lean(),
      Order.aggregate([
        { $match: { 'payment.status': 'paid' } },
        { $unwind: '$items' },
        { $group: { _id: '$items.product', name: { $first: '$items.name' }, totalSold: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
        { $sort: { totalSold: -1 } },
        { $limit: 5 },
      ]),
      Order.aggregate([
        { $match: { 'payment.status': 'paid', createdAt: { $gte: subMonths(now, 6) } } },
        { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          totalOrders, monthOrders,
          totalRevenue: totalRevenue[0]?.total || 0,
          monthRevenue: monthRevenue[0]?.total || 0,
          totalRentals, monthRentals,
          totalProducts, totalCustomers,
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
