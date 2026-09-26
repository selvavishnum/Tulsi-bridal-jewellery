'use client';
import { useState } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import { Card, Stat, Loading, Pill, inrPaise, shortDate, useVendorData } from '@/components/vendor/ui';

const LEDGER_STATUS = {
  unsettled: ['Earned', 'bg-amber-50 text-amber-700'],
  settled: ['Paid out', 'bg-green-50 text-green-700'],
  reversed: ['Refunded', 'bg-stone-100 text-stone-500'],
};
const POLL_MS = 30000;

export default function VendorEarningsPage() {
  const summary = useVendorData('/api/vendor/summary', { pollMs: POLL_MS });
  const [tab, setTab] = useState('ledger');

  if (summary.error) return <p className="text-sm text-red-600">{summary.error}</p>;
  if (!summary.data) return <Loading />;

  const s = summary.data.summary;
  const refresh = () => summary.refresh();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-bold text-stone-900">Earnings</h1>
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
          <div className="flex justify-between py-2"><dt className="text-stone-600">− Shipping</dt><dd>{inrPaise(-s.logisticsPaise)}</dd></div>
          <div className="flex justify-between py-2"><dt className="text-stone-600">− Tulsi margin &amp; fee</dt><dd>{inrPaise(-s.chargesPaise)}</dd></div>
          <div className="flex justify-between py-2"><dt className="font-semibold text-stone-800">= Net earnings</dt><dd className="font-bold text-wine-700">{inrPaise(s.netPaise)}</dd></div>
        </dl>
        <p className="text-xs text-stone-400 mt-2">Delivered orders only. Shipping is the charge you set per piece, or the actual courier cost where you haven&apos;t set one. Refunds after a payout are recovered from your next earnings.</p>
      </Card>

      <div className="flex gap-1.5" role="tablist">
        {[['ledger', 'Ledger'], ['payouts', 'Payouts']].map(([id, text]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold ${tab === id ? 'bg-wine-700 text-white' : 'bg-white border border-stone-200 text-stone-600'}`}>
            {text}
          </button>
        ))}
      </div>

      {tab === 'ledger' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="py-2 pr-3">Order</th><th className="pr-3">Delivered</th>
                  <th className="pr-3 text-right">Sold</th><th className="pr-3 text-right">Shipping</th>
                  <th className="pr-3 text-right">Margin &amp; fee</th><th className="pr-3 text-right">Net</th><th>Status</th>
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
