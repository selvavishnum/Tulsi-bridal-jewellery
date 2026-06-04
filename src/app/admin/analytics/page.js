'use client';

import { useState, useEffect } from 'react';
import { FiUsers, FiClock, FiTrendingUp, FiShoppingCart, FiExternalLink, FiRefreshCw, FiActivity, FiEye, FiUserPlus } from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

function StatCard({ icon: Icon, label, value, sub, color = 'amber' }) {
  const colors = {
    amber:  { bg: 'bg-amber-500/10',  icon: 'text-amber-400',  val: 'text-amber-300' },
    green:  { bg: 'bg-emerald-500/10', icon: 'text-emerald-400', val: 'text-emerald-300' },
    blue:   { bg: 'bg-blue-500/10',   icon: 'text-blue-400',   val: 'text-blue-300' },
    red:    { bg: 'bg-red-500/10',    icon: 'text-red-400',    val: 'text-red-300' },
    purple: { bg: 'bg-purple-500/10', icon: 'text-purple-400', val: 'text-purple-300' },
  };
  const c = colors[color] || colors.amber;
  return (
    <div className="bg-[#161b22] border border-white/[0.07] rounded-2xl p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`${c.icon} text-lg`} />
      </div>
      <div className="min-w-0">
        <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">{label}</p>
        <p className={`text-2xl font-bold ${c.val} leading-none`}>{value ?? '—'}</p>
        {sub && <p className="text-slate-600 text-xs mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function BarChart({ data, max, colorClass = 'bg-amber-500' }) {
  return (
    <div className="space-y-2">
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-slate-400 text-xs w-28 truncate flex-shrink-0 capitalize">{item.name || item.path}</span>
          <div className="flex-1 bg-white/[0.04] rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full ${colorClass} transition-all duration-700`}
              style={{ width: max > 0 ? `${(item.views / max) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-slate-500 text-xs w-8 text-right flex-shrink-0">{item.views}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/analytics');
      const json = await res.json();
      if (json.success) { setData(json.data); setLastUpdated(new Date()); }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const t = setInterval(load, 2 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-white text-2xl font-bold">Visitor Analytics</h1>
          <p className="text-slate-500 text-sm mt-1">
            Real-time activity from registered customers
            {lastUpdated && <span className="ml-2 text-slate-600">· Updated {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {GA_ID && (
            <a
              href={`https://analytics.google.com/analytics/web/#/p${GA_ID.replace('G-', '')}/reports/intelligenthome`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition"
            >
              <FiExternalLink className="text-sm" /> Open Google Analytics
            </a>
          )}
          {!GA_ID && (
            <div className="px-4 py-2 bg-orange-500/10 border border-orange-500/30 rounded-xl text-orange-400 text-xs font-medium">
              Set <code className="bg-orange-900/30 px-1 rounded">NEXT_PUBLIC_GA_MEASUREMENT_ID</code> env var to enable GA4
            </div>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-sm font-medium rounded-xl transition disabled:opacity-50"
          >
            <FiRefreshCw className={`text-sm ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : data ? (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={FiActivity}   label="Active Now"       value={data.activeNow}       sub="Last 30 minutes"      color="green" />
            <StatCard icon={FiUsers}      label="Sessions Today"   value={data.todaySessions}   sub="Logged-in customers"  color="amber" />
            <StatCard icon={FiTrendingUp} label="Sessions / Week"  value={data.weekSessions}    sub="Last 7 days"          color="blue" />
            <StatCard icon={FiUserPlus}   label="New Customers"    value={data.newThisWeek}     sub="Registered this week" color="purple" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={FiUsers}       label="Total Customers"  value={data.totalUsers}       sub="All registered"       color="amber" />
            <StatCard icon={FiClock}       label="Avg Session"      value={`${data.avgSessionMin}m`} sub="Per visit"          color="blue" />
            <StatCard icon={FiShoppingCart} label="Carts Abandoned" value={data.cartAbandoned}   sub="Items in cart, no order" color="red" />
            <StatCard icon={FiEye}         label="Products Tracked" value={data.topProducts.length > 0 ? data.topProducts.reduce((s, p) => s + p.views, 0) : 0} sub="Total product views" color="green" />
          </div>

          {/* Charts row */}
          <div className="grid md:grid-cols-2 gap-5">
            {/* Top categories */}
            <div className="bg-[#161b22] border border-white/[0.07] rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <FiTrendingUp className="text-amber-400" /> Top Categories Browsed
              </h3>
              {data.topCategories.length > 0 ? (
                <BarChart data={data.topCategories} max={data.topCategories[0]?.views || 1} colorClass="bg-amber-500" />
              ) : (
                <p className="text-slate-600 text-sm text-center py-6">No category browsing data yet</p>
              )}
            </div>

            {/* Top pages */}
            <div className="bg-[#161b22] border border-white/[0.07] rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <FiEye className="text-blue-400" /> Top Pages Visited
              </h3>
              {data.topPages.length > 0 ? (
                <BarChart data={data.topPages} max={data.topPages[0]?.views || 1} colorClass="bg-blue-500" />
              ) : (
                <p className="text-slate-600 text-sm text-center py-6">No page view data yet</p>
              )}
            </div>
          </div>

          {/* Top viewed products */}
          {data.topProducts.length > 0 && (
            <div className="bg-[#161b22] border border-white/[0.07] rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <FiEye className="text-emerald-400" /> Most Viewed Products
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {data.topProducts.map((p, i) => (
                  <div key={i} className="bg-white/[0.03] rounded-xl p-3 text-center">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-full aspect-square object-cover rounded-lg mb-2" />
                    ) : (
                      <div className="w-full aspect-square bg-white/[0.04] rounded-lg flex items-center justify-center mb-2 text-2xl">💍</div>
                    )}
                    <p className="text-slate-300 text-xs font-medium line-clamp-2 leading-tight">{p.name}</p>
                    <p className="text-amber-400 text-xs font-bold mt-1">{p.views} views</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* GA4 notice */}
          <div className="bg-[#161b22] border border-white/[0.07] rounded-2xl p-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <FiActivity className="text-orange-400 text-lg" />
              </div>
              <div>
                <p className="text-white font-semibold mb-1">Full Visitor Analytics — Google Analytics 4</p>
                <p className="text-slate-500 text-sm leading-relaxed mb-3">
                  The data above tracks registered (logged-in) customers only. To see <strong className="text-slate-300">all visitors</strong> — including
                  anonymous shoppers, traffic sources (Google, Instagram, WhatsApp), bounce rate, device type, and real-time active users across the
                  entire site — connect Google Analytics 4.
                </p>
                {GA_ID ? (
                  <a
                    href="https://analytics.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition"
                  >
                    <FiExternalLink className="text-sm" /> Open Google Analytics Dashboard
                  </a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-slate-400 text-xs font-medium">To enable GA4:</p>
                    <ol className="text-slate-500 text-xs space-y-1 list-decimal list-inside">
                      <li>Go to <strong className="text-slate-400">analytics.google.com</strong> → create a property for your site</li>
                      <li>Copy your <strong className="text-slate-400">Measurement ID</strong> (format: <code className="bg-slate-800 px-1 rounded text-amber-400">G-XXXXXXXXXX</code>)</li>
                      <li>Add <code className="bg-slate-800 px-1 rounded text-amber-400">NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX</code> to your Vercel environment variables</li>
                      <li>Redeploy — GA4 will start tracking all visitors automatically</li>
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-20 text-slate-500">Failed to load analytics data</div>
      )}
    </div>
  );
}
