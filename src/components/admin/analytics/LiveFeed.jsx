/* Who is on the site right now (sessions seen in the last 5 minutes). */
import { FiRadio, FiExternalLink } from 'react-icons/fi';
import { Card, Empty, Pill, FOCUS } from './ui';
import { fmtNum, fmtDuration, deviceLabel, osLabel, browserLabel, channelColor, stageOf, safePath, place, n0 } from './format';

function Who({ s }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        {s.registered ? (
          <>
            <span className="text-slate-100 text-sm font-medium truncate">{s.name || 'Customer'}</span>
            <Pill className="bg-amber-500/15 text-amber-300 ring-amber-400/30">Customer</Pill>
          </>
        ) : (
          <Pill className="bg-white/[0.04] text-slate-300 ring-white/10">Guest</Pill>
        )}
      </div>
      <p className="text-slate-500 text-[11px] font-mono mt-0.5 truncate">
        {s.ip || 'IP n/a'}{s.visitor ? ` · ${s.visitor}` : ''}
      </p>
    </div>
  );
}

function Device({ s }) {
  const sub = [osLabel(s.os), browserLabel(s.browser)].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0">
      <p className="text-slate-200 text-sm">{deviceLabel(s.device)}</p>
      {sub && <p className="text-slate-500 text-[11px] truncate">{sub}</p>}
    </div>
  );
}

function Source({ s }) {
  return (
    <div className="min-w-0">
      <p className="text-slate-200 text-sm flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: channelColor(s.channel) }} aria-hidden="true" />
        <span className="truncate">{s.channelLabel || 'Direct'}</span>
      </p>
      {s.campaign && <p className="text-slate-500 text-[11px] truncate" title={s.campaign}>{s.campaign}</p>}
    </div>
  );
}

function PageLink({ s }) {
  const path = safePath(s.currentPath);
  if (!path) return <span className="text-slate-600 text-sm">—</span>;
  return (
    <div className="min-w-0">
      <a href={path} target="_blank" rel="noopener noreferrer" title={path}
        className={`inline-flex items-center gap-1 max-w-full text-sky-300 hover:text-sky-200 text-sm font-mono rounded ${FOCUS}`}>
        <span className="truncate">{path}</span>
        <FiExternalLink className="flex-shrink-0 text-[11px]" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <p className="text-slate-500 text-[11px]">{fmtNum(s.pageviews)} {n0(s.pageviews) === 1 ? 'page' : 'pages'}</p>
    </div>
  );
}

function TimeSpent({ s }) {
  return (
    <div title={`Active (foreground) time: ${fmtDuration(s.activeSeconds)} (${fmtNum(s.activeSeconds)} s)`}>
      <p className="text-slate-200 text-sm tabular-nums">{fmtDuration(s.durationSeconds)}</p>
      <p className="text-slate-500 text-[11px] tabular-nums">active {fmtDuration(s.activeSeconds)}</p>
    </div>
  );
}

function Stage({ s }) {
  const st = stageOf(s.stage);
  return <Pill className={st.cls}>{st.label}</Pill>;
}

const TH = 'text-left font-medium text-[11px] uppercase tracking-wider text-slate-500 px-3 py-2 whitespace-nowrap';

export default function LiveFeed({ live }) {
  const rows = Array.isArray(live?.sessions) ? live.sessions : [];
  const active = n0(live?.activeVisitors);
  const note = rows.length && active > rows.length ? `Showing the ${fmtNum(rows.length)} most recent of ${fmtNum(active)}` : 'Sessions seen in the last 5 minutes';

  return (
    <Card title="Live visitors" subtitle={note} icon={FiRadio}
      action={<span className="text-xs text-slate-400 tabular-nums">{fmtNum(active)} on site</span>}>
      {rows.length === 0 ? (
        <Empty>No one on the site right now</Empty>
      ) : (
        <>
          {/* Phone: one card per visitor */}
          <ul className="sm:hidden space-y-2.5">
            {rows.map((s, i) => (
              <li key={s.sid || i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <Who s={s} />
                  <Stage s={s} />
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <p className="text-slate-500 text-[10px] uppercase tracking-wider">Location</p>
                    <p className="text-slate-200 text-sm truncate">{place(s)}</p>
                  </div>
                  <div className="min-w-0"><p className="text-slate-500 text-[10px] uppercase tracking-wider">Device</p><Device s={s} /></div>
                  <div className="min-w-0"><p className="text-slate-500 text-[10px] uppercase tracking-wider">Source</p><Source s={s} /></div>
                  <div className="min-w-0"><p className="text-slate-500 text-[10px] uppercase tracking-wider">Time spent</p><TimeSpent s={s} /></div>
                  <div className="col-span-2 min-w-0"><p className="text-slate-500 text-[10px] uppercase tracking-wider">Current page</p><PageLink s={s} /></div>
                </div>
              </li>
            ))}
          </ul>

          {/* Tablet / desktop: table in its own horizontal scroller */}
          <div className="hidden sm:block overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-white/[0.06]">
                <tr>
                  <th scope="col" className={TH}>Visitor</th>
                  <th scope="col" className={TH}>City, State</th>
                  <th scope="col" className={TH}>Device</th>
                  <th scope="col" className={TH}>Source</th>
                  <th scope="col" className={TH}>Current page</th>
                  <th scope="col" className={TH}>Time spent</th>
                  <th scope="col" className={TH}>Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rows.map((s, i) => (
                  <tr key={s.sid || i} className="align-top hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 max-w-[200px]"><Who s={s} /></td>
                    <td className="px-3 py-2.5 text-slate-200 max-w-[180px]"><span className="block truncate" title={place(s)}>{place(s)}</span></td>
                    <td className="px-3 py-2.5 max-w-[160px]"><Device s={s} /></td>
                    <td className="px-3 py-2.5 max-w-[160px]"><Source s={s} /></td>
                    <td className="px-3 py-2.5 max-w-[220px]"><PageLink s={s} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><TimeSpent s={s} /></td>
                    <td className="px-3 py-2.5"><Stage s={s} /></td>
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
