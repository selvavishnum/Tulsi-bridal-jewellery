'use client';

import { useState, useEffect } from 'react';
import { FiShoppingBag, FiDollarSign, FiCalendar, FiUsers } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

export default function AdminReportsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reports')
      .then((r) => r.json())
      .then((d) => { if (d.success) setData(d.data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>;
  if (!data) return <p className="text-gray-500">Failed to load reports.</p>;

  const { overview, monthlyData, topProducts } = data;

  const chartData = monthlyData.map((m) => ({
    name: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
    orders: m.orders,
    revenue: m.revenue,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Reports & Analytics</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue', value: formatPrice(overview.totalRevenue), icon: FiDollarSign, color: 'bg-green-500', sub: `${formatPrice(overview.monthRevenue)} this month` },
          { label: 'Total Orders', value: overview.totalOrders, icon: FiShoppingBag, color: 'bg-blue-500', sub: `${overview.monthOrders} this month` },
          { label: 'Total Rentals', value: overview.totalRentals, icon: FiCalendar, color: 'bg-purple-500', sub: `${overview.monthRentals} this month` },
          { label: 'Customers', value: overview.totalCustomers, icon: FiUsers, color: 'bg-maroon-500', sub: 'Registered' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm">
            <div className={`w-9 h-9 ${s.color} rounded-lg flex items-center justify-center text-white mb-3`}>
              <s.icon />
            </div>
            <p className="text-xl font-bold text-gray-800">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className="text-xs text-gray-400">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 mb-4">Revenue Trend (6 Months)</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => [formatPrice(v), 'Revenue']} />
              <Line type="monotone" dataKey="revenue" stroke="#800020" strokeWidth={2} dot={{ fill: '#800020', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 mb-4">Order Volume</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="orders" fill="#d4922a" radius={[4, 4, 0, 0]} name="Orders" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm">
        <h2 className="font-semibold text-gray-700 mb-4">Top Selling Products</h2>
        {topProducts.length === 0 ? (
          <p className="text-gray-400 text-sm">No sales data yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs uppercase border-b">
                <tr>
                  <th className="pb-3 text-left">#</th>
                  <th className="pb-3 text-left">Product</th>
                  <th className="pb-3 text-left">Units Sold</th>
                  <th className="pb-3 text-left">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {topProducts.map((p, i) => (
                  <tr key={p._id}>
                    <td className="py-3 text-gray-500">{i + 1}</td>
                    <td className="py-3 font-medium text-gray-800">{p.name}</td>
                    <td className="py-3 text-gray-600">{p.totalSold}</td>
                    <td className="py-3 font-semibold text-green-700">{formatPrice(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
