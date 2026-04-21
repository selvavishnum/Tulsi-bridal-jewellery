'use client';
import { useState, useEffect } from 'react';
import { FiTrendingUp, FiShoppingBag, FiCalendar, FiDollarSign, FiPackage } from 'react-icons/fi';

function StatCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    green: 'bg-green-50 border-green-100 text-green-700',
    gold: 'bg-amber-50 border-amber-100 text-amber-700',
    purple: 'bg-purple-50 border-purple-100 text-purple-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="text-lg" />
        <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</span>
      </div>
      <p className="text-3xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
    </div>
  );
}

export default function SalesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('month');

  useEffect(() => { fetchSales(); }, [range]);

  async function fetchSales() {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports?range=${range}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally { setLoading(false); }
  }

  const ov = data?.overview || {};

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FiTrendingUp /> Sales Overview</h1>
          <p className="text-gray-500 text-sm mt-0.5">Revenue from orders and rentals</p>
        </div>
        <div className="flex gap-2">
          {['week', 'month', 'year'].map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${range === r ? 'bg-maroon-950 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              This {r}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard icon={FiDollarSign} label="Total Revenue" value={`₹${(ov.totalRevenue || 0).toLocaleString()}`} color="green" />
            <StatCard icon={FiDollarSign} label="This Month" value={`₹${(ov.monthRevenue || 0).toLocaleString()}`} color="blue" />
            <StatCard icon={FiShoppingBag} label="Total Orders" value={ov.totalOrders || 0} sub={`${ov.monthOrders || 0} this month`} color="purple" />
            <StatCard icon={FiCalendar} label="Total Rentals" value={ov.totalRentals || 0} sub={`${ov.monthRentals || 0} this month`} color="gold" />
          </div>

          {/* Top Products */}
          {data?.topProducts?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-5">
              <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><FiPackage /> Best Selling Products</h2>
              <div className="space-y-3">
                {data.topProducts.map((p, i) => (
                  <div key={p.id || i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 bg-maroon-100 text-maroon-700 rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                      <span className="text-sm font-medium text-gray-900">{p.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{p.totalSold} units</p>
                      <p className="text-xs text-green-600">₹{(p.revenue || 0).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Orders */}
          {data?.recentOrders?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-bold text-gray-900 mb-4">Recent Sales</h2>
              <div className="space-y-2">
                {data.recentOrders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{o.orderNumber}</p>
                      <p className="text-xs text-gray-400">{o.createdAt?.slice(0, 10)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-600">₹{(o.total || 0).toLocaleString()}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${o.status === 'delivered' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{o.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
