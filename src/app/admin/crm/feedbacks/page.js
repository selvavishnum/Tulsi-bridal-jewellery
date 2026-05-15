'use client';

import { useState, useEffect, useMemo } from 'react';
import { FiStar, FiTrash2, FiRefreshCw } from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';

function safeFormat(str) {
  if (!str) return '—';
  try { return format(parseISO(str), 'dd MMM yyyy'); } catch { return str; }
}

function StarDisplay({ rating }) {
  const r = Math.round(rating || 0);
  return (
    <span className="text-lg leading-none">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < r ? 'text-amber-400' : 'text-gray-200'}>★</span>
      ))}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending:  'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-600',
  };
  const cls = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${cls}`}>
      {status || 'pending'}
    </span>
  );
}

const TABS = [
  { key: 'all',      label: 'All' },
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

export default function FeedbacksPage() {
  const [reviews, setReviews]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState('all');
  const [updating, setUpdating] = useState({});

  function fetchReviews() {
    setLoading(true);
    fetch('/api/admin/feedbacks')
      .then((r) => r.json())
      .then((d) => { if (d.success) setReviews(d.data); })
      .catch(() => toast.error('Failed to load reviews'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchReviews(); }, []);

  const stats = useMemo(() => {
    const total    = reviews.length;
    const avgRaw   = total ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / total : 0;
    const avg      = avgRaw.toFixed(1);
    const pending  = reviews.filter((r) => (r.status || 'pending') === 'pending').length;
    const approved = reviews.filter((r) => r.status === 'approved').length;
    return { total, avg, pending, approved };
  }, [reviews]);

  const filtered = useMemo(() => {
    if (tab === 'all') return reviews;
    return reviews.filter((r) => (r.status || 'pending') === tab);
  }, [reviews, tab]);

  async function updateStatus(id, status) {
    setUpdating((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch('/api/admin/feedbacks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const d = await res.json();
      if (d.success) {
        setReviews((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
        toast.success(`Review ${status}`);
      } else {
        toast.error(d.message || 'Failed to update');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setUpdating((p) => ({ ...p, [id]: false }));
    }
  }

  async function deleteReview(id) {
    if (!confirm('Delete this review?')) return;
    try {
      const res = await fetch(`/api/admin/feedbacks?id=${id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) {
        setReviews((prev) => prev.filter((r) => r.id !== id));
        toast.success('Review deleted');
      } else {
        toast.error(d.message || 'Failed to delete');
      }
    } catch {
      toast.error('Network error');
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Feedbacks & Ratings</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage customer product reviews</p>
        </div>
        <button
          onClick={fetchReviews}
          className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition"
        >
          <FiRefreshCw className={`text-sm ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Reviews',   value: stats.total,    color: 'bg-blue-50 text-blue-700' },
          { label: 'Average Rating',  value: stats.avg,      color: 'bg-amber-50 text-amber-700' },
          { label: 'Pending',         value: stats.pending,  color: 'bg-yellow-50 text-yellow-700' },
          { label: 'Approved',        value: stats.approved, color: 'bg-green-50 text-green-700' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl px-4 py-3 flex items-center gap-3 ${s.color}`}>
            <FiStar className="text-xl flex-shrink-0 opacity-60" />
            <div>
              <p className="text-2xl font-bold leading-none">{s.value}</p>
              <p className="text-xs font-medium opacity-70 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              tab === t.key
                ? 'bg-amber-500 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm px-6 py-16 text-center">
          <FiStar className="text-4xl text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No reviews yet.</p>
          <p className="text-gray-400 text-sm mt-1">Reviews submitted by customers will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((review) => {
            const id         = review.id;
            const busy       = updating[id];
            const status     = review.status || 'pending';
            const name       = review.userName || review.customerName || 'Anonymous';
            const text       = review.comment || review.review || '';
            const product    = review.productName || '';
            const dateStr    = safeFormat(review.createdAt);

            return (
              <div key={id} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
                {/* Top row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <StarDisplay rating={review.rating} />
                    <p className="font-semibold text-gray-800 text-sm">{name}</p>
                    <p className="text-xs text-gray-400">{dateStr}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <StatusBadge status={status} />
                    {product && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 max-w-[140px] truncate">
                        {product}
                      </span>
                    )}
                  </div>
                </div>

                {/* Review text */}
                {text && <p className="text-sm text-gray-600 leading-relaxed">{text}</p>}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
                  <button
                    disabled={busy || status === 'approved'}
                    onClick={() => updateStatus(id, 'approved')}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy || status === 'rejected'}
                    onClick={() => updateStatus(id, 'rejected')}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Reject
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => deleteReview(id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-40"
                    title="Delete"
                  >
                    <FiTrash2 className="text-sm" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
