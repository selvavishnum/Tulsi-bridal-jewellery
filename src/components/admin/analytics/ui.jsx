/* Shared building blocks for the Visitor Analytics dashboard (dark admin theme). */
import { useId } from 'react';
import { widthPct } from './format';

export const CARD = 'bg-[#161b22] border border-white/[0.07] rounded-2xl';
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1117]';

/** A titled dashboard section. */
export function Card({ title, subtitle, icon: Icon, action, className = '', children }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${CARD} p-4 sm:p-5 min-w-0 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 mb-4">
        <div className="min-w-0">
          <h2 id={id} className="text-white font-semibold text-[15px] flex items-center gap-2">
            {Icon && <Icon className="text-amber-400 flex-shrink-0" aria-hidden="true" />}
            {title}
          </h2>
          {subtitle && <p className="text-slate-500 text-xs mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }) {
  return <p className="text-slate-500 text-sm text-center py-8 px-2">{children}</p>;
}

export function Pill({ className = '', children, title }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

/** Thin horizontal meter on a recessive track. */
export function Meter({ value, color = 'bg-amber-400', style, label }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-white/[0.05] overflow-hidden" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <div className={`h-full rounded-full ${color} motion-safe:transition-[width] motion-safe:duration-500`} style={{ width: widthPct(value), ...style }} />
    </div>
  );
}

/** Label · count · share rows with a meter under each. */
export function BreakdownList({ rows, empty = 'No data yet', color = 'bg-amber-400', mono = false }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-xs mb-1">
            <span className={`text-slate-300 truncate min-w-0 ${mono ? 'font-mono text-[11px]' : ''}`} title={r.label}>{r.label}</span>
            <span className="text-slate-400 tabular-nums whitespace-nowrap">
              {r.countText}
              <span className="text-slate-500 ml-1.5">{r.shareText}</span>
            </span>
          </div>
          <Meter value={r.share} color={color} />
        </li>
      ))}
    </ul>
  );
}

/** Skeleton shown only before the first response arrives. */
export function DashboardSkeleton() {
  const block = 'rounded-2xl bg-white/[0.04] motion-safe:animate-pulse';
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading visitor analytics">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-36`} />)}
      </div>
      <div className={`${block} h-20`} />
      <div className={`${block} h-64`} />
      <div className={`${block} h-72`} />
    </div>
  );
}
