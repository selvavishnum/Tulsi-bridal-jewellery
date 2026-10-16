/* The four headline numbers. Hero values use proportional figures. */
import { FiActivity, FiUsers, FiShoppingCart, FiTrendingUp } from 'react-icons/fi';
import { CARD } from './ui';
import { fmtNum, fmtINR, fmtPct, n0, share } from './format';

function Kpi({ icon: Icon, label, tone, children }) {
  return (
    <section aria-label={label} className={`${CARD} p-4 sm:p-5 min-w-0 flex flex-col`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tone}`}>
          <Icon aria-hidden="true" />
        </span>
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider leading-tight">{label}</p>
      </div>
      {children}
    </section>
  );
}

function LiveDot({ on }) {
  return (
    <span className="relative flex h-3 w-3 flex-shrink-0" aria-hidden="true">
      {on && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />}
      <span className={`relative inline-flex h-3 w-3 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-600'}`} />
    </span>
  );
}

function GuestSplit({ guests, registered }) {
  const total = guests + registered;
  const g = share(guests, total);
  const r = share(registered, total);
  return (
    <div className="mt-3">
      <div className="flex h-2 w-full gap-0.5 rounded-full overflow-hidden bg-white/[0.05]" role="img"
        aria-label={`Guests ${fmtNum(guests)} (${fmtPct(g)}), registered ${fmtNum(registered)} (${fmtPct(r)})`}>
        {guests > 0 && <div className="bg-slate-400 h-full" style={{ flexGrow: guests, flexBasis: 0 }} />}
        {registered > 0 && <div className="bg-amber-400 h-full" style={{ flexGrow: registered, flexBasis: 0 }} />}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-sm bg-slate-400" aria-hidden="true" />Guests</dt>
          <dd className="text-slate-200 tabular-nums mt-0.5">{fmtNum(guests)} <span className="text-slate-500">· {fmtPct(g)}</span></dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-sm bg-amber-400" aria-hidden="true" />Registered</dt>
          <dd className="text-slate-200 tabular-nums mt-0.5">{fmtNum(registered)} <span className="text-slate-500">· {fmtPct(r)}</span></dd>
        </div>
      </dl>
    </div>
  );
}

export default function KpiCards({ live, report }) {
  const active = n0(live?.activeVisitors);
  const carts = live?.carts || {};
  const v = report?.visitors || {};
  const k = report?.kpis || {};
  const visitors = n0(v.visitors);
  const dash = <span className="text-slate-600">—</span>;

  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
      <Kpi icon={FiActivity} label="Live active visitors" tone="bg-emerald-500/10 text-emerald-400">
        <div className="flex items-center gap-3">
          <LiveDot on={active > 0} />
          <p className="text-4xl font-bold text-white leading-none" aria-live="polite" aria-atomic="true">
            {live ? fmtNum(active) : dash}
          </p>
        </div>
        <p className="text-slate-500 text-xs mt-3">
          {fmtNum(live?.activeRegistered)} signed in · last 5 min
        </p>
      </Kpi>

      <Kpi icon={FiUsers} label={`Unique visitors · ${report?.label || '—'}`} tone="bg-amber-500/10 text-amber-400">
        <p className="text-4xl font-bold text-white leading-none">
          {report ? <>{fmtNum(visitors)}{v.exact === false && <span className="text-2xl text-slate-400">+</span>}</> : dash}
        </p>
        <p className="text-slate-500 text-xs mt-2">{fmtNum(v.newVisitors)} new</p>
        <GuestSplit guests={n0(v.guests)} registered={n0(v.registered)} />
      </Kpi>

      <Kpi icon={FiShoppingCart} label="Live cart abandonment" tone="bg-red-500/10 text-red-400">
        <p className="text-white leading-none">
          <span className="text-4xl font-bold">{live ? fmtNum(carts.abandoned) : dash}</span>
          <span className="text-slate-400 text-sm ml-1.5">{n0(carts.abandoned) === 1 ? 'cart' : 'carts'}</span>
        </p>
        <p className="text-red-300 text-sm font-medium mt-2">{fmtINR(carts.abandonedValue)} at risk</p>
        <div className="text-slate-500 text-xs mt-2 space-y-0.5">
          <p>{fmtNum(carts.open)} {n0(carts.open) === 1 ? 'cart' : 'carts'} open now ({fmtINR(carts.openValue)})</p>
          <p>Range abandonment {report ? fmtPct(k.cartAbandonmentRate) : '—'}</p>
        </div>
      </Kpi>

      <Kpi icon={FiTrendingUp} label="Conversion rate" tone="bg-sky-500/10 text-sky-400">
        <p className="text-4xl font-bold text-white leading-none">{report ? fmtPct(k.conversionRate) : dash}</p>
        <p className="text-slate-500 text-xs mt-2">
          {fmtNum(k.orders)} {n0(k.orders) === 1 ? 'order' : 'orders'} · {fmtINR(k.revenue)}
        </p>
        <p className="text-slate-600 text-[11px] mt-1">Orders ÷ unique visitors</p>
      </Kpi>
    </div>
  );
}
