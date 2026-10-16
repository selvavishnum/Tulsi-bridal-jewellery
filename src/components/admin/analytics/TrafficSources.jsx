/* Where sessions came from: one 100% stacked bar + a legend table that
   carries every value (the bar's colours are never the only key). */
import { FiShare2 } from 'react-icons/fi';
import { Card, Empty } from './ui';
import { fmtNum, fmtPct, fmtINR, channelColor, inkOn, n0, share } from './format';

const TH = 'font-medium text-[11px] uppercase tracking-wider text-slate-500 px-2 py-2 whitespace-nowrap';

export default function TrafficSources({ sources, label }) {
  const rows = (Array.isArray(sources) ? sources : []).filter((r) => n0(r.count) > 0);
  const total = rows.reduce((a, r) => a + n0(r.count), 0);

  return (
    <Card title="Traffic sources" subtitle={`Sessions by channel · ${label || ''}`} icon={FiShare2}>
      {total === 0 ? (
        <Empty>No visits in this range yet</Empty>
      ) : (
        <>
          <div
            className="flex h-7 w-full gap-0.5 rounded-lg overflow-hidden"
            role="img"
            aria-label={`Sessions by channel: ${rows.map((r) => `${r.label} ${fmtPct(share(r.count, total))}`).join(', ')}`}
          >
            {rows.map((r) => {
              const pct = share(r.count, total);
              const bg = channelColor(r.key);
              return (
                <div
                  key={r.key}
                  title={`${r.label}: ${fmtNum(r.count)} sessions (${fmtPct(pct)})`}
                  className="h-full min-w-[3px] flex items-center justify-center text-[11px] font-semibold tabular-nums"
                  style={{ flexGrow: n0(r.count), flexBasis: 0, backgroundColor: bg, color: inkOn(bg) }}
                >
                  {pct >= 14 && <span aria-hidden="true">{Math.round(pct)}%</span>}
                </div>
              );
            })}
          </div>

          <div className="mt-4 overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm tabular-nums">
              <thead className="border-b border-white/[0.06]">
                <tr>
                  <th scope="col" className={`${TH} text-left`}>Channel</th>
                  <th scope="col" className={`${TH} text-right`}>Sessions</th>
                  <th scope="col" className={`${TH} text-right`}>Share</th>
                  <th scope="col" className={`${TH} text-right`}>Orders</th>
                  <th scope="col" className={`${TH} text-right`}>Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="text-left font-normal px-2 py-2 text-slate-200 whitespace-nowrap">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-[-1px]" style={{ backgroundColor: channelColor(r.key) }} aria-hidden="true" />
                      {r.label}
                    </th>
                    <td className="text-right px-2 py-2 text-slate-300">{fmtNum(r.count)}</td>
                    <td className="text-right px-2 py-2 text-slate-400">{fmtPct(share(r.count, total))}</td>
                    <td className="text-right px-2 py-2 text-slate-300" title={n0(r.revenue) ? `Revenue ${fmtINR(r.revenue)}` : undefined}>{fmtNum(r.orders)}</td>
                    <td className="text-right px-2 py-2 text-slate-400">{fmtPct(r.conversion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
