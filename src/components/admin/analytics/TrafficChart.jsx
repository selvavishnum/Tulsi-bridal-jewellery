/* Traffic over the range: hourly sessions (+ faint pageviews) for one day,
   daily visitors (+ an orders strip) for 7 / 30 days. Pure CSS bars on one
   count axis; hover / focus / arrow keys show a readout; table view below. */
import { useState } from 'react';
import { FiBarChart2 } from 'react-icons/fi';
import { Card, Empty, FOCUS } from './ui';
import { n0, fmtNum, fmtINR, fmtCompact, fmtDayKey, niceMax } from './format';

const PLOT_H = 'h-40 sm:h-48';
const barStyle = (v, max) => ({ height: `${max > 0 ? (n0(v) / max) * 100 : 0}%`, minHeight: n0(v) > 0 ? 2 : 0 });

function describe(p, isHour) {
  if (isHour) return `${p.label} IST: ${fmtNum(p.sessions)} sessions, ${fmtNum(p.pageviews)} pageviews`;
  return `${fmtDayKey(p.key)}: ${fmtNum(p.visitors)} visitors, ${fmtNum(p.sessions)} sessions, ${fmtNum(p.orders)} orders${n0(p.revenue) ? ` (${fmtINR(p.revenue)})` : ''}`;
}

function Legend({ isHour }) {
  const sw = 'inline-block w-2.5 h-2.5 rounded-sm';
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
      {isHour ? (
        <>
          <li className="flex items-center gap-1.5"><span className={`${sw} bg-amber-400`} aria-hidden="true" />Sessions</li>
          <li className="flex items-center gap-1.5"><span className={`${sw} bg-amber-400/25`} aria-hidden="true" />Pageviews</li>
        </>
      ) : (
        <>
          <li className="flex items-center gap-1.5"><span className={`${sw} bg-amber-400`} aria-hidden="true" />Visitors</li>
          <li className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />Orders</li>
        </>
      )}
    </ul>
  );
}

