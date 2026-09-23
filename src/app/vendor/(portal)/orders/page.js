'use client';
import { useState } from 'react';
import { FiExternalLink, FiRefreshCw } from 'react-icons/fi';
import { Card, Stat, Loading, Pill, inr, inrPaise, shortDate, useVendorData } from '@/components/vendor/ui';

const STATUS_STYLE = {
  pending: 'bg-stone-100 text-stone-600',
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-indigo-50 text-indigo-700',
  shipped: 'bg-purple-50 text-purple-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};
const LEDGER_STATUS = {
  unsettled: ['Earned', 'bg-amber-50 text-amber-700'],
  settled: ['Paid out', 'bg-green-50 text-green-700'],
  reversed: ['Refunded', 'bg-stone-100 text-stone-500'],
};
const POLL_MS = 30000;

export default function VendorOrdersPage() {
  const summary = useVendorData('/api/vendor/summary', { pollMs: POLL_MS });
  const orders = useVendorData('/api/vendor/orders', { pollMs: POLL_MS });
  const [tab, setTab] = useState('orders');

  const error = summary.error || orders.error;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!summary.data || !orders.data) return <Loading />;

  const s = summary.data.summary;
  const refresh = () => { summary.refresh(); orders.refresh(); };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-bold text-stone-900">Orders &amp; Earnings</h1>
        <button onClick={refresh} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-wine-700"><FiRefreshCw /> Refresh</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Withdrawable now" value={inrPaise(s.availablePaise)} tone={s.availablePaise < 0 ? 'text-red-600' : 'text-wine-700'}
          hint={summary.data.vendor.payoutDestination ? `To ${summary.data.vendor.payoutDestination}` : 'Add payout details in Store Profile'} />
        <Stat label="In return window" value={inrPaise(s.pendingPaise)} hint={`Withdrawable ${summary.data.holdDays} days after delivery`} />
        <Stat label="Paid out" value={inrPaise(s.paidOutPaise)} />
        <Stat label="Net earnings" value={inrPaise(s.netPaise)} hint="All delivered orders" />
      </div>

      <Card title="How your earnings add up">
        <dl className="text-sm tabular-nums max-w-md divide-y divide-stone-100">
          <div className="flex justify-between py-2"><dt className="text-stone-600">Total sold</dt><dd className="font-semibold">{inrPaise(s.totalSoldPaise)}</dd></div>
          <div className="flex justify-between py-2"><dt className="text-stone-600">− Logistics (courier)</dt><dd>{inrPaise(-s.logisticsPaise)}</dd></div>
          <div className="flex justify-between py-2"><dt className="text-stone-600">− Supply cost &amp; Tulsi fee</dt><dd>{inrPaise(-s.chargesPaise)}</dd></div>
          <div className="flex justify-between py-2"><dt className="font-semibold text-stone-800">= Net earnings</dt><dd className="font-bold text-wine-700">{inrPaise(s.netPaise)}</dd></div>
        </dl>
        <p className="text-xs text-stone-400 mt-2">Delivered orders only. Total sold includes any delivery charge the customer paid for your pieces. Refunds after a payout are recovered from your next earnings.</p>
      </Card>

      <div className="flex gap-1.5" role="tablist">
        {[['orders', `Orders (${orders.data.length})`], ['ledger', 'Ledger'], ['payouts', 'Payouts']].map(([id, text]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold ${tab === id ? 'bg-wine-700 text-white' : 'bg-white border border-stone-200 text-stone-600'}`}>
            {text}
          </button>
        ))}
      </div>

      {tab === 'orders' && (orders.data.length === 0 ? (
        <p className="text-sm text-stone-500">No orders with your pieces yet.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-stone-500">Tulsi packs and ships every order. The tracking link appears once a parcel is dispatched.</p>
          {orders.data.map((o) => (
            <article key={o.id} className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-semibold text-stone-800">{o.orderNumber}</p>
                  <p className="text-xs text-stone-500">{shortDate(o.createdAt)} · {o.customer.firstName || 'Customer'}{o.customer.city ? `, ${o.customer.city}` : ''} · {o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'}</p>
                </div>
                <Pill className={`capitalize ${STATUS_STYLE[o.status] || 'bg-stone-100'}`}>{o.status === 'processing' ? 'packed' : o.status}</Pill>
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                {o.items.map((i, idx) => (
                  <li key={idx} className="flex justify-between gap-3">
                    <span className="text-stone-700">{i.name} × {i.quantity}</span>
                    <span className="tabular-nums text-stone-600">{inr(i.price * i.quantity)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 pt-3 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-stone-500">Your items: <span className="font-semibold text-stone-800 tabular-nums">{inr(o.itemsTotal)}</span></span>
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
      ))}

      {tab === 'ledger' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="py-2 pr-3">Order</th><th className="pr-3">Delivered</th>
                  <th className="pr-3 text-right">Sold</th><th className="pr-3 text-right">Logistics</th>
                  <th className="pr-3 text-right">Supply &amp; fee</th><th className="pr-3 text-right">Net</th><th>Status</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {summary.data.entries.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-stone-400">No delivered orders yet — each delivered order adds a line here.</td></tr>
                )}
                {summary.data.entries.map((e) => {
                  const [text, cls] = e.type === 'reversal' ? ['Refund recovery', 'bg-red-50 text-red-700'] : LEDGER_STATUS[e.status] || [e.status, 'bg-stone-100'];
                  return (
                    <tr key={e.id} className="border-t border-stone-100">
                      <td className="py-2 pr-3 font-mono text-xs">{e.orderNumber}</td>
                      <td className="pr-3">{shortDate(e.deliveredAt)}</td>
                      <td className="pr-3 text-right">{inrPaise(e.totalSoldPaise)}</td>
                      <td className="pr-3 text-right text-stone-500">{inrPaise(-e.logisticsPaise)}</td>
                      <td className="pr-3 text-right text-stone-500">{inrPaise(-e.chargesPaise)}</td>
                      <td className={`pr-3 text-right font-semibold ${e.netPaise < 0 ? 'text-red-600' : ''}`}>{inrPaise(e.netPaise)}</td>
                      <td>
                        <Pill className={cls}>{text}</Pill>
                        {e.held && <span className="block text-xs text-stone-400 mt-0.5">from {shortDate(e.availableAt)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'payouts' && (
        <Card>
          {summary.data.payouts.length === 0 ? (
            <p className="text-sm text-stone-400">No payouts yet. Tulsi transfers your withdrawable balance to your bank or UPI.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm tabular-nums">
              {summary.data.payouts.map((p) => (
                <li key={p.id} className="py-2 flex flex-wrap justify-between gap-2">
                  <span>{shortDate(p.createdAt)} · {p.destination}</span>
                  <span className="font-semibold">{inrPaise(p.amountPaise)} <span className="text-xs text-stone-400 font-normal">ref {p.reference}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
