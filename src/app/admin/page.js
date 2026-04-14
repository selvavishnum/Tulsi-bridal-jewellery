'use client';

import { useState, useEffect } from 'react';
import { FiShoppingBag, FiDollarSign, FiCalendar, FiUsers, FiPackage, FiTrendingUp } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import { format } from 'date-fns';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Badge from '@/components/ui/Badge';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const STATUS_BADGE = {
  pending: 'warning', confirmed: 'success', processing: 'gold',
  shipped: 'gold', delivered: 'success', cancelled: 'danger',
};

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reports')
      .then((r) => r.json())
      .then((d) => { if (d.success) setData(d.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>;
  if (!data) return <p className="text-gray-500">Failed to load dashboard data.</p>;

  const { overview, recentOrders, topProducts, monthlyData } = data;

  const stats = [
    { label: 'Total Revenue', value: formatPrice(overview.totalRevenue), sub: `${formatPrice(overview.monthRevenue)} this month`, icon: FiDollarSign, color: 'bg-green-500' },
    { label: 'Total Orders', value: overview.totalOrders, sub: `${overview.monthOrders} this month`, icon: FiShoppingBag, color: 'bg-blue-500' },
    { label: 'Total Rentals', value: overview.totalRentals, sub: `${overview.monthRentals} this month`, icon: FiCalendar, color: 'bg-purple-500' },
    { label: 'Products', value: overview.totalProducts, sub: 'Active listings', icon: FiPackage, color: 'bg-gold-500' },
    { label: 'Customers', value: overview.totalCustomers, sub: 'Registered users', icon: FiUsers, color: 'bg-maroon-500' },
  ];

  const chartData = monthlyData.map((m) => ({
    month: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
    orders: m.orders,
    revenue: m.revenue,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-gray-500 text-sm">Welcome back, here&apos;s what&apos;s happening</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm">
            <div className={`w-9 h-9 ${s.color} rounded-lg flex items-center justify-center text-white mb-3`}>
              <s.icon className="text-base" />
            </div>
            <p className="text-2xl font-bold text-gray-800">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Revenue chart */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2"><FiTrendingUp className="text-gold-600" /> Monthly Revenue</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => [formatPrice(v), 'Revenue']} />
                <Bar dataKey="revenue" fill="#800020" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-400 text-sm text-center py-8">No data yet</p>}
        </div>

        {/* Top products */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 mb-4">Top Products</h2>
          {topProducts.length === 0 ? (
            <p className="text-gray-400 text-sm">No sales data yet</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={p._id} className="flex items-center gap-3">
                  <span className="w-6 h-6 bg-maroon-50 text-maroon-950 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.totalSold} sold</p>
                  </div>
                  <span className="text-sm font-semibold text-green-600">{formatPrice(p.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-700">Recent Orders</h2>
          <a href="/admin/orders" className="text-xs text-gold-600 hover:text-gold-700">View all →</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-5 py-3 text-left">Order</th>
                <th className="px-5 py-3 text-left">Customer</th>
                <th className="px-5 py-3 text-left">Amount</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentOrders.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No orders yet</td></tr>
              ) : recentOrders.map((o) => (
                <tr key={o._id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs text-gray-600">#{o.orderNumber}</td>
                  <td className="px-5 py-3 text-gray-700">{o.user?.name || o.guestEmail || '—'}</td>
                  <td className="px-5 py-3 font-semibold text-gray-800">{formatPrice(o.total)}</td>
                  <td className="px-5 py-3"><Badge variant={STATUS_BADGE[o.status] || 'default'}>{o.status}</Badge></td>
                  <td className="px-5 py-3 text-gray-400 text-xs">{format(new Date(o.createdAt), 'dd MMM yyyy')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
