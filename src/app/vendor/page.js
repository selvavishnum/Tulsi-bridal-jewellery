'use client';
import { useEffect, useState } from 'react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const inr = (paise) => ((paise || 0) / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');

const STATUS = {
  unsettled: ['Earned', 'bg-amber-50 text-amber-700'],
  settled: ['Paid out', 'bg-green-50 text-green-700'],
  reversed: ['Refunded', 'bg-stone-100 text-stone-500'],
};

export default function VendorEarningsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/vendor/summary').then((r) => r.json())
      .then((d) => (d.success ? setData(d.data) : setError(d.message)))
      .catch(() => setError('Could not load your earnings. Check your connection and refresh.'));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <div className="py-20 flex justify-center"><LoadingSpinner size="lg" /></div>;

  const s = data.summary;

  return (
    <div className="space-y-6">
      <section className="grid md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-stone-200 p-5 md:col-span-1">
          <p className="text-xs uppercase tracking-wide text-stone-400 font-semibold">Available for payout</p>
          <p className={`text-3xl font-bold mt-1 tabular-nums ${s.availablePaise < 0 ? 'text-red-600' : 'text-stone-900'}`}>{inr(s.availablePaise)}</p>
          <p className="text-xs text-stone-500 mt-2">
            Paid to {data.vendor.payoutDestination || 'your payout account (not set — contact Tulsi)'}
          </p>
          {s.availablePaise < 0 && <p className="text-xs text-red-600 mt-1">Refunds after a payout are recovered from your next earnings.</p>}
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <p className="text-xs uppercase tracking-wide text-stone-400 font-semibold">In return window</p>
          <p className="text-2xl font-bold mt-1 tabular-nums text-stone-900">{inr(s.pendingPaise)}</p>
          <p className="text-xs text-stone-500 mt-2">Earnings become available {data.holdDays} days after delivery.</p>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <p className="text-xs uppercase tracking-wide text-stone-400 font-semibold">Paid out so far</p>
          <p className="text-2xl font-bold mt-1 tabular-nums text-stone-900">{inr(s.paidOutPaise)}</p>
          <p className="text-xs text-stone-500 mt-2">Platform fee: {data.vendor.platformFeePercent}% of item sales.</p>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-5">
        <h2 className="font-semibold text-stone-800 mb-3">How your earnings add up</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm tabular-nums">
          <div><dt className="text-xs text-stone-400">Gross collected</dt><dd className="font-semibold">{inr(s.grossPaise)}</dd></div>
          <div><dt className="text-xs text-stone-400">− Supply cost</dt><dd className="font-semibold">{inr(s.supplyCostPaise)}</dd></div>
          <div><dt className="text-xs text-stone-400">− Shipping</dt><dd className="font-semibold">{inr(s.shippingPaise)}</dd></div>
          <div><dt className="text-xs text-stone-400">− Platform fee</dt><dd className="font-semibold">{inr(s.platformFeePaise)}</dd></div>
          <div><dt className="text-xs text-stone-400">= Net earned</dt><dd className="font-bold text-wine-700">{inr(s.netPaise)}</dd></div>
        </dl>
        <p className="text-xs text-stone-400 mt-3">Counted for delivered orders only. Gross collected is what customers paid for your pieces, including their share of any shipping fee.</p>
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-5">
        <h2 className="font-semibold text-stone-800 mb-3">Order by order</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="py-2 pr-3">Order</th><th className="pr-3">Delivered</th>
                <th className="pr-3 text-right">Collected</th><th className="pr-3 text-right">Supply cost</th>
                <th className="pr-3 text-right">Shipping</th><th className="pr-3 text-right">Fee</th>
                <th className="pr-3 text-right">Net</th><th>Status</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.entries.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-stone-400">No delivered orders yet — earnings appear here once an order with your pieces is delivered.</td></tr>
              )}
              {data.entries.map((e) => {
                const [label, cls] = e.type === 'reversal'
                  ? ['Refund recovery', 'bg-red-50 text-red-700']
                  : STATUS[e.status] || [e.status, 'bg-stone-100'];
                return (
                  <tr key={e.id} className="border-t border-stone-100">
                    <td className="py-2 pr-3 font-mono text-xs">{e.orderNumber}</td>
                    <td className="pr-3">{date(e.deliveredAt || e.createdAt)}</td>
                    <td className="pr-3 text-right">{inr(e.grossPaise)}</td>
                    <td className="pr-3 text-right">{inr(e.supplyCostPaise)}</td>
                    <td className="pr-3 text-right">{inr(e.shippingPaise)}</td>
                    <td className="pr-3 text-right">{inr(e.platformFeePaise)}</td>
                    <td className={`pr-3 text-right font-semibold ${e.netPaise < 0 ? 'text-red-600' : ''}`}>{inr(e.netPaise)}</td>
                    <td>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{label}</span>
                      {e.held && <span className="block text-xs text-stone-400 mt-0.5">available {date(e.availableAt)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-5">
        <h2 className="font-semibold text-stone-800 mb-3">Payouts</h2>
        {data.payouts.length === 0 ? (
          <p className="text-sm text-stone-400">No payouts yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm tabular-nums">
            {data.payouts.map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap justify-between gap-2">
                <span>{date(p.createdAt)} · {p.destination}</span>
                <span className="font-semibold">{inr(p.amountPaise)} <span className="text-xs text-stone-400 font-normal">ref {p.reference}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
