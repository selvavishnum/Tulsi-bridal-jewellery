'use client';
import { useEffect, useState } from 'react';
import { FiExternalLink } from 'react-icons/fi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { formatPrice } from '@/lib/utils';

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');

const STATUS_STYLE = {
  pending: 'bg-stone-100 text-stone-600',
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-indigo-50 text-indigo-700',
  shipped: 'bg-purple-50 text-purple-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};

export default function VendorOrdersPage() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/vendor/orders').then((r) => r.json())
      .then((d) => (d.success ? setOrders(d.data) : setError(d.message)))
      .catch(() => setError('Could not load orders. Check your connection and refresh.'));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!orders) return <div className="py-20 flex justify-center"><LoadingSpinner size="lg" /></div>;
  if (orders.length === 0) return <p className="text-sm text-stone-500">No orders with your pieces yet.</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-500">Tulsi packs and ships every order from its own warehouse. You&apos;ll see the tracking link here once a parcel is dispatched.</p>
      {orders.map((o) => (
        <article key={o.id} className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-sm font-semibold text-stone-800">{o.orderNumber}</p>
              <p className="text-xs text-stone-500">{date(o.createdAt)} · {o.customer.firstName || 'Customer'}{o.customer.city ? `, ${o.customer.city}` : ''} · {o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'}</p>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLE[o.status] || 'bg-stone-100'}`}>{o.status}</span>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {o.items.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-3">
                <span className="text-stone-700">{i.name} × {i.quantity}</span>
                <span className="tabular-nums text-stone-600">{formatPrice(i.price * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 pt-3 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-stone-500">Your items: <span className="font-semibold text-stone-800 tabular-nums">{formatPrice(o.itemsTotal)}</span></span>
            {o.trackingNumber ? (
              o.trackingUrl ? (
                <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-wine-700 font-semibold hover:underline">
                  Track {o.courierName ? `(${o.courierName})` : ''} <FiExternalLink />
                </a>
              ) : (
                <span className="text-stone-600">{o.courierName} · <span className="font-mono">{o.trackingNumber}</span></span>
              )
            ) : (
              <span className="text-stone-400 text-xs">Not dispatched yet</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
