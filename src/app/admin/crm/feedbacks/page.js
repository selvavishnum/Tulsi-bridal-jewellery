'use client';

import { useState, useEffect, useMemo } from 'react';
import { FiStar, FiRefreshCw, FiX, FiUser, FiPhone, FiMail, FiExternalLink, FiShoppingBag, FiPackage } from 'react-icons/fi';
import Image from 'next/image';
import Link from 'next/link';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { formatPrice } from '@/lib/utils';

function safeFormat(str) {
  if (!str) return '—';
  try { return format(parseISO(str), 'dd MMM yyyy'); } catch { return str; }
}
function safeAgo(str) {
  if (!str) return '';
  try { return formatDistanceToNow(parseISO(str), { addSuffix: true }); } catch { return ''; }
}

function StarDisplay({ rating }) {
  const r = Math.round(rating || 0);
  return (
    <span className="text-base leading-none">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < r ? 'text-amber-400' : 'text-gray-200'}>★</span>
      ))}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-600' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${map[status] || map.pending}`}>
      {status || 'pending'}
    </span>
  );
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

export default function FeedbacksPage() {
  const [reviews, setReviews]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState('all');
  const [updating, setUpdating]       = useState({});
  const [customer, setCustomer]       = useState(null);   // selected customer for panel
  const [custLoading, setCustLoading] = useState(false);
  const [panelOpen, setPanelOpen]     = useState(false);

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
    const pending  = reviews.filter((r) => (r.status || 'pending') === 'pending').length;
    const approved = reviews.filter((r) => r.status === 'approved').length;
    return { total, avg: avgRaw.toFixed(1), pending, approved };
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
      } else toast.error(d.message || 'Failed');
    } catch { toast.error('Network error'); }
    finally { setUpdating((p) => ({ ...p, [id]: false })); }
  }


  async function openCustomer(userId, reviewerName, reviewerEmail) {
    setPanelOpen(true);
    setCustomer(null);
    if (!userId) {
      // Guest — only name/email available
      setCustomer({ name: reviewerName || 'Anonymous', email: reviewerEmail || null, guest: true });
      return;
    }
    setCustLoading(true);
    try {
      const res = await fetch(`/api/admin/customers/${userId}`);
      const d = await res.json();
      if (d.success) setCustomer(d.user);
      else setCustomer({ name: reviewerName || 'Unknown', guest: false });
    } catch { setCustomer({ name: reviewerName || 'Unknown', guest: false }); }
    finally { setCustLoading(false); }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Feedbacks & Ratings</h1>
          <p className="text-sm text-gray-400 mt-0.5">All reviews are always visible. Approve = show ✓ Verified Purchase badge. Reject = no badge.</p>
        </div>
        <button onClick={fetchReviews} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition">
          <FiRefreshCw className={`text-sm ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Reviews',  value: stats.total,    color: 'bg-blue-50 text-blue-700' },
          { label: 'Average Rating', value: stats.avg,      color: 'bg-amber-50 text-amber-700' },
          { label: 'Pending',        value: stats.pending,  color: 'bg-yellow-50 text-yellow-700' },
          { label: 'Approved',       value: stats.approved, color: 'bg-green-50 text-green-700' },
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
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${tab === t.key ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Review Cards */}
      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm px-6 py-16 text-center">
          <FiStar className="text-4xl text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No reviews here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((review) => {
            const id      = review.id;
            const busy    = updating[id];
            const status  = review.status || 'pending';
            const name    = review.reviewerName || review.userName || review.customerName || 'Anonymous';
            const text    = review.comment || review.review || '';
            const product = review.productName || '';

            return (
              <div key={id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Product banner */}
                {(review.productImage || product) && (
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    {review.productImage && (
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200">
                        <Image src={review.productImage} alt={product} fill className="object-cover" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-700 truncate">{product}</p>
                      {review.productPrice && (
                        <p className="text-xs text-amber-600 font-medium">{formatPrice(review.productPrice)}</p>
                      )}
                    </div>
                    {review.productSlug && (
                      <Link href={`/product/${review.productId}`} target="_blank"
                        className="text-gray-400 hover:text-amber-600 transition flex-shrink-0" title="View product">
                        <FiExternalLink className="text-sm" />
                      </Link>
                    )}
                  </div>
                )}

                <div className="p-4 space-y-3">
                  {/* Rating + status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <StarDisplay rating={review.rating} />
                      {/* Clickable customer name */}
                      <button
                        onClick={() => openCustomer(review.userId, name, review.reviewerEmail)}
                        className="font-semibold text-gray-800 text-sm hover:text-amber-600 transition text-left flex items-center gap-1"
                      >
                        <FiUser className="text-xs opacity-50" />
                        {name}
                        {review.verified && <span className="text-[10px] text-green-500 font-semibold ml-1">✓ Verified</span>}
                      </button>
                      <p className="text-xs text-gray-400">{safeFormat(review.createdAt)} · {safeAgo(review.createdAt)}</p>
                    </div>
                    <StatusBadge status={status} />
                  </div>

                  {/* Review text */}
                  {text && <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 rounded-lg px-3 py-2">"{text}"</p>}

                  {/* Actions — controls Verified Purchase badge only, review always stays public */}
                  <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
                    <button disabled={busy || status === 'approved'} onClick={() => updateStatus(id, 'approved')}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed transition">
                      ✓ Verified Purchase
                    </button>
                    <button disabled={busy || status === 'rejected'} onClick={() => updateStatus(id, 'rejected')}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition">
                      ✗ Remove Badge
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Customer Details Panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPanelOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl flex flex-col">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800 text-base">Customer Details</h2>
              <button onClick={() => setPanelOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition">
                <FiX className="text-lg" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {custLoading ? (
                <div className="flex justify-center py-10"><LoadingSpinner size="md" /></div>
              ) : !customer ? (
                <p className="text-gray-400 text-sm text-center py-10">Could not load customer details.</p>
              ) : (
                <div className="space-y-5">
                  {/* Avatar + name */}
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center text-2xl font-bold text-amber-700">
                      {(customer.name || '?')[0].toUpperCase()}
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-gray-800 text-lg">{customer.name || 'Anonymous'}</p>
                      {customer.guest && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Guest</span>}
                    </div>
                  </div>

                  {/* Contact info */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
                    {customer.email && (
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <FiMail className="text-amber-500 flex-shrink-0" />
                        <span className="truncate">{customer.email}</span>
                      </div>
                    )}
                    {customer.phone && (
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <FiPhone className="text-amber-500 flex-shrink-0" />
                        <span>{customer.phone}</span>
                      </div>
                    )}
                    {customer.city && (
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="text-amber-500 flex-shrink-0">📍</span>
                        <span>{customer.city}</span>
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  {!customer.guest && (
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Total Orders', value: customer.totalOrders ?? 0, icon: FiShoppingBag },
                        { label: 'Total Spent',  value: customer.totalSpent != null ? formatPrice(customer.totalSpent) : '₹0', icon: FiPackage },
                        { label: 'Login Count',  value: customer.loginCount ?? 0, icon: FiUser },
                        { label: 'Loyalty Pts',  value: customer.loyaltyPoints ?? 0, icon: FiStar },
                      ].map((s) => (
                        <div key={s.label} className="bg-amber-50 rounded-xl p-3 text-center">
                          <p className="font-bold text-amber-800 text-lg leading-none">{s.value}</p>
                          <p className="text-xs text-amber-600 mt-1">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Dates */}
                  {!customer.guest && (
                    <div className="space-y-1.5 text-sm">
                      {customer.createdAt && (
                        <div className="flex justify-between text-gray-600">
                          <span className="text-gray-400">Joined</span>
                          <span className="font-medium">{safeFormat(customer.createdAt)}</span>
                        </div>
                      )}
                      {customer.lastSeen && (
                        <div className="flex justify-between text-gray-600">
                          <span className="text-gray-400">Last Seen</span>
                          <span className="font-medium">{safeAgo(customer.lastSeen)}</span>
                        </div>
                      )}
                      {customer.lastSeenProduct && (
                        <div className="flex justify-between text-gray-600">
                          <span className="text-gray-400">Last Viewed</span>
                          <span className="font-medium truncate max-w-[160px]">{customer.lastSeenProduct.name}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* View full profile link */}
                  {!customer.guest && customer.id && (
                    <Link href={`/admin/customers/${customer.id}`}
                      className="flex items-center justify-center gap-2 w-full py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-xl hover:bg-amber-600 transition">
                      <FiExternalLink className="text-sm" /> Full Profile & Analytics
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
