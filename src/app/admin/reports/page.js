'use client';

import { useState, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { formatPrice } from '@/lib/utils';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  FiBarChart2, FiPackage, FiTag, FiList, FiStar, FiUsers,
  FiPercent, FiCalendar, FiTrendingUp, FiDollarSign, FiGift, FiAward,
  FiDownload, FiPlay, FiChevronRight,
} from 'react-icons/fi';

/* ── Report definitions ─────────────────────────────────── */
const REPORTS = [
  {
    id: 'overview',     icon: FiBarChart2,   label: 'Dashboard Overview',
    desc: 'Revenue, orders, rentals & top products',
    color: 'text-blue-600 bg-blue-50',
  },
  {
    id: 'sales-by-product',  icon: FiPackage,   label: 'Sales by Product',
    desc: 'Units sold & revenue per product',
    color: 'text-green-600 bg-green-50',
  },
  {
    id: 'sales-by-category', icon: FiTag,       label: 'Sales by Category',
    desc: 'Revenue breakdown by jewellery category',
    color: 'text-teal-600 bg-teal-50',
  },
  {
    id: 'sales-by-order',    icon: FiList,      label: 'Sales by Order',
    desc: 'Order-wise detailed sales report',
    color: 'text-indigo-600 bg-indigo-50',
  },
  {
    id: 'top-products',      icon: FiStar,      label: 'Top Selling Products',
    desc: 'Top 20 products by units sold',
    color: 'text-amber-600 bg-amber-50',
  },
  {
    id: 'top-customers',     icon: FiUsers,     label: 'Top Purchasing Customers',
    desc: 'Top 20 customers by total spend',
    color: 'text-purple-600 bg-purple-50',
  },
  {
    id: 'gst-sales',         icon: FiPercent,   label: 'GST Sales Report',
    desc: 'Detailed GST (3%) breakdown per invoice',
    color: 'text-red-600 bg-red-50',
  },
  {
    id: 'rentals',           icon: FiCalendar,  label: 'Rental Report',
    desc: 'All rental bookings with deposit & status',
    color: 'text-pink-600 bg-pink-50',
  },
  {
    id: 'sales-summary',     icon: FiTrendingUp, label: 'Sales & Revenue Summary',
    desc: 'Monthly orders, rentals & revenue totals',
    color: 'text-orange-600 bg-orange-50',
  },
  {
    id: 'price-list',        icon: FiDollarSign, label: 'Product Price List',
    desc: 'All products with MRP, selling price & discount',
    color: 'text-stone-600 bg-stone-50',
  },
  {
    id: 'coupons',           icon: FiGift,      label: 'Coupon Usage Report',
    desc: 'Coupon codes, usage count & discounts given',
    color: 'text-rose-600 bg-rose-50',
  },
  {
    id: 'loyalty',           icon: FiAward,     label: 'Customer Loyalty Report',
    desc: 'Points balance, orders & spend per customer',
    color: 'text-yellow-600 bg-yellow-50',
  },
];

