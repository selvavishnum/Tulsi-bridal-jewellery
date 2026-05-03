'use client';

import { useState, useEffect } from 'react';
import { formatPrice } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  FiChevronDown, FiChevronUp, FiPhone, FiTruck, FiPackage,
  FiCalendar, FiMail, FiSearch, FiX,
} from 'react-icons/fi';

const STATUS_BADGE = {
  pending: 'warning', confirmed: 'success', active: 'gold',
  returned: 'default', cancelled: 'danger', overdue: 'danger',
};
const STATUSES = ['pending', 'confirmed', 'active', 'returned', 'cancelled', 'overdue'];

const COURIERS = [
  'Shiprocket', 'BlueDart', 'Delhivery', 'DTDC', 'Ecom Express',
  'FedEx', 'India Post', 'XpressBees', 'Shadowfax', 'Other',
];

/* ── Resend Email Buttons ── */
function ResendEmailButtons({ rentalId }) {
  const [state, setState] = useState({});

  async function resend(type) {
    setState((s) => ({ ...s, [type]: 'loading' }));
    try {
      const res  = await fetch('/api/admin/resend-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId, type }),
      });
      const data = await res.json();
      if (data.success) { setState((s) => ({ ...s, [type]: 'ok' })); toast.success(data.message); }
      else              { setState((s) => ({ ...s, [type]: 'err' })); toast.error(data.message || 'Failed'); }
    } catch (e) { setState((s) => ({ ...s, [type]: 'err' })); toast.error(e.message); }
  }

  const cls = (t) =>
    `flex items-center gap-1.5 w-full px-3 py-2 text-xs font-semibold rounded-lg transition ${
      state[t] === 'ok'      ? 'bg-green-100 text-green-700 border border-green-200' :
      state[t] === 'err'     ? 'bg-red-100 text-red-700 border border-red-200' :
      state[t] === 'loading' ? 'bg-gray-100 text-gray-400 cursor-wait' :
      t === 'admin'          ? 'bg-wine-50 text-wine-700 border border-wine-200 hover:bg-wine-100' :
                               'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
    }`;

  return (
    <>
      <button onClick={() => resend('admin')} disabled={state.admin === 'loading'} className={cls('admin')}>
        <FiMail className="text-xs" />
        {state.admin === 'ok' ? 'Admin mail sent ✓' : state.admin === 'err' ? 'Failed' : 'Resend Admin Email'}
      </button>
      <button onClick={() => resend('customer')} disabled={state.customer === 'loading'} className={cls('customer')}>
        <FiMail className="text-xs" />
        {state.customer === 'ok' ? 'Customer mail sent ✓' : state.customer === 'err' ? 'Failed' : 'Resend Customer Email'}
      </button>
    </>
  );
}

