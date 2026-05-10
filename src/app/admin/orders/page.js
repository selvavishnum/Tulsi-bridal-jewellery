'use client';

import { useState, useEffect, useMemo } from 'react';
import { FiSearch, FiX, FiChevronDown, FiChevronUp, FiPhone, FiTruck, FiPackage, FiExternalLink, FiPrinter, FiList } from 'react-icons/fi';
import { formatPrice } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const STATUS_BADGE = {
  pending: 'warning', confirmed: 'success', processing: 'gold',
  shipped: 'gold', delivered: 'success', cancelled: 'danger', returned: 'danger',
};
const STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

const STATUS_FLOW = {
  pending:    { next: 'confirmed',  color: 'bg-yellow-500' },
  confirmed:  { next: 'processing', color: 'bg-blue-500' },
  processing: { next: 'shipped',    color: 'bg-indigo-500' },
  shipped:    { next: 'delivered',  color: 'bg-purple-500' },
  delivered:  { next: null,         color: 'bg-green-500' },
  cancelled:  { next: null,         color: 'bg-red-500' },
};

const COURIERS = [
  'Shiprocket', 'BlueDart', 'Delhivery', 'DTDC', 'Ecom Express',
  'FedEx', 'India Post', 'XpressBees', 'Shadowfax', 'Other',
];