/* ── Helpers ─────────────────────────────────────────────── */
function fmt(v) { return formatPrice(v); }
function fmtDate(str) {
  if (!str || str === '—') return '—';
  try { return format(parseISO(str), 'dd MMM yyyy'); } catch { return str; }
}
function CssBar({ value, max, color = 'bg-maroon-700' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ── CSV export ──────────────────────────────────────────── */
function exportCSV(rows, filename) {
  if (!rows?.length) return;
  const keys = Object.keys(rows[0]);
  const lines = [
    keys.join(','),
    ...rows.map((r) => keys.map((k) => {
      const v = r[k] ?? '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('\n') ? `"${s}"` : s;
    }).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename + '.csv'; a.click();
  URL.revokeObjectURL(url);
}

/* ── Overview sub-component ──────────────────────────────── */
function OverviewReport({ data }) {
  if (!data) return null;
  const { overview, topProducts = [], monthlyData = [] } = data;
  const maxRev = Math.max(...monthlyData.map((m) => m.revenue || 0), 1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Revenue',  value: fmt(overview.totalRevenue || 0),  sub: `${fmt(overview.monthRevenue || 0)} this month`, c: 'bg-green-500' },
          { label: 'Total Orders',   value: overview.totalOrders || 0,          sub: `${overview.monthOrders || 0} this month`,        c: 'bg-blue-500'  },
          { label: 'Total Rentals',  value: overview.totalRentals || 0,         sub: `${overview.monthRentals || 0} this month`,       c: 'bg-purple-500'},
          { label: 'Customers',      value: overview.totalCustomers || 0,       sub: 'Registered',                                     c: 'bg-maroon-600'},
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm">
            <div className={`w-8 h-8 ${s.c} rounded-lg mb-3`} />
            <p className="text-xl font-bold text-gray-800">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4">Revenue Trend (Last 6 Months)</h3>
          <div className="space-y-3">
            {monthlyData.map((m) => (
              <div key={m.month}>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{m.month}</span>
                  <span className="font-semibold text-maroon-700">{fmt(m.revenue || 0)}</span>
                </div>
                <CssBar value={m.revenue || 0} max={maxRev} color="bg-maroon-700" />
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4">Top Products</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 border-b"><th className="pb-2 text-left">#</th><th className="pb-2 text-left">Product</th><th className="pb-2 text-right">Units</th><th className="pb-2 text-right">Revenue</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {topProducts.map((p, i) => (
                <tr key={i}><td className="py-2 text-gray-400 text-xs">{i + 1}</td><td className="py-2 font-medium text-gray-800 text-xs">{p.name}</td><td className="py-2 text-right text-xs text-gray-600">{p.totalSold}</td><td className="py-2 text-right text-xs font-semibold text-green-700">{fmt(p.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Generic table renderer ──────────────────────────────── */
function ReportTable({ columns, rows, totalsRow }) {
  if (!rows?.length) return <p className="text-gray-400 text-sm text-center py-16">No data for selected period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-max">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-3 py-3 text-left whitespace-nowrap ${c.right ? 'text-right' : ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50/60 transition">
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2.5 ${c.right ? 'text-right' : ''} ${c.bold ? 'font-semibold text-gray-800' : 'text-gray-600'} ${c.green ? 'text-green-700 font-semibold' : ''} ${c.badge ? '' : ''} whitespace-nowrap`}>
                  {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
          {totalsRow && (
            <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
              {columns.map((c, i) => (
                <td key={c.key} className={`px-3 py-3 text-sm ${c.right ? 'text-right' : ''} text-gray-800 whitespace-nowrap`}>
                  {i === 0 ? 'TOTAL' : (totalsRow[c.key] !== undefined ? (c.render ? c.render(totalsRow[c.key]) : totalsRow[c.key]) : '')}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Column definitions per report ──────────────────────── */
function getColumns(type) {
  switch (type) {
    case 'sales-by-product': return [
      { key: 'product',    label: 'Product',    bold: true },
      { key: 'unitsSold',  label: 'Units Sold', right: true },
      { key: 'orderCount', label: 'Orders',     right: true },
      { key: 'revenue',    label: 'Revenue',    right: true, green: true, render: fmt },
    ];
    case 'sales-by-category': return [
      { key: 'category',  label: 'Category',    bold: true },
      { key: 'orders',    label: 'Orders',      right: true },
      { key: 'unitsSold', label: 'Units Sold',  right: true },
      { key: 'revenue',   label: 'Revenue',     right: true, green: true, render: fmt },
    ];
    case 'sales-by-order': return [
      { key: 'orderNumber',   label: 'Order #',        bold: true },
      { key: 'date',          label: 'Date',           render: fmtDate },
      { key: 'customer',      label: 'Customer' },
      { key: 'phone',         label: 'Phone' },
      { key: 'items',         label: 'Items',          right: true },
      { key: 'subtotal',      label: 'Subtotal',       right: true, render: fmt },
      { key: 'discount',      label: 'Discount',       right: true, render: (v) => v > 0 ? `-${fmt(v)}` : '—' },
      { key: 'total',         label: 'Total',          right: true, green: true, render: fmt },
      { key: 'payment',       label: 'Payment' },
      { key: 'paymentStatus', label: 'Pay Status',     render: (v) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${v === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{v}</span> },
      { key: 'orderStatus',   label: 'Order Status' },
    ];
    case 'top-products': return [
      { key: 'product',   label: 'Product',    bold: true },
      { key: 'unitsSold', label: 'Units Sold', right: true },
      { key: 'revenue',   label: 'Revenue',    right: true, green: true, render: fmt },
    ];
    case 'top-customers': return [
      { key: 'customer',   label: 'Customer',     bold: true },
      { key: 'email',      label: 'Email' },
      { key: 'phone',      label: 'Phone' },
      { key: 'orders',     label: 'Orders',       right: true },
      { key: 'totalSpent', label: 'Total Spent',  right: true, green: true, render: fmt },
      { key: 'lastOrder',  label: 'Last Order',   render: fmtDate },
    ];
    case 'gst-sales': return [
      { key: 'invoiceNo',     label: 'Invoice #',    bold: true },
      { key: 'date',          label: 'Date',         render: fmtDate },
      { key: 'customer',      label: 'Customer' },
      { key: 'state',         label: 'State' },
      { key: 'taxableAmount', label: 'Taxable Amt',  right: true, render: fmt },
      { key: 'cgst',          label: 'CGST 1.5%',    right: true, render: fmt },
      { key: 'sgst',          label: 'SGST 1.5%',    right: true, render: fmt },
      { key: 'gstTotal',      label: 'GST Total',    right: true, render: fmt },
      { key: 'grandTotal',    label: 'Grand Total',  right: true, green: true, render: fmt },
      { key: 'payment',       label: 'Payment' },
    ];
    case 'rentals': return [
      { key: 'bookingId',    label: 'Booking ID',   bold: true },
      { key: 'product',      label: 'Product' },
      { key: 'customer',     label: 'Customer' },
      { key: 'phone',        label: 'Phone' },
      { key: 'startDate',    label: 'From',         render: fmtDate },
      { key: 'endDate',      label: 'To',           render: fmtDate },
      { key: 'rentalDays',   label: 'Days',         right: true },
      { key: 'rentalAmount', label: 'Rental Amt',   right: true, render: fmt },
      { key: 'deposit',      label: 'Deposit',      right: true, render: fmt },
      { key: 'total',        label: 'Total',        right: true, green: true, render: fmt },
      { key: 'status',       label: 'Status' },
    ];
    case 'sales-summary': return [
      { key: 'month',        label: 'Month',        bold: true },
      { key: 'orders',       label: 'Orders',       right: true },
      { key: 'orderRevenue', label: 'Sale Revenue', right: true, green: true, render: fmt },
      { key: 'rentals',      label: 'Rentals',      right: true },
      { key: 'rentalRevenue',label: 'Rental Rev.',  right: true, render: fmt },
      { key: 'discount',     label: 'Discounts',    right: true, render: (v) => v > 0 ? `-${fmt(v)}` : '—' },
    ];
    case 'price-list': return [
      { key: 'name',        label: 'Product',      bold: true },
      { key: 'category',    label: 'Category' },
      { key: 'sku',         label: 'SKU' },
      { key: 'mrp',         label: 'MRP',          right: true, render: fmt },
      { key: 'selling',     label: 'Selling Price',right: true, green: true, render: fmt },
      { key: 'discountPct', label: 'Discount',     right: true, render: (v) => v > 0 ? `${v}%` : '—' },
      { key: 'stock',       label: 'Stock',        right: true },
      { key: 'rental',      label: 'Rental' },
      { key: 'rentalRate',  label: 'Rental/Day',   right: true, render: (v) => v > 0 ? fmt(v) : '—' },
    ];
    case 'coupons': return [
      { key: 'code',          label: 'Coupon Code',  bold: true },
      { key: 'type',          label: 'Type' },
      { key: 'value',         label: 'Value',        right: true },
      { key: 'minOrder',      label: 'Min. Order',   right: true, render: fmt },
      { key: 'usedCount',     label: 'Used',         right: true },
      { key: 'totalDiscount', label: 'Total Discount',right: true, render: fmt },
      { key: 'totalRevenue',  label: 'Revenue from', right: true, green: true, render: fmt },
      { key: 'status',        label: 'Status',       render: (v) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${v === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{v}</span> },
      { key: 'expiresAt',     label: 'Expires',      render: fmtDate },
    ];
    case 'loyalty': return [
      { key: 'customer',       label: 'Customer',      bold: true },
      { key: 'email',          label: 'Email' },
      { key: 'phone',          label: 'Phone' },
      { key: 'loyaltyPoints',  label: '🏆 Points',      right: true, bold: true },
      { key: 'redeemableValue',label: 'Redeemable',    right: true, render: (v) => v > 0 ? fmt(v) : '—' },
      { key: 'totalOrders',    label: 'Orders',        right: true },
      { key: 'totalSpent',     label: 'Total Spent',   right: true, green: true, render: fmt },
      { key: 'referralCode',   label: 'Referral Code' },
      { key: 'joinedAt',       label: 'Joined',        render: fmtDate },
    ];
    default: return [];
  }
}

/* ── Totals row builder ──────────────────────────────────── */
function buildTotalsRow(type, data) {
  if (!data) return null;
  if (type === 'sales-by-product' && data.totals) return { revenue: data.totals.revenue, unitsSold: data.totals.unitsSold };
  if (type === 'sales-by-order' && data.totals) return { total: data.totals.revenue, discount: data.totals.discount };
  if (type === 'gst-sales' && data.totals) return data.totals;
  if (type === 'rentals' && data.totals) return { rentalAmount: data.totals.rentalRevenue, deposit: data.totals.deposits, total: data.totals.total };
  if (type === 'loyalty' && data.totals) return { loyaltyPoints: data.totals.totalPoints, totalSpent: data.totals.totalSpent };
  return null;
}

/* ── Summary bar ─────────────────────────────────────────── */
function SummaryBar({ type, data }) {
  if (!data) return null;
  const t = data.totals;
  if (!t) return null;

  let items = [];
  if (type === 'sales-by-product')  items = [{ label: 'Total Units', value: t.unitsSold }, { label: 'Total Revenue', value: fmt(t.revenue) }];
  if (type === 'sales-by-order')    items = [{ label: 'Orders', value: t.orders }, { label: 'Revenue', value: fmt(t.revenue) }, { label: 'Discounts', value: fmt(t.discount) }];
  if (type === 'gst-sales')         items = [{ label: 'Taxable Amt', value: fmt(t.taxableAmount) }, { label: 'CGST', value: fmt(t.cgst) }, { label: 'SGST', value: fmt(t.sgst) }, { label: 'Grand Total', value: fmt(t.grandTotal) }];
  if (type === 'rentals')           items = [{ label: 'Bookings', value: t.count }, { label: 'Rental Revenue', value: fmt(t.rentalRevenue) }, { label: 'Deposits', value: fmt(t.deposits) }];
  if (type === 'loyalty')           items = [{ label: 'Customers', value: t.customers }, { label: 'Total Points', value: t.totalPoints }, { label: 'Total Spent', value: fmt(t.totalSpent) }];

  if (!items.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      {items.map((item) => (
        <div key={item.label} className="bg-maroon-50 rounded-xl px-4 py-3">
          <p className="text-xs text-maroon-600 font-medium mb-0.5">{item.label}</p>
          <p className="text-lg font-bold text-maroon-900">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function AdminReportsPage() {
  const [activeId, setActiveId]   = useState('overview');
  const [from, setFrom]           = useState('');
  const [to, setTo]               = useState('');
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [sidebarOpen, setSidebar] = useState(false);

  const activeReport = REPORTS.find((r) => r.id === activeId);

  const runReport = useCallback(async (id = activeId) => {
    setLoading(true);
    setError(null);
    setData(null);
    const params = new URLSearchParams({ type: id });
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    try {
      const res  = await fetch(`/api/reports?${params}`);
      const json = await res.json();
      if (json.success) setData(json.data);
      else setError(json.message || 'Failed to load report');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeId, from, to]);

  function selectReport(id) {
    setActiveId(id);
    setData(null);
    setError(null);
    setSidebar(false);
  }

  const columns  = getColumns(activeId);
  const rows     = data?.rows || [];
  const totalsRow = buildTotalsRow(activeId, data);

  const hasDateFilter = !['overview', 'price-list'].includes(activeId);

  return (
    <div className="flex gap-0 lg:gap-5 min-h-[calc(100vh-4rem)]">

      {/* ── Sidebar (desktop) / Drawer (mobile) ── */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-72 bg-white shadow-2xl transform transition-transform duration-300 lg:relative lg:inset-auto lg:shadow-none lg:transform-none lg:w-64 lg:flex-shrink-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-4 border-b flex items-center justify-between lg:hidden">
          <p className="font-bold text-gray-800">Reports</p>
          <button onClick={() => setSidebar(false)} className="text-gray-500 text-xl">✕</button>
        </div>
        <div className="p-3 overflow-y-auto h-full">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-2 mb-3 hidden lg:block">Report Types</p>
          <div className="space-y-0.5">
            {REPORTS.map((r) => {
              const Icon = r.icon;
              const isActive = r.id === activeId;
              return (
                <button
                  key={r.id}
                  onClick={() => selectReport(r.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition group ${
                    isActive ? 'bg-maroon-950 text-white' : 'hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-white/20' : r.color}`}>
                    <Icon className={`text-sm ${isActive ? 'text-white' : ''}`} />
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold truncate ${isActive ? 'text-white' : 'text-gray-800'}`}>{r.label}</p>
                    <p className={`text-[10px] truncate mt-0.5 ${isActive ? 'text-white/70' : 'text-gray-400'}`}>{r.desc}</p>
                  </div>
                  {isActive && <FiChevronRight className="ml-auto text-white/70 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebar(false)} />}

      {/* ── Main content ── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => setSidebar(true)} className="lg:hidden p-2 bg-gray-100 rounded-lg text-gray-600 hover:bg-gray-200 transition">
              <FiList />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-gray-800 truncate">{activeReport?.label || 'Reports'}</h1>
              <p className="text-xs text-gray-400 truncate">{activeReport?.desc}</p>
            </div>
            {data && activeId !== 'overview' && rows.length > 0 && (
              <button
                onClick={() => exportCSV(rows, activeId)}
                className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition flex-shrink-0"
              >
                <FiDownload /> Export CSV
              </button>
            )}
          </div>

          {/* Date filter + Run */}
          {hasDateFilter && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">From</div>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-gold-400" />
              <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">To</div>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-gold-400" />
              <button onClick={() => { setFrom(''); setTo(''); }}
                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-50 transition">
                Clear
              </button>
              <button onClick={() => runReport()}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-maroon-950 hover:bg-maroon-900 text-white text-xs font-semibold rounded-lg disabled:opacity-60 transition">
                <FiPlay className="text-xs" /> {loading ? 'Loading…' : 'Run Report'}
              </button>
            </div>
          )}
          {!hasDateFilter && (
            <button onClick={() => runReport()}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-maroon-950 hover:bg-maroon-900 text-white text-xs font-semibold rounded-lg disabled:opacity-60 transition">
              <FiPlay className="text-xs" /> {loading ? 'Loading…' : 'Run Report'}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <LoadingSpinner size="lg" />
            </div>
          )}
          {error && !loading && (
            <div className="py-16 text-center">
              <p className="text-red-500 font-semibold mb-1">Failed to load report</p>
              <p className="text-gray-400 text-sm">{error}</p>
              <button onClick={() => runReport()} className="mt-4 px-4 py-2 bg-maroon-950 text-white text-sm rounded-lg">Retry</button>
            </div>
          )}
          {!loading && !error && !data && (
            <div className="py-20 text-center">
              <div className={`w-16 h-16 ${activeReport?.color} rounded-2xl flex items-center justify-center mx-auto mb-4`}>
                {activeReport && <activeReport.icon className="text-2xl" />}
              </div>
              <p className="font-semibold text-gray-600 mb-1">{activeReport?.label}</p>
              <p className="text-gray-400 text-sm mb-5">{activeReport?.desc}</p>
              <button onClick={() => runReport()}
                className="flex items-center gap-2 px-5 py-2.5 bg-maroon-950 text-white font-semibold text-sm rounded-xl hover:bg-maroon-900 transition mx-auto">
                <FiPlay /> Run Report
              </button>
            </div>
          )}
          {!loading && !error && data && (
            <div className="p-4">
              {activeId === 'overview' ? (
                <OverviewReport data={data} />
              ) : (
                <>
                  <SummaryBar type={activeId} data={data} />
                  <ReportTable columns={columns} rows={rows} totalsRow={totalsRow} />
                  <p className="text-xs text-gray-400 mt-3 text-right">{rows.length} records</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
