'use client';
import { useCallback, useEffect, useState } from 'react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export const inrPaise = (paise) => ((paise || 0) / 100 + 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const inr = (rupees) => (Number(rupees) || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');

export const PRODUCT_STATUS = {
  live: ['Live', 'bg-green-50 text-green-700'],
  out_of_stock: ['Out of stock', 'bg-amber-50 text-amber-700'],
  in_review: ['In review', 'bg-blue-50 text-blue-700'],
  hidden: ['Hidden by Tulsi', 'bg-stone-100 text-stone-500'],
};

export function Pill({ className = '', children }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${className}`}>{children}</span>;
}

export function Card({ title, action, children, className = '' }) {
  return (
    <section className={`bg-white rounded-xl border border-stone-200 p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          {title && <h2 className="font-semibold text-stone-800">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'text-stone-900' }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <p className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-stone-500 mt-1">{hint}</p>}
    </div>
  );
}

export const Loading = () => <div className="py-20 flex justify-center"><LoadingSpinner size="lg" /></div>;

/* GET a vendor API; `refresh()` reloads it. Optional polling while the tab is visible. */
export function useVendorData(url, { pollMs = 0 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => fetch(url, { cache: 'no-store' }).then((r) => r.json())
    .then((d) => { if (d.success) { setData(d.data); setError(''); } else setError(d.message || 'Could not load.'); })
    .catch(() => setError('Could not load. Check your connection and refresh.')), [url]);
  useEffect(() => {
    load();
    if (!pollMs) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { data, error, refresh: load, setData };
}

export async function sendJson(url, method, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await res.json().catch(() => ({ success: false, message: 'Unexpected response' }));
  if (!d.success) throw new Error(d.message || 'Something went wrong');
  return d.data;
}
