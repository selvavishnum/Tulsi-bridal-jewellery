'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  FiRefreshCw, FiTrash2, FiPackage, FiDollarSign,
  FiChevronDown, FiChevronUp, FiCheck,
} from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { formatPrice } from '@/lib/utils';
import toast from 'react-hot-toast';

function safeDate(str) {
  if (!str) return '—';
  try { return new Date(str).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return str; }
}

const RETURN_STATUSES = ['requested', 'under_review', 'approved', 'rejected', 'product_received', 'refund_processed'];
const REFUND_STATUSES = ['pending', 'approved', 'processed', 'rejected'];

const RETURN_BADGE = {
  requested:        'bg-blue-100 text-blue-700',
  under_review:     'bg-yellow-100 text-yellow-700',
  approved:         'bg-green-100 text-green-700',
  rejected:         'bg-red-100 text-red-700',
  product_received: 'bg-purple-100 text-purple-700',
  refund_processed: 'bg-emerald-100 text-emerald-700',
};

const REFUND_BADGE = {
  pending:   'bg-gray-100 text-gray-600',
  approved:  'bg-green-100 text-green-700',
  processed: 'bg-emerald-100 text-emerald-700',
  rejected:  'bg-red-100 text-red-700',
};

const REASON_LABEL = {
  wrong_item:     'Wrong Item Received',
  damaged:        'Damaged / Defective',
  quality_issue:  'Quality Issue',
  not_as_shown:   'Not as Shown Online',
  size_issue:     'Size / Fit Issue',
  other:          'Other',
};

const TABS = ['all', 'requested', 'under_review', 'approved', 'product_received', 'refund_processed', 'rejected'];