/* ── Shipment / Tracking Panel ── */
function ShipmentPanel({ rental, onSaved }) {
  const [trackingNumber, setTrackingNumber] = useState(rental.trackingNumber || '');
  const [courierName, setCourierName]       = useState(rental.courierName    || '');
  const [saving, setSaving]                 = useState(false);

  async function save() {
    if (!trackingNumber.trim()) { toast.error('Enter tracking number'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/rentals/${rental._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: trackingNumber.trim(), courierName }),
      });
      const data = await res.json();
      if (data.success) { toast.success('Tracking saved'); onSaved(); }
      else toast.error(data.message || 'Failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
        <FiTruck className="inline mr-1" /> Shipment / Tracking
      </p>
      <select value={courierName} onChange={(e) => setCourierName(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-gold-400">
        <option value="">Select Courier</option>
        {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input
        value={trackingNumber}
        onChange={(e) => setTrackingNumber(e.target.value)}
        placeholder="Tracking number"
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-gold-400"
      />
      <button onClick={save} disabled={saving}
        className="flex items-center gap-1.5 w-full px-3 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold rounded-lg transition disabled:opacity-60">
        <FiTruck className="text-xs" />
        {saving ? 'Saving…' : rental.trackingNumber ? 'Update Tracking' : 'Add Tracking'}
      </button>
      {rental.trackingNumber && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
          <p><span className="font-medium">Current:</span> <span className="font-mono">{rental.trackingNumber}</span></p>
          {rental.courierName && <p><span className="font-medium">Courier:</span> {rental.courierName}</p>}
        </div>
      )}
    </div>
  );
}

export default function AdminRentalsPage() {
  const [rentals, setRentals]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('');
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState(null);
  const [selected, setSelected] = useState(null);

  async function fetchRentals() {
    setLoading(true);
    try {
      const res  = await fetch(`/api/rentals?limit=200${filter ? `&status=${filter}` : ''}`);
      const data = await res.json();
      if (data.success) setRentals(data.data.rentals);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchRentals(); }, [filter]);

  async function updateStatus(rentalId, status) {
    const res  = await fetch(`/api/rentals/${rentalId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (data.success) { toast.success('Status updated'); fetchRentals(); setSelected(null); }
    else toast.error(data.message);
  }

  const filtered = rentals.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.rentalNumber?.toLowerCase().includes(q) ||
      r.productName?.toLowerCase().includes(q) ||
      r.customerDetails?.name?.toLowerCase().includes(q) ||
      r.customerDetails?.phone?.includes(q) ||
      (r.guestEmail || r.customerDetails?.email || '').toLowerCase().includes(q)
    );
  });

  const stats = {
    total:     rentals.length,
    pending:   rentals.filter((r) => r.status === 'pending').length,
    active:    rentals.filter((r) => r.status === 'active').length,
    overdue:   rentals.filter((r) => r.status === 'overdue').length,
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FiCalendar className="text-gold-600" /> Rental Bookings
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage all jewellery rental orders</p>
        </div>
        <button onClick={fetchRentals} className="px-4 py-2 bg-white border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition">
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total,   color: 'bg-gray-50 border-gray-200' },
          { label: 'Pending', value: stats.pending, color: 'bg-amber-50 border-amber-100' },
          { label: 'Active',  value: stats.active,  color: 'bg-green-50 border-green-100' },
          { label: 'Overdue', value: stats.overdue, color: 'bg-red-50 border-red-100' },
        ].map((s) => (
          <div key={s.label} className={`${s.color} border rounded-xl p-3 text-center`}>
            <p className="text-2xl font-bold text-gray-800">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by rental #, product, customer, phone…"
            className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <FiX className="text-sm" />
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilter('')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${!filter ? 'bg-maroon-950 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>All</button>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition ${filter === s ? 'bg-maroon-950 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>{s}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-100">
                <tr>
                  <th className="w-8 px-3 py-3" />
                  <th className="px-4 py-3 text-left">Booking #</th>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Dates</th>
                  <th className="px-4 py-3 text-left">Total</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No rentals found</td></tr>
                ) : filtered.map((r) => (
                  <>
                    <tr key={r._id} className={`hover:bg-gray-50/70 transition ${expanded === r._id ? 'bg-gold-50/20' : ''}`}>
                      <td className="px-3 py-3">
                        <button onClick={() => setExpanded(expanded === r._id ? null : r._id)} className="text-gray-400 hover:text-gray-700 p-1">
                          {expanded === r._id ? <FiChevronUp className="text-sm" /> : <FiChevronDown className="text-sm" />}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-gray-600">#{r.rentalNumber}</p>
                        {r.trackingNumber && (
                          <p className="text-[10px] text-indigo-500 font-mono mt-0.5">{r.trackingNumber}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-36 truncate font-medium text-gray-700">{r.productName}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{r.customerDetails?.name || '—'}</p>
                        <p className="text-xs text-gray-400">{r.customerDetails?.phone || ''}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        <p>{r.rentalStartDate} →</p>
                        <p>{r.rentalEndDate}</p>
                        <p className="text-gray-400">{r.rentalDays}d</p>
                      </td>
                      <td className="px-4 py-3 font-bold text-gray-800">{formatPrice(r.total)}</td>
                      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[r.status] || 'default'}>{r.status}</Badge></td>
                      <td className="px-4 py-3">
                        <button onClick={() => setSelected(r)}
                          className="px-3 py-1.5 bg-maroon-950 text-white text-xs font-semibold rounded-lg hover:bg-maroon-900 transition">
                          Update
                        </button>
                      </td>
                    </tr>

                    {/* ── Expanded row ── */}
                    {expanded === r._id && (
                      <tr key={`${r._id}-detail`}>
                        <td colSpan={8} className="bg-amber-50/40 px-6 py-5 border-b border-amber-100">
                          <div className="grid md:grid-cols-4 gap-5">

                            {/* Booking details */}
                            <div>
                              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Booking Details</p>
                              <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Rental cost</span>
                                  <span className="font-medium">{formatPrice(r.totalRentalCost)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Security dep.</span>
                                  <span className="font-medium">{formatPrice(r.securityDeposit)}</span>
                                </div>
                                {r.deliveryCharge > 0 && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Delivery</span>
                                    <span className="font-medium">{formatPrice(r.deliveryCharge)}</span>
                                  </div>
                                )}
                                {r.returnCharge > 0 && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Return</span>
                                    <span className="font-medium">{formatPrice(r.returnCharge)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between border-t border-amber-200 pt-1 font-bold">
                                  <span>Total</span>
                                  <span className="text-maroon-950">{formatPrice(r.total)}</span>
                                </div>
                                <p className="text-xs text-gray-400 pt-1">
                                  Payment: {r.payment?.method} — <span className={r.payment?.status === 'paid' ? 'text-green-600' : 'text-amber-600'}>{r.payment?.status}</span>
                                </p>
                                <p className="text-xs text-gray-400">
                                  Delivery: <span className="capitalize">{r.delivery?.method}</span> | Return: <span className="capitalize">{r.returnMethod?.method}</span>
                                </p>
                              </div>
                            </div>

                            {/* Customer info */}
                            <div>
                              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Customer</p>
                              <div className="text-sm text-gray-600 space-y-1">
                                <p className="font-semibold text-gray-800">{r.customerDetails?.name || '—'}</p>
                                <p className="flex items-center gap-1.5"><FiPhone className="text-xs text-gray-400" /> {r.customerDetails?.phone || '—'}</p>
                                <p className="flex items-center gap-1.5 text-xs"><FiMail className="text-gray-400" /> {r.guestEmail || r.customerDetails?.email || '—'}</p>
                                {r.customerDetails?.address && (
                                  <p className="text-xs text-gray-400 mt-1">
                                    {r.customerDetails.address}, {r.customerDetails.city}, {r.customerDetails.state} {r.customerDetails.pincode}
                                  </p>
                                )}
                                {r.customerDetails?.phone && (
                                  <a href={`https://wa.me/91${r.customerDetails.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${r.customerDetails.name}! Your Tulsi Bridal rental #${r.rentalNumber} status: ${r.status}.`)}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-green-500 hover:bg-green-400 text-white text-xs font-semibold rounded-lg transition">
                                    <FiPhone className="text-[10px]" /> WhatsApp Customer
                                  </a>
                                )}
                              </div>
                            </div>

                            {/* Shipment tracking */}
                            <div>
                              <ShipmentPanel rental={r} onSaved={fetchRentals} />
                            </div>

                            {/* Email resend */}
                            <div>
                              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Email Notifications</p>
                              <div className="space-y-2">
                                <ResendEmailButtons rentalId={r._id} />
                                <div className="text-xs text-gray-400 space-y-0.5 pt-1">
                                  <p>Booking: {r.createdAt ? format(new Date(r.createdAt), 'dd MMM yyyy, h:mm a') : '—'}</p>
                                  {r.notes && <p>Notes: {r.notes}</p>}
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

      {/* Status update modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="font-bold text-gray-800 mb-1">Update Status</h3>
            <p className="text-xs text-gray-400 mb-4">Rental #{selected.rentalNumber}</p>
            <div className="space-y-2">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => updateStatus(selected._id, s)}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold capitalize transition ${selected.status === s ? 'bg-maroon-950 text-white' : 'bg-gray-100 text-gray-700 hover:bg-maroon-50 hover:text-maroon-950'}`}>
                  {s === selected.status ? `✓ ${s} (current)` : s}
                </button>
              ))}
            </div>
            <button onClick={() => setSelected(null)} className="w-full mt-3 py-2.5 border border-gray-200 text-gray-500 text-sm rounded-lg hover:bg-gray-50 transition">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
