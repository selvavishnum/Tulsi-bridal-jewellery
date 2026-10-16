'use client';

/* /admin/analytics — Visitor Analytics.
   Every visitor (guests and signed-in customers) from the first-party
   tracker: live visitors, traffic, sources, products, funnel, carts.
   Data: /api/admin/analytics (see src/lib/analytics/report.js). */
import { FiExternalLink } from 'react-icons/fi';
import { useAnalytics } from '@/components/admin/analytics/useAnalytics';
import Header, { ErrorBanner } from '@/components/admin/analytics/Header';
import { DashboardSkeleton, FOCUS } from '@/components/admin/analytics/ui';
import KpiCards from '@/components/admin/analytics/KpiCards';
import SecondaryStats from '@/components/admin/analytics/SecondaryStats';
import TrafficChart from '@/components/admin/analytics/TrafficChart';
import LiveFeed from '@/components/admin/analytics/LiveFeed';
import TrafficSources from '@/components/admin/analytics/TrafficSources';
import TopProducts from '@/components/admin/analytics/TopProducts';
import Funnel from '@/components/admin/analytics/Funnel';
import Breakdowns from '@/components/admin/analytics/Breakdowns';
import AbandonedCarts from '@/components/admin/analytics/AbandonedCarts';

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

function FooterNote() {
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-4 text-[11px] text-slate-500">
      <p>Counts every visitor with a first-party cookie. IPs are masked; bots, staff and sellers are excluded.</p>
      {GA_ID && (
        <a href="https://analytics.google.com/analytics/web/" target="_blank" rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 rounded ${FOCUS}`}>
          Open Google Analytics <FiExternalLink aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
    </footer>
  );
}

export default function AnalyticsPage() {
  const { range, setRange, report, live, error, loading, updatedAt, refresh } = useAnalytics();
  const hasData = !!(report || live);
  /* Switching range keeps the previous numbers on screen, dimmed, until the new ones land. */
  const stale = !!report && report.range !== range;
  const label = report?.label;

  return (
    /* Full-bleed dark canvas inside the admin shell's light <main>. */
    <div className="-m-4 md:-m-6 lg:-m-8 p-4 md:p-6 lg:p-8 bg-[#0d1117] min-h-[calc(100%_+_2rem)] md:min-h-[calc(100%_+_3rem)] lg:min-h-[calc(100%_+_4rem)]">
      <div className="mx-auto max-w-[1400px] space-y-5 sm:space-y-6">
        <Header range={range} onRange={setRange} onRefresh={refresh} loading={loading} updatedAt={updatedAt} />

        {error && <ErrorBanner error={error} onRetry={refresh} loading={loading} />}

        {!hasData && !error && <DashboardSkeleton />}

        {hasData && (
          <div aria-busy={loading} className={`space-y-5 sm:space-y-6 motion-safe:transition-opacity ${stale ? 'opacity-60' : ''}`}>
            <KpiCards live={live} report={report} />
            {report && <SecondaryStats kpis={report.kpis} />}
            {report && <TrafficChart series={report.series} label={label} />}
            <LiveFeed live={live} />
            {report && (
              <div className="grid gap-5 sm:gap-6 xl:grid-cols-5">
                <div className="xl:col-span-2 min-w-0"><TrafficSources sources={report.sources} label={label} /></div>
                <div className="xl:col-span-3 min-w-0"><TopProducts products={report.topProducts} label={label} /></div>
              </div>
            )}
            {report && <Funnel funnel={report.funnel} label={label} />}
            {report && <Breakdowns report={report} />}
            <AbandonedCarts live={live} />
          </div>
        )}

        <FooterNote />
      </div>
    </div>
  );
}