function TableView({ points, isHour }) {
  return (
    <details className="mt-4">
      <summary className={`cursor-pointer select-none text-xs text-slate-400 hover:text-slate-200 rounded ${FOCUS}`}>View as table</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-white/[0.06]">
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 bg-[#1c2230] text-slate-400">
            <tr>
              <th scope="col" className="text-left font-medium px-3 py-2">{isHour ? 'Hour (IST)' : 'Day'}</th>
              {isHour ? (
                <><th scope="col" className="text-right font-medium px-3 py-2">Sessions</th><th scope="col" className="text-right font-medium px-3 py-2">Pageviews</th></>
              ) : (
                <><th scope="col" className="text-right font-medium px-3 py-2">Visitors</th><th scope="col" className="text-right font-medium px-3 py-2">Sessions</th><th scope="col" className="text-right font-medium px-3 py-2">Orders</th><th scope="col" className="text-right font-medium px-3 py-2">Revenue</th></>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04] text-slate-300">
            {points.map((p) => (
              <tr key={p.key}>
                <th scope="row" className="text-left font-normal px-3 py-1.5 text-slate-400">{isHour ? p.label : fmtDayKey(p.key)}</th>
                {isHour ? (
                  <><td className="text-right px-3 py-1.5">{fmtNum(p.sessions)}</td><td className="text-right px-3 py-1.5">{fmtNum(p.pageviews)}</td></>
                ) : (
                  <><td className="text-right px-3 py-1.5">{fmtNum(p.visitors)}</td><td className="text-right px-3 py-1.5">{fmtNum(p.sessions)}</td><td className="text-right px-3 py-1.5">{fmtNum(p.orders)}</td><td className="text-right px-3 py-1.5">{fmtINR(p.revenue)}</td></>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function TrafficChart({ series, label }) {
  const [active, setActive] = useState(null);
  const isHour = series?.unit !== 'day';
  const points = Array.isArray(series?.points) ? series.points : [];
  const top = (p) => (isHour ? Math.max(n0(p.sessions), n0(p.pageviews)) : n0(p.visitors));
  const max = niceMax(Math.max(0, ...points.map(top)));
  const total = points.reduce((a, p) => a + top(p) + n0(p.orders), 0);
  const peak = points.reduce((best, p) => (best === null || n0(isHour ? p.sessions : p.visitors) > n0(isHour ? best.sessions : best.visitors) ? p : best), null);
  const cur = active !== null ? points[active] : null;
  const showTick = (i) => (isHour ? i % 3 === 0 : points.length <= 7 || (points.length - 1 - i) % 5 === 0);
  const orderLabels = !isHour && points.length <= 14;
  const focusIdx = active ?? points.length - 1;

  const onKeyDown = (e) => {
    const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -points.length, End: points.length };
    if (!Object.hasOwn(moves, e.key)) return;
    e.preventDefault();
    const next = Math.min(points.length - 1, Math.max(0, focusIdx + moves[e.key]));
    setActive(next);
    e.currentTarget.querySelectorAll('button')[next]?.focus();
  };

  let summary = 'Hover or focus a bar for details.';
  if (peak && n0(isHour ? peak.sessions : peak.visitors) > 0) {
    summary = isHour
      ? `Busiest hour ${peak.label} IST · ${fmtNum(peak.sessions)} sessions`
      : `Busiest day ${fmtDayKey(peak.key)} · ${fmtNum(peak.visitors)} visitors`;
  }

  return (
    <Card title="Traffic" subtitle={`${isHour ? 'Sessions by hour' : 'Visitors by day'} · ${label || ''}`} icon={FiBarChart2} action={<Legend isHour={isHour} />}>
      {total === 0 ? (
        <Empty>No visits recorded for {label ? label.toLowerCase() : 'this range'} yet.</Empty>
      ) : (
        <>
          <p className="text-xs text-slate-300 min-h-[1.25rem] mb-2 tabular-nums">{cur ? describe(cur, isHour) : <span className="text-slate-500">{summary}</span>}</p>
          <div className="flex pr-2">
            <div className={`relative w-10 flex-shrink-0 ${PLOT_H} text-[10px] text-slate-500 tabular-nums`} aria-hidden="true">
              <span className="absolute right-2 top-0 -translate-y-1/2">{fmtCompact(max)}</span>
              <span className="absolute right-2 top-1/2 -translate-y-1/2">{fmtCompact(max / 2)}</span>
              <span className="absolute right-2 bottom-0 translate-y-1/2">0</span>
            </div>
            <div className={`relative flex-1 min-w-0 ${PLOT_H}`}>
              <div className="absolute inset-x-0 top-0 border-t border-white/[0.06]" aria-hidden="true" />
              <div className="absolute inset-x-0 top-1/2 border-t border-white/[0.06]" aria-hidden="true" />
              <div className="absolute inset-x-0 bottom-0 border-t border-white/[0.14]" aria-hidden="true" />
              <ol className="absolute inset-0 flex items-end" aria-label={`${isHour ? 'Sessions by hour' : 'Visitors by day'}, use arrow keys to move between bars`} onKeyDown={onKeyDown}>
                {points.map((p, i) => (
                  <li key={p.key} className="flex-1 min-w-0 h-full">
                    <button
                      type="button"
                      tabIndex={i === focusIdx ? 0 : -1}
                      aria-label={describe(p, isHour)}
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive(null)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      className={`h-full w-full flex items-end justify-center gap-px px-px rounded-sm ${active === i ? 'bg-white/[0.05]' : ''} ${FOCUS}`}
                    >
                      {isHour ? (
                        <>
                          <span className="block w-1/2 max-w-[12px] rounded-t-[3px] bg-amber-400" style={barStyle(p.sessions, max)} />
                          <span className="block w-1/2 max-w-[12px] rounded-t-[3px] bg-amber-400/25" style={barStyle(p.pageviews, max)} />
                        </>
                      ) : (
                        <span className="block w-full max-w-[24px] rounded-t-[3px] bg-amber-400" style={barStyle(p.visitors, max)} />
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {!isHour && (
            <div className="flex pr-2 mt-1.5" aria-hidden="true">
              <div className="w-10 flex-shrink-0 text-[10px] text-slate-500 text-right pr-2 leading-4">Orders</div>
              <div className="flex flex-1 min-w-0">
                {points.map((p) => (
                  <div key={p.key} className="flex-1 min-w-0 flex items-center justify-center h-4 gap-0.5">
                    {n0(p.orders) > 0 && (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#161b22]" />
                        {orderLabels && <span className="text-[10px] text-slate-300 tabular-nums">{fmtNum(p.orders)}</span>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex pr-2 mt-1" aria-hidden="true">
            <div className="w-10 flex-shrink-0 text-[10px] text-slate-600 text-right pr-2 leading-4">{isHour ? 'IST' : ''}</div>
            <div className="flex flex-1 min-w-0">
              {points.map((p, i) => (
                <div key={p.key} className="relative flex-1 min-w-0 h-4">
                  {showTick(i) && (
                    <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-slate-500 tabular-nums leading-4">
                      {isHour ? p.key : fmtDayKey(p.key)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <TableView points={points} isHour={isHour} />
        </>
      )}
    </Card>
  );
}
