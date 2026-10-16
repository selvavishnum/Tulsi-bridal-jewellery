/* Small engagement stats for the selected range. */
import { CARD } from './ui';
import { fmtNum, fmtDec, fmtPct, fmtDuration } from './format';

export default function SecondaryStats({ kpis = {} }) {
  const stats = [
    { label: 'Sessions', value: fmtNum(kpis.sessions) },
    { label: 'Pageviews', value: fmtNum(kpis.pageviews) },
    { label: 'Pages / session', value: fmtDec(kpis.pagesPerSession) },
    { label: 'Avg engaged time', value: fmtDuration(kpis.avgActiveSeconds), hint: 'Average active (foreground) time per session' },
    { label: 'Bounce rate', value: fmtPct(kpis.bounceRate), hint: 'Sessions that were not engaged' },
    { label: 'Try-ons', value: fmtNum(kpis.tryons) },
    { label: 'Add-to-carts', value: fmtNum(kpis.addToCarts) },
  ];
  return (
    <section aria-label="Engagement" className={`${CARD} px-2 py-1`}>
      <dl className="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map((s) => (
          <div key={s.label} className="px-3 py-3 min-w-0" title={s.hint}>
            <dt className="text-slate-500 text-[11px] font-medium uppercase tracking-wider truncate">{s.label}</dt>
            <dd className="text-slate-100 text-lg font-semibold mt-0.5">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
