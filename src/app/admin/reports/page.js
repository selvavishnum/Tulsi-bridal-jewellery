'use client';

import { useState, useEffect } from 'react';
import { FiShoppingBag, FiDollarSign, FiCalendar, FiUsers } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

function CssBar({ value, max, color = 'bg-maroon-700' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function AdminReportsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/reports')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d.data);
        else setError(d.message || 'Failed to load');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>;

  if (error || !data) return (
    <div className="flex items-center justify-center h-64 text-center">
      <div>
        <p className="text-red-500 font-semibold mb-1">Failed to load reports</p>
        <p className="text-gray-400 text-sm">{error}</p>
        <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-maroon-950 text-white text-sm rounded-lg">Retry</button>
      </div>
    </div>
  );

  const { overview, monthlyData = [], topProducts = [] } = data;

  const maxRevenue = Math.max(...monthlyData.map((m) => m.revenue || 0), 1);
  const maxOrders  = Math.max(...monthlyData.map((m) => m.orders  || 0), 1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Reports & Analytics</h1>

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue',  value: formatPrice(overview.totalRevenue || 0), icon: FiDollarSign, color: 'bg-green-500',   sub: `${formatPrice(overview.monthRevenue || 0)} this month` },
          { label: 'Total Orders',   value: overview.totalOrders   || 0,              icon: FiShoppingBag, color: 'bg-blue-500',   sub: `${overview.monthOrders || 0} this month` },
          { label: 'Total Rentals',  value: overview.totalRentals  || 0,              icon: FiCalendar,    color: 'bg-purple-500', sub: `${overview.monthRentals || 0} this month` },
          { label: 'Customers',      value: overview.totalCustomers || 0,             icon: FiUsers,       color: 'bg-maroon-600', sub: 'Registered' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm">
            <div className={`w-9 h-9 ${s.color} rounded-lg flex items-center justify-center text-white mb-3`}>
              <s.icon />
            </div>
            <p className="text-xl font-bold text-gray-800">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Revenue Trend */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 mb-5">Revenue Trend (Last 6 Months)</h2>
          {monthlyData.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">No data yet</p>
          ) : (
            <div className="space-y-4">
              {monthlyData.map((m) => (
                <div key={m.month}>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{m.month}</span>
                    <span className="font-semibold text-maroon-700">{formatPrice(m.revenue || 0)}</span>
                  </div>
                  <CssBar value={m.revenue || 0} max={maxRevenue} color="bg-maroon-700" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Order Volume */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 mb-5">Order Volume (Last 6 Months)</h2>
          {monthlyData.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">No data yet</p>
          ) : (
            <div className="space-y-4">
              {monthlyData.map((m) => (
                <div key={m.month}>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{m.month}</span>
                    <span className="font-semibold text-gold-700">{m.orders || 0} orders</span>
                  </div>
                  <CssBar value={m.orders || 0} max={maxOrders} color="bg-gold-500" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Products */}
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
                  <tr key={p.id || i}>
                    <td className="py-3 text-gray-500">{i + 1}</td>
                    <td className="py-3 font-medium text-gray-800">{p.name}</td>
                    <td className="py-3 text-gray-600">{p.totalSold}</td>
                    <td className="py-3 font-semibold text-green-700">{formatPrice(p.revenue || 0)}</td>
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