function ReturnCard({ req, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(req.adminNote || '');
  const [saving, setSaving] = useState(false);

  async function save(updates) {
    setSaving(true);
    await onUpdate(req.id, updates);
    setSaving(false);
  }

  async function saveNote() {
    if (note === (req.adminNote || '')) return;
    await save({ adminNote: note });
  }

  const returnBadge = RETURN_BADGE[req.returnStatus] || RETURN_BADGE.requested;
  const refundBadge = REFUND_BADGE[req.refundStatus] || REFUND_BADGE.pending;

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-start gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Left: customer + order info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-800 text-sm">{req.customerName || '—'}</span>
            <span className="text-xs text-gray-400">{req.customerEmail}</span>
            {req.customerPhone && <span className="text-xs text-gray-400">{req.customerPhone}</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              #{req.orderNumber}
            </span>
            <span className="text-xs text-gray-400">{safeDate(req.createdAt)}</span>
            <span className="text-xs text-gray-500 font-medium">
              {REASON_LABEL[req.reason] || req.reason}
            </span>
          </div>
        </div>

        {/* Right: badges + amount + expand */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${returnBadge}`}>
            {req.returnStatus?.replace(/_/g, ' ')}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${refundBadge}`}>
            ₹ {refundBadge}
          </span>
          <span className="text-sm font-bold text-maroon-950">{formatPrice(req.refundAmount || 0)}</span>
          {expanded ? <FiChevronUp className="text-gray-400" /> : <FiChevronDown className="text-gray-400" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">

          {/* Items to return */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <FiPackage className="text-amber-500" /> Items to Return
            </p>
            <div className="space-y-2">
              {(req.items || []).map((item, i) => (
                <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-lg p-2.5">
                  {item.image && (
                    <img src={item.image} alt={item.name} className="w-10 h-10 object-cover rounded-lg flex-shrink-0 bg-gray-200" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">Qty: {item.quantity || 1}</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-700">{formatPrice((item.price || 0) * (item.quantity || 1))}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Description */}
          {req.description && (
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-500 mb-1">Customer's Description</p>
              <p className="text-sm text-gray-700">{req.description}</p>
            </div>
          )}

          {/* Order payment info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">Order Total</p>
              <p className="font-bold text-gray-800 mt-0.5">{formatPrice(req.orderTotal || 0)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">Refund Amount</p>
              <p className="font-bold text-maroon-950 mt-0.5">{formatPrice(req.refundAmount || 0)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">Payment Mode</p>
              <p className="font-bold text-gray-800 mt-0.5 capitalize">{req.paymentMethod || '—'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">Payment Status</p>
              <p className="font-bold text-gray-800 mt-0.5 capitalize">{req.paymentStatus || '—'}</p>
            </div>
          </div>

          {/* Status controls */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                <FiPackage className="inline mr-1" />Return Status
              </label>
              <select
                value={req.returnStatus || 'requested'}
                onChange={(e) => save({ returnStatus: e.target.value })}
                disabled={saving}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 capitalize"
              >
                {RETURN_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                <FiDollarSign className="inline mr-1" />Refund Status
              </label>
              <select
                value={req.refundStatus || 'pending'}
                onChange={(e) => save({ refundStatus: e.target.value })}
                disabled={saving}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 capitalize"
              >
                {REFUND_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Admin note */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Admin Note</label>
            <div className="flex gap-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={saveNote}
                rows={2}
                placeholder="Internal note (not visible to customer)..."
                className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
              <button
                onClick={saveNote}
                disabled={saving}
                className="self-end px-3 py-2 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-400 disabled:opacity-50 transition flex items-center gap-1"
              >
                {saving ? '...' : <><FiCheck /> Save</>}
              </button>
            </div>
          </div>

          {/* Delete */}
          <div className="flex justify-end pt-1">
            <button
              onClick={() => onDelete(req.id)}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition"
            >
              <FiTrash2 /> Delete Request
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReturnsAdminPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');

  function fetchRequests() {
    setLoading(true);
    fetch('/api/admin/returns')
      .then((r) => r.json())
      .then((d) => { if (d.success) setRequests(d.data); })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchRequests(); }, []);

  const stats = useMemo(() => ({
    total:    requests.length,
    requested: requests.filter((r) => r.returnStatus === 'requested').length,
    approved:  requests.filter((r) => r.returnStatus === 'approved').length,
    processed: requests.filter((r) => r.refundStatus === 'processed').length,
    rejected:  requests.filter((r) => r.returnStatus === 'rejected').length,
  }), [requests]);

  const filtered = useMemo(() => {
    if (tab === 'all') return requests;
    return requests.filter((r) => r.returnStatus === tab);
  }, [requests, tab]);

  async function handleUpdate(id, updates) {
    try {
      const res = await fetch('/api/admin/returns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      });
      const d = await res.json();
      if (d.success) {
        setRequests((prev) => prev.map((r) => r.id === id ? { ...r, ...updates } : r));
        toast.success('Updated');
      } else { toast.error(d.message); }
    } catch { toast.error('Network error'); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this return request?')) return;
    try {
      const res = await fetch(`/api/admin/returns?id=${id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) { setRequests((prev) => prev.filter((r) => r.id !== id)); toast.success('Deleted'); }
      else toast.error(d.message);
    } catch { toast.error('Network error'); }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Returns & Refunds</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track customer return requests and process refunds</p>
        </div>
        <button
          onClick={fetchRequests}
          className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition"
        >
          <FiRefreshCw className={`text-sm ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total',     value: stats.total,     color: 'bg-blue-50 text-blue-700' },
          { label: 'New',       value: stats.requested,  color: 'bg-amber-50 text-amber-700' },
          { label: 'Approved',  value: stats.approved,   color: 'bg-green-50 text-green-700' },
          { label: 'Refunded',  value: stats.processed,  color: 'bg-emerald-50 text-emerald-700' },
          { label: 'Rejected',  value: stats.rejected,   color: 'bg-red-50 text-red-700' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl px-4 py-3 ${s.color}`}>
            <p className="text-2xl font-bold leading-none">{s.value}</p>
            <p className="text-xs font-medium opacity-70 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
              tab === t
                ? 'bg-maroon-950 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm px-6 py-16 text-center">
          <FiPackage className="text-4xl text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No return requests</p>
          <p className="text-gray-400 text-sm mt-1">
            {requests.length === 0
              ? 'Customers can request returns from their order page within 3 days of delivery.'
              : 'No requests match this filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => (
            <ReturnCard key={req.id} req={req} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