/* ── Print Delivery Label ── */
function printLabel(order) {
  const addr = order.shippingAddress || {};
  const name    = addr.fullName || addr.name || order.user?.name || order.guestEmail || '—';
  const phone   = addr.phone || '—';
  const street  = addr.street || '—';
  const city    = addr.city   || '';
  const state   = addr.state  || '';
  const pincode = addr.pincode || '';
  const email   = addr.email || order.guestEmail || '';
  const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  const payLine = `${(order.payment?.method || 'online').toUpperCase()} — ${(order.payment?.status || 'pending').toUpperCase()}`;

  const itemsHtml = (order.items || [])
    .map((it) => `<tr><td style="padding:3px 6px;">${it.name}</td><td style="padding:3px 6px;text-align:center;">× ${it.quantity}</td><td style="padding:3px 6px;text-align:right;">₹${((it.price || 0) * it.quantity).toLocaleString('en-IN')}</td></tr>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Label — Order #${order.orderNumber}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;}
  @page{size:A5 portrait;margin:0;}
  .page{width:148mm;min-height:210mm;padding:8mm;display:flex;flex-direction:column;gap:4mm;}
  .border-box{border:1.5px solid #000;border-radius:3px;padding:4mm;}
  .from-header{display:flex;align-items:center;gap:3mm;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:3mm;}
  .logo-block{font-size:16pt;font-weight:900;line-height:1;letter-spacing:-0.5px;}
  .logo-sub{font-size:7pt;letter-spacing:3px;color:#555;margin-top:1px;}
  .from-addr{font-size:7pt;color:#444;line-height:1.5;}
  .ship-to-label{font-size:7pt;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;margin-bottom:2mm;}
  .ship-name{font-size:18pt;font-weight:900;line-height:1.1;text-transform:uppercase;margin-bottom:2mm;}
  .ship-addr{font-size:11pt;font-weight:600;line-height:1.6;color:#111;}
  .ship-phone{font-size:11pt;font-weight:700;margin-top:2mm;letter-spacing:0.5px;}
  .order-bar{background:#000;color:#fff;padding:2.5mm 4mm;border-radius:2px;display:flex;justify-content:space-between;align-items:center;font-size:8pt;}
  .order-num{font-weight:900;font-size:12pt;letter-spacing:1px;}
  .items-table{width:100%;border-collapse:collapse;font-size:8.5pt;}
  .items-table th{background:#f0f0f0;padding:3px 6px;text-align:left;font-size:7pt;text-transform:uppercase;letter-spacing:1px;}
  .items-table td{border-bottom:1px solid #eee;}
  .total-row{font-weight:900;font-size:10pt;text-align:right;padding-top:2mm;}
  .barcode{font-family:'Courier New',monospace;font-size:28pt;font-weight:900;letter-spacing:4px;text-align:center;padding:3mm 0;border:1.5px solid #ddd;border-radius:3px;background:#fafafa;}
  .barcode-label{font-size:7pt;text-align:center;color:#777;margin-top:1mm;letter-spacing:1px;}
  .tags{display:flex;gap:3mm;}
  .tag{flex:1;border:2px solid #000;border-radius:3px;padding:2mm;text-align:center;font-size:8pt;font-weight:900;text-transform:uppercase;letter-spacing:1px;}
  .tag.fragile{border-color:#cc0000;color:#cc0000;}
  .footer-note{font-size:7pt;color:#777;text-align:center;padding-top:2mm;}
</style>
</head>
<body>
<div class="page">

  <!-- FROM header -->
  <div class="border-box from-header">
    <div>
      <div class="logo-block">TULSI</div>
      <div class="logo-sub">BRIDAL JEWELLERY</div>
    </div>
    <div class="from-addr" style="margin-left:auto;text-align:right;">
      <strong>FROM:</strong><br/>
      Tulsi Bridal Jewellery<br/>
      Tamil Nadu, India<br/>
      +91 76958 68787
    </div>
  </div>

  <!-- Order bar -->
  <div class="order-bar">
    <span class="order-num">ORDER #${order.orderNumber}</span>
    <span style="font-size:7pt;">${dateStr}</span>
    <span style="font-size:8pt;font-weight:700;">${payLine}</span>
  </div>

  <!-- SHIP TO -->
  <div class="border-box" style="flex:1;">
    <div class="ship-to-label">▶ SHIP TO</div>
    <div class="ship-name">${name}</div>
    <div class="ship-addr">
      ${street}<br/>
      ${city}${city && state ? ', ' : ''}${state}${pincode ? ' — ' + pincode : ''}
    </div>
    <div class="ship-phone">📞 ${phone}</div>
    ${email ? `<div style="font-size:8pt;color:#555;margin-top:1.5mm;">✉ ${email}</div>` : ''}
  </div>

  <!-- Items -->
  <div class="border-box">
    <table class="items-table">
      <thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th></tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    <div class="total-row">Total: ₹${(order.total || 0).toLocaleString('en-IN')}</div>
  </div>

  <!-- Barcode / order number -->
  <div>
    <div class="barcode">${String(order.orderNumber).padStart(8, '0')}</div>
    <div class="barcode-label">ORDER NUMBER — SCAN AT DELIVERY</div>
  </div>

  <!-- Tags -->
  <div class="tags">
    <div class="tag fragile">⚠ Fragile</div>
    <div class="tag">Handle with Care</div>
    <div class="tag">Jewellery</div>
  </div>

  <div class="footer-note">Tulsi Bridal Jewellery · Customer support: +91 76958 68787</div>
</div>
<script>window.onload=function(){window.print();setTimeout(function(){window.close();},1000);};</script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=600,height=800');
  if (w) { w.document.write(html); w.document.close(); }
}

/* ── Shipment / Tracking Modal ── */
function ShipmentModal({ order, onClose, onShipped }) {
  const [mode, setMode] = useState('manual'); // 'manual' | 'shiprocket'
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber || '');
  const [courierName, setCourierName] = useState(order.courierName || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!trackingNumber.trim()) return toast.error('Enter tracking number');
    setSaving(true);
    try {
      const res = await fetch('/api/admin/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order._id,
          manualTracking: true,
          trackingNumber: trackingNumber.trim(),
          courierName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Tracking saved & order marked Shipped');
        onShipped();
        onClose();
      } else {
        toast.error(data.message || 'Failed');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function createShiprocket() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order._id, manualTracking: false }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Shiprocket shipment created! AWB: ${data.data?.awb || '—'}`);
        onShipped();
        onClose();
      } else {
        toast.error(data.message || 'Failed');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><FiTruck /> Ship Order</h3>
            <p className="text-xs text-gray-400 mt-0.5">Order #{order.orderNumber}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><FiX /></button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-2 mb-5 p-1 bg-gray-100 rounded-xl">
          <button onClick={() => setMode('manual')} className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${mode === 'manual' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
            Manual Entry
          </button>
          <button onClick={() => setMode('shiprocket')} className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${mode === 'shiprocket' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
            Shiprocket API
          </button>
        </div>

        {mode === 'manual' ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Courier Partner</label>
              <select value={courierName} onChange={(e) => setCourierName(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400">
                <option value="">Select courier…</option>
                {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Tracking Number *</label>
              <input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="e.g. 1234567890"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400 font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">Order will be auto-marked as "Shipped" and customer will be notified by email.</p>
            </div>
            <button onClick={save} disabled={saving}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition disabled:opacity-60 flex items-center justify-center gap-2">
              <FiTruck /> {saving ? 'Saving…' : 'Save Tracking & Mark Shipped'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-sm text-blue-800 font-semibold mb-1">Auto-create via Shiprocket</p>
              <p className="text-xs text-blue-600 leading-relaxed">
                This will create the order in Shiprocket, assign a courier automatically,
                and store the AWB tracking number. Requires <code className="bg-blue-100 px-1 rounded">SHIPROCKET_EMAIL</code> and{' '}
                <code className="bg-blue-100 px-1 rounded">SHIPROCKET_PASSWORD</code> in your .env.local file.
              </p>
            </div>
            <button onClick={createShiprocket} disabled={saving}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition disabled:opacity-60 flex items-center justify-center gap-2">
              <FiPackage /> {saving ? 'Creating…' : 'Create Shiprocket Shipment'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tracking Info row ── */
function TrackingInfo({ order }) {
  if (!order.trackingNumber) return null;
  const shiprocketUrl = `https://shiprocket.co/tracking/${order.trackingNumber}`;
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <FiTruck className="text-indigo-500 text-xs flex-shrink-0" />
      <span className="text-xs text-gray-500 font-mono">{order.trackingNumber}</span>
      {order.courierName && <span className="text-xs text-gray-400">({order.courierName})</span>}
      <a href={shiprocketUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-0.5">
        Track <FiExternalLink className="text-[10px]" />
      </a>
    </div>
  );
}

/* ── Resend Email Buttons ── */
function ResendEmailButtons({ orderId }) {
  const [state, setState] = useState({}); // { admin: 'loading'|'ok'|'err', customer: ... }

  async function resend(type) {
    setState((s) => ({ ...s, [type]: 'loading' }));
    try {
      const res  = await fetch('/api/admin/resend-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, type }),
      });
      const data = await res.json();
      if (data.success) {
        setState((s) => ({ ...s, [type]: 'ok' }));
        toast.success(data.message);
      } else {
        setState((s) => ({ ...s, [type]: 'err' }));
        toast.error(data.message || 'Email failed');
      }
    } catch (e) {
      setState((s) => ({ ...s, [type]: 'err' }));
      toast.error(e.message);
    }
  }

  const btnClass = (t) =>
    `flex items-center gap-1.5 w-full px-3 py-2 text-xs font-semibold rounded-lg transition ${
      state[t] === 'ok'      ? 'bg-green-100 text-green-700 border border-green-200' :
      state[t] === 'err'     ? 'bg-red-100 text-red-700 border border-red-200' :
      state[t] === 'loading' ? 'bg-gray-100 text-gray-400 cursor-wait' :
      t === 'admin'          ? 'bg-wine-50 text-wine-700 border border-wine-200 hover:bg-wine-100' :
                               'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
    }`;

  return (
    <>
      <button onClick={() => resend('admin')} disabled={state.admin === 'loading'} className={btnClass('admin')}>
        📧 {state.admin === 'ok' ? 'Admin mail sent ✓' : state.admin === 'err' ? 'Failed — check console' : 'Resend Admin Email'}
      </button>
      <button onClick={() => resend('customer')} disabled={state.customer === 'loading'} className={btnClass('customer')}>
        📧 {state.customer === 'ok' ? 'Customer mail sent ✓' : state.customer === 'err' ? 'Failed — check console' : 'Resend Customer Email'}
      </button>
    </>
  );
}

const SIDEBAR_ITEMS = [
  { id: 'dashboard',   label: 'Dashboard',     icon: '📊', status: null,        badgeColor: null },
  { id: 'new',         label: 'New Orders',     icon: '🆕', status: 'pending',   badgeColor: 'bg-blue-500' },
  { id: 'confirmed',   label: 'Confirmed',      icon: '✅', status: 'confirmed', badgeColor: 'bg-green-500' },
  { id: 'processing',  label: 'Processing',     icon: '📦', status: 'processing',badgeColor: 'bg-orange-500' },
  { id: 'shipped',     label: 'Shipped',        icon: '🚚', status: 'shipped',   badgeColor: 'bg-purple-500' },
  { id: 'delivered',   label: 'Delivered',      icon: '🏠', status: 'delivered', badgeColor: 'bg-green-600' },
  { id: 'cod',         label: 'COD Pending',    icon: '💰', status: '__cod__',   badgeColor: 'bg-yellow-500' },
  { id: 'action',      label: 'Action Needed',  icon: '⚡', status: '__action__',badgeColor: 'bg-red-500' },
  { id: 'cancelled',   label: 'Cancelled',      icon: '❌', status: 'cancelled', badgeColor: 'bg-red-400' },
  { id: 'all',         label: 'All Orders',     icon: '📋', status: '__all__',   badgeColor: 'bg-gray-400' },
];

export default function AdminOrdersPage() {
  const [orders, setOrders]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);
  const [expanded, setExpanded]   = useState(null);
  const [updating, setUpdating]   = useState(null);
  const [shipModal, setShipModal] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebar] = useState(false);

  async function fetchOrders() {
    setLoading(true);
    try {
      const res  = await fetch('/api/orders?limit=500');
      const data = await res.json();
      if (data.success) setOrders(data.data.orders.map((o) => ({ ...o, _id: o._id || o.id })));
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchOrders(); }, []);

  // Count helpers
  function countForTab(tab) {
    if (tab.status === null) return null;
    if (tab.status === '__all__')    return orders.length;
    if (tab.status === '__cod__')    return orders.filter((o) => o.payment?.method === 'cod' && o.payment?.status !== 'paid' && o.status !== 'cancelled').length;
    if (tab.status === '__action__') return orders.filter((o) => {
      if (o.status === 'cancelled' || o.status === 'delivered') return false;
      const hrs = (Date.now() - new Date(o.createdAt).getTime()) / 3600000;
      return (o.status === 'pending' && hrs > 24) || (o.status === 'processing' && hrs > 48);
    }).length;
    return orders.filter((o) => o.status === tab.status).length;
  }

  // Filter orders for current tab
  const tabOrders = useMemo(() => {
    let list = orders;
    const tab = SIDEBAR_ITEMS.find((t) => t.id === activeTab);
    if (!tab || tab.status === null) return [];
    if (tab.status === '__all__')    list = orders;
    else if (tab.status === '__cod__')    list = orders.filter((o) => o.payment?.method === 'cod' && o.payment?.status !== 'paid' && o.status !== 'cancelled');
    else if (tab.status === '__action__') list = orders.filter((o) => {
      if (o.status === 'cancelled' || o.status === 'delivered') return false;
      const hrs = (Date.now() - new Date(o.createdAt).getTime()) / 3600000;
      return (o.status === 'pending' && hrs > 24) || (o.status === 'processing' && hrs > 48);
    });
    else list = orders.filter((o) => o.status === tab.status);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((o) =>
        o.orderNumber?.toString().includes(q) ||
        o.shippingAddress?.name?.toLowerCase().includes(q) ||
        o.guestEmail?.toLowerCase().includes(q) ||
        o.shippingAddress?.phone?.includes(q)
      );
    }
    return list;
  }, [orders, activeTab, search]);

  // Dashboard stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = orders.filter((o) => o.createdAt?.startsWith(today));
    return {
      total:         orders.length,
      todayCount:    todayOrders.length,
      todayRevenue:  todayOrders.reduce((s, o) => s + (o.total || 0), 0),
      pending:       orders.filter((o) => o.status === 'pending').length,
      confirmed:     orders.filter((o) => o.status === 'confirmed').length,
      processing:    orders.filter((o) => o.status === 'processing').length,
      shipped:       orders.filter((o) => o.status === 'shipped').length,
      delivered:     orders.filter((o) => o.status === 'delivered').length,
      cancelled:     orders.filter((o) => o.status === 'cancelled').length,
      revenue:       orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0),
      codPending:    orders.filter((o) => o.payment?.method === 'cod' && o.payment?.status !== 'paid' && o.status !== 'cancelled').length,
      actionNeeded:  orders.filter((o) => {
        if (o.status === 'cancelled' || o.status === 'delivered') return false;
        const hrs = (Date.now() - new Date(o.createdAt).getTime()) / 3600000;
        return (o.status === 'pending' && hrs > 24) || (o.status === 'processing' && hrs > 48);
      }).length,
    };
  }, [orders]);

  async function quickNext(order) {
    const nextStatus = STATUS_FLOW[order.status]?.next;
    if (!nextStatus) return;
    if (nextStatus === 'shipped') { setShipModal(order); return; }
    setUpdating(order._id);
    const res  = await fetch(`/api/orders/${order._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) });
    const data = await res.json();
    if (data.success) { toast.success(`Order → ${nextStatus}`); fetchOrders(); } else toast.error(data.message);
    setUpdating(null);
  }

  async function updateStatus(orderId, status) {
    if (status === 'shipped') {
      const order = orders.find((o) => o._id === orderId);
      if (order) { setShipModal(order); setSelected(null); return; }
    }
    const res  = await fetch(`/api/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const data = await res.json();
    if (data.success) { toast.success('Order updated'); fetchOrders(); setSelected(null); } else toast.error(data.message);
  }

  function selectTab(id) { setActiveTab(id); setSearch(''); setExpanded(null); setSidebar(false); }

  // ── Sidebar ─────────────────────────────────────────────────
  const SidebarContent = () => (
    <div className="py-2 space-y-0.5">
      {SIDEBAR_ITEMS.map((tab) => {
        const count   = countForTab(tab);
        const isActive = tab.id === activeTab;
        const isAlert  = tab.id === 'action' && count > 0;
        return (
          <button key={tab.id} onClick={() => selectTab(tab.id)}
            className={`w-full flex items-center justify-between px-4 py-3 text-left transition group ${isActive ? 'bg-maroon-950 text-white' : 'hover:bg-gray-50 text-gray-700'}`}>
            <div className="flex items-center gap-3">
              <span className="text-base leading-none">{tab.icon}</span>
              <span className={`text-sm font-semibold ${isActive ? 'text-white' : isAlert ? 'text-red-600' : 'text-gray-700'}`}>{tab.label}</span>
            </div>
            {count !== null && (
              <span className={`text-xs font-bold min-w-[22px] h-5 rounded-full flex items-center justify-center px-1.5 ${
                isActive ? 'bg-white/25 text-white' :
                count === 0 ? 'bg-gray-100 text-gray-400' :
                tab.badgeColor + ' text-white'
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  // ── Dashboard view ──────────────────────────────────────────
  const DashboardView = () => (
    <div className="space-y-5">
      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Revenue',  value: formatPrice(stats.revenue),     color: 'bg-green-50 text-green-700',  badge: null },
          { label: "Today's Orders", value: stats.todayCount,               color: 'bg-blue-50 text-blue-700',    badge: stats.todayCount > 0 ? 'bg-blue-500' : null },
          { label: 'Pending',        value: stats.pending,                  color: 'bg-yellow-50 text-yellow-700',badge: stats.pending > 0 ? 'bg-yellow-500' : null },
          { label: 'Action Needed',  value: stats.actionNeeded,             color: stats.actionNeeded > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500', badge: stats.actionNeeded > 0 ? 'bg-red-500' : null },
        ].map((s) => (
          <div key={s.label} onClick={() => s.label === 'Pending' ? selectTab('new') : s.label === 'Action Needed' ? selectTab('action') : null}
            className={`rounded-xl px-4 py-4 ${s.color} ${s.badge ? 'cursor-pointer hover:opacity-80 transition' : ''}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium opacity-70 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Order pipeline */}
      <div>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Order Pipeline</h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: 'Pending',    count: stats.pending,    color: 'bg-yellow-100 text-yellow-800 border-yellow-200', tab: 'new' },
            { label: 'Confirmed',  count: stats.confirmed,  color: 'bg-blue-100 text-blue-800 border-blue-200',       tab: 'confirmed' },
            { label: 'Processing', count: stats.processing, color: 'bg-orange-100 text-orange-800 border-orange-200', tab: 'processing' },
            { label: 'Shipped',    count: stats.shipped,    color: 'bg-purple-100 text-purple-800 border-purple-200', tab: 'shipped' },
            { label: 'Delivered',  count: stats.delivered,  color: 'bg-green-100 text-green-800 border-green-200',    tab: 'delivered' },
            { label: 'Cancelled',  count: stats.cancelled,  color: 'bg-red-100 text-red-800 border-red-200',          tab: 'cancelled' },
          ].map((s, i) => (
            <button key={s.label} onClick={() => selectTab(s.tab)}
              className={`rounded-xl border p-3 text-center hover:opacity-80 transition ${s.color}`}>
              {i < 5 && <div className="text-xs text-gray-400 mb-1">{'→ '.repeat(Math.min(i, 1))}</div>}
              <p className="text-2xl font-bold">{s.count}</p>
              <p className="text-xs font-semibold mt-0.5">{s.label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Special alerts */}
      <div className="grid sm:grid-cols-3 gap-3">
        <button onClick={() => selectTab('cod')}
          className={`rounded-xl border-2 p-4 text-left hover:opacity-80 transition ${stats.codPending > 0 ? 'border-yellow-300 bg-yellow-50' : 'border-gray-100 bg-gray-50'}`}>
          <p className="text-2xl font-bold text-yellow-700">{stats.codPending}</p>
          <p className="text-sm font-semibold text-yellow-800">💰 COD Pending</p>
          <p className="text-xs text-yellow-600 mt-0.5">Cash collection awaited</p>
        </button>
        <button onClick={() => selectTab('action')}
          className={`rounded-xl border-2 p-4 text-left hover:opacity-80 transition ${stats.actionNeeded > 0 ? 'border-red-300 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
          <p className="text-2xl font-bold text-red-700">{stats.actionNeeded}</p>
          <p className="text-sm font-semibold text-red-800">⚡ Action Needed</p>
          <p className="text-xs text-red-600 mt-0.5">Pending {'>'} 24h or Stuck</p>
        </button>
        <div className="rounded-xl border-2 border-blue-100 bg-blue-50 p-4">
          <p className="text-2xl font-bold text-blue-700">{formatPrice(stats.todayRevenue)}</p>
          <p className="text-sm font-semibold text-blue-800">📅 Today&apos;s Revenue</p>
          <p className="text-xs text-blue-600 mt-0.5">{stats.todayCount} orders today</p>
        </div>
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-700 text-sm">Recent Orders</h3>
          <button onClick={() => selectTab('all')} className="text-xs text-maroon-950 font-semibold hover:underline">View all →</button>
        </div>
        <div className="divide-y divide-gray-50">
          {orders.slice(0, 6).map((o) => (
            <div key={o._id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">#{o.orderNumber} · {o.shippingAddress?.name || o.guestEmail || '—'}</p>
                <p className="text-xs text-gray-400">{o.createdAt ? format(new Date(o.createdAt), 'dd MMM yyyy, hh:mm a') : '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-gray-800">{formatPrice(o.total)}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  o.status === 'delivered' ? 'bg-green-100 text-green-700' :
                  o.status === 'shipped'   ? 'bg-purple-100 text-purple-700' :
                  o.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                  o.status === 'pending'   ? 'bg-yellow-100 text-yellow-700' :
                  'bg-blue-100 text-blue-700'}`}>
                  {o.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Orders Table ────────────────────────────────────────────
  const OrdersTable = () => {
    const activeItem = SIDEBAR_ITEMS.find((t) => t.id === activeTab);
    return (
      <div className="space-y-4">
        {/* Tab header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800">{activeItem?.icon} {activeItem?.label}</h2>
            <p className="text-xs text-gray-400">{tabOrders.length} orders</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => tabOrders.forEach((o) => printLabel(o))} disabled={tabOrders.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition disabled:opacity-40">
              <FiPrinter /> Print All ({tabOrders.length})
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by order #, customer, phone…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-400 bg-white" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><FiX className="text-sm" /></button>}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left w-8" />
                    <th className="px-4 py-3 text-left">Order</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Items</th>
                    <th className="px-4 py-3 text-left">Total</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Payment</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left hidden lg:table-cell">Date</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {tabOrders.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-16 text-center text-gray-400">No orders in this category.</td></tr>
                  ) : tabOrders.map((o) => (
                    <>
                      <tr key={o._id} className={`hover:bg-gray-50/70 transition ${expanded === o._id ? 'bg-gold-50/30' : ''}`}>
                        <td className="pl-4">
                          <button onClick={() => setExpanded(expanded === o._id ? null : o._id)} className="text-gray-400 hover:text-gray-700 transition p-1">
                            {expanded === o._id ? <FiChevronUp className="text-sm" /> : <FiChevronDown className="text-sm" />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-gray-600 font-semibold">#{o.orderNumber}</p>
                          <TrackingInfo order={o} />
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800 text-sm">{o.shippingAddress?.name || o.guestEmail || '—'}</p>
                          {o.shippingAddress?.phone && <p className="text-xs text-gray-400 mt-0.5">{o.shippingAddress.phone}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{o.items?.length || 0} item{(o.items?.length || 0) !== 1 ? 's' : ''}</td>
                        <td className="px-4 py-3 font-bold text-gray-800">{formatPrice(o.total)}</td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${o.payment?.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {o.payment?.method === 'cod' ? 'COD' : 'Online'} · {o.payment?.status || 'pending'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            o.status === 'delivered' ? 'bg-green-100 text-green-700' :
                            o.status === 'shipped'   ? 'bg-purple-100 text-purple-700' :
                            o.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                            o.status === 'pending'   ? 'bg-yellow-100 text-yellow-700' :
                            o.status === 'processing'? 'bg-orange-100 text-orange-700' :
                            'bg-blue-100 text-blue-700'}`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">{o.createdAt ? format(new Date(o.createdAt), 'dd MMM, hh:mm a') : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {STATUS_FLOW[o.status]?.next && (
                              <button onClick={() => quickNext(o)} disabled={updating === o._id}
                                className="text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-md transition disabled:opacity-50 capitalize whitespace-nowrap flex items-center gap-1">
                                {STATUS_FLOW[o.status].next === 'shipped' && <FiTruck className="text-[10px]" />}
                                {updating === o._id ? '…' : `→ ${STATUS_FLOW[o.status].next}`}
                              </button>
                            )}
                            <button onClick={() => setSelected(o)} className="text-xs text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-md transition">Edit</button>
                            <button onClick={() => printLabel(o)} className="text-xs text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-2 py-1 rounded-md transition flex items-center gap-1">
                              <FiPrinter className="text-[11px]" /> Label
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded === o._id && (
                        <tr key={`${o._id}-detail`}>
                          <td colSpan={9} className="bg-amber-50/40 px-6 py-4 border-b border-amber-100">
                            <div className="grid md:grid-cols-3 gap-5">
                              <div>
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Items Ordered</p>
                                <div className="space-y-1.5">
                                  {(o.items || []).map((item, i) => (
                                    <div key={i} className="flex justify-between text-sm">
                                      <span className="text-gray-700 truncate flex-1 pr-2">{item.name} × {item.quantity}</span>
                                      <span className="font-semibold text-gray-900 flex-shrink-0">{formatPrice((item.price || 0) * item.quantity)}</span>
                                    </div>
                                  ))}
                                  <div className="border-t border-amber-200 pt-1.5 flex justify-between text-sm font-bold">
                                    <span>Total</span><span className="text-maroon-950">{formatPrice(o.total)}</span>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Shipping Address</p>
                                {o.shippingAddress ? (
                                  <div className="text-sm text-gray-600 leading-relaxed space-y-0.5">
                                    <p className="font-semibold text-gray-800">{o.shippingAddress.name}</p>
                                    <p>{o.shippingAddress.street}</p>
                                    <p>{o.shippingAddress.city}, {o.shippingAddress.state}</p>
                                    <p>{o.shippingAddress.pincode}</p>
                                    <p className="text-gray-400">{o.shippingAddress.phone}</p>
                                  </div>
                                ) : <p className="text-sm text-gray-400">No address</p>}
                              </div>
                              <div>
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Quick Actions</p>
                                <div className="space-y-2">
                                  <button onClick={() => printLabel(o)} className="flex items-center gap-2 w-full px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition">
                                    <FiPrinter /> Print Delivery Label
                                  </button>
                                  <button onClick={() => setShipModal(o)} className="flex items-center gap-2 w-full px-3 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold rounded-lg transition">
                                    <FiTruck /> {o.trackingNumber ? 'Update Tracking' : 'Add Tracking / Ship'}
                                  </button>
                                  {o.shippingAddress?.phone && (
                                    <a href={`https://wa.me/91${o.shippingAddress.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Hi ${o.shippingAddress.name}! Your Tulsi Bridal order #${o.orderNumber} status: ${o.status}. Thank you!`)}`}
                                      target="_blank" rel="noopener noreferrer"
                                      className="flex items-center gap-2 w-full px-3 py-2 bg-green-500 hover:bg-green-400 text-white text-xs font-semibold rounded-lg transition">
                                      <FiPhone className="text-xs" /> WhatsApp Customer
                                    </a>
                                  )}
                                  <ResendEmailButtons orderId={o._id} />
                                  <div className="text-xs text-gray-500 space-y-1">
                                    <p><span className="font-medium">Payment:</span> {o.payment?.method} — {o.payment?.status}</p>
                                    {o.trackingNumber && <p><span className="font-medium">Tracking:</span> <span className="font-mono">{o.trackingNumber}</span></p>}
                                    {o.courierName && <p><span className="font-medium">Courier:</span> {o.courierName}</p>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex gap-0 lg:gap-5 min-h-[calc(100vh-4rem)]">

      {/* Sidebar — desktop always visible, mobile drawer */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-white shadow-2xl border-r border-gray-100 transform transition-transform duration-300
        lg:relative lg:inset-auto lg:shadow-none lg:transform-none lg:w-56 lg:flex-shrink-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="px-4 py-4 border-b flex items-center justify-between">
          <p className="font-bold text-gray-800 text-sm">Orders</p>
          <button onClick={() => setSidebar(false)} className="text-gray-400 lg:hidden text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto h-full pb-20">
          <SidebarContent />
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebar(false)} />}

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile header */}
        <div className="lg:hidden mb-4 flex items-center gap-3">
          <button onClick={() => setSidebar(true)} className="p-2 bg-white border border-gray-200 rounded-lg text-gray-600 shadow-sm">
            <FiList />
          </button>
          <div>
            <p className="font-bold text-gray-800">{SIDEBAR_ITEMS.find((t) => t.id === activeTab)?.icon} {SIDEBAR_ITEMS.find((t) => t.id === activeTab)?.label}</p>
          </div>
        </div>

        {activeTab === 'dashboard' ? <DashboardView /> : <OrdersTable />}
      </div>

      {/* Status update modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800">Update Order #{selected.orderNumber}</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 transition"><FiX /></button>
            </div>
            <div className="space-y-2">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => updateStatus(selected._id, s)}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold capitalize transition flex items-center justify-between px-4 ${selected.status === s ? 'bg-maroon-950 text-white' : 'bg-gray-100 text-gray-700 hover:bg-maroon-50 hover:text-maroon-950'}`}>
                  <span className="flex items-center gap-2">{s === 'shipped' && <FiTruck className="text-sm" />}{s}</span>
                  {selected.status === s && <span className="text-xs opacity-60">Current</span>}
                </button>
              ))}
            </div>
            <button onClick={() => setSelected(null)} className="w-full mt-3 py-2.5 border border-gray-200 text-gray-500 text-sm rounded-xl hover:bg-gray-50 transition">Cancel</button>
          </div>
        </div>
      )}

      {shipModal && (
        <ShipmentModal order={shipModal} onClose={() => setShipModal(null)} onShipped={fetchOrders} />
      )}
    </div>
  );
}
