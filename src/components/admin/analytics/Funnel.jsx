/* Shopping funnel: sessions → product → (try-on, optional) → cart → checkout → paid. */
import { FiFilter } from 'react-icons/fi';
import { Card, Empty, Pill } from './ui';
import { fmtNum, fmtPct, widthPct, n0 } from './format';

/* What each step's "x% of previous" is measured against (see FUNNEL_STEPS).
   Product detail is measured against visits, already shown as "of visits". */
const PREV = { tryon: 'of product viewers', cart: 'of product viewers', checkout: 'of carts', paid: 'of checkouts' };

export default function Funnel({ funnel, label }) {
  const rows = Array.isArray(funnel) ? funnel : [];
  const visits = n0(rows[0]?.count);
  /* Optional steps sit beside the main path, so they get no step number. */
  const steps = rows.map((r, i) => ({ ...r, no: r.optional ? null : rows.slice(0, i + 1).filter((x) => !x.optional).length }));

  return (
    <Card title="Shopping funnel" subtitle={`Sessions reaching each step · ${label || ''}`} icon={FiFilter}>
      {visits === 0 ? (
        <Empty>No sessions in this range yet</Empty>
      ) : (
        <>
          <ol className="space-y-2">
            {steps.map((r, i) => (
              <li
                key={r.key}
                className={r.optional
                  ? 'ml-5 sm:ml-9 rounded-xl border border-dashed border-fuchsia-400/35 bg-fuchsia-500/[0.03] px-3 py-2.5'
                  : 'rounded-xl border border-transparent px-3 py-2.5'}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-slate-200 text-sm font-medium flex items-center gap-2 min-w-0">
                    {r.no ? (
                      <span className="w-5 h-5 rounded-full bg-white/[0.06] text-[11px] text-slate-400 flex items-center justify-center tabular-nums flex-shrink-0" aria-hidden="true">{r.no}</span>
                    ) : (
                      <span className="w-5 text-center text-fuchsia-300/80 flex-shrink-0" aria-hidden="true">↳</span>
                    )}
                    <span className="truncate">{r.label}</span>
                    {r.optional && <Pill className="bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-400/30">optional</Pill>}
                  </p>
                  <p className="text-slate-100 text-sm font-semibold tabular-nums whitespace-nowrap">
                    {fmtNum(r.count)} <span className="text-slate-500 font-normal text-xs">· {fmtPct(r.ofVisits)} of visits</span>
                  </p>
                </div>
                <div className="mt-2 h-2.5 w-full rounded-full bg-white/[0.05] overflow-hidden" aria-hidden="true">
                  <div className={`h-full rounded-full ${r.optional ? 'bg-fuchsia-400/70' : 'bg-amber-400'} motion-safe:transition-[width] motion-safe:duration-500`}
                    style={{ width: widthPct(r.ofVisits), minWidth: n0(r.count) > 0 ? 3 : 0 }} />
                </div>
                {i > 0 && (
                  <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
                    {r.key !== 'product' && <>{fmtPct(r.ofPrevious)} {PREV[r.key] || 'of previous step'}</>}
                    {!r.optional && n0(r.dropOff) > 0 && <span className="text-red-300/80">{r.key !== 'product' && ' · '}−{fmtNum(r.dropOff)} drop-off</span>}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
            Try-on is a side step — shoppers can add to cart without trying on, so “Add to cart” is measured against product viewers.
          </p>
        </>
      )}
    </Card>
  );
}
