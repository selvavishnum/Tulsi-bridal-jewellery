/* Title, range presets, refresh, last-updated time and CSV exports. */
import { FiRefreshCw, FiDownload, FiAlertTriangle } from 'react-icons/fi';
import { RANGE_OPTIONS } from './useAnalytics';
import { FOCUS } from './ui';
import { fmtTime } from './format';

const BASE_BTN = `inline-flex items-center justify-center gap-2 rounded-xl border text-xs font-medium text-center leading-tight px-3 py-2 transition-colors ${FOCUS}`;
const BTN = `${BASE_BTN} border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-slate-200`;
const ERR_BTN = `${BASE_BTN} border-red-400/30 bg-red-500/10 hover:bg-red-500/20 text-red-100`;

export function RangeControl({ range, onChange }) {
  return (
    <div role="group" aria-label="Date range" className="grid grid-cols-4 w-full sm:inline-grid sm:w-auto gap-1 rounded-xl border border-white/[0.07] bg-[#161b22] p-1">
      {RANGE_OPTIONS.map((o) => {
        const on = o.key === range;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`rounded-lg px-2 sm:px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${FOCUS} ${
              on ? 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <span className="sm:hidden">{o.short}</span>
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Header({ range, onRange, onRefresh, loading, updatedAt }) {
  const q = `range=${encodeURIComponent(range)}`;
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-white text-2xl font-bold">Visitor Analytics</h1>
          <p className="text-slate-400 text-sm mt-1">Every visitor — guests and signed-in customers</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-slate-500 text-xs tabular-nums">
            {updatedAt ? <>Updated <time dateTime={updatedAt.toISOString()}>{fmtTime(updatedAt)}</time> IST</> : 'Loading…'}
          </p>
          <button type="button" onClick={onRefresh} aria-busy={loading} className={BTN}>
            <FiRefreshCw className={loading ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeControl range={range} onChange={onRange} />
        <div className="grid grid-cols-2 w-full sm:flex sm:w-auto gap-2">
          <a href={`/api/admin/analytics/export?${q}&type=sessions`} download className={BTN}>
            <FiDownload aria-hidden="true" /> Export sessions (CSV)
          </a>
          <a href={`/api/admin/analytics/export?${q}&type=events`} download className={BTN}>
            <FiDownload aria-hidden="true" /> Export events (CSV)
          </a>
        </div>
      </div>
    </header>
  );
}

const ERROR_TEXT = {
  0: 'Could not reach the server. Check your connection and try again.',
  401: 'Your admin session has expired. Sign in again to see visitor analytics.',
  403: 'Your account does not have access to visitor reports.',
};

export function ErrorBanner({ error, onRetry, loading }) {
  const text = ERROR_TEXT[error.status] || error.message || 'Could not load analytics. Please try again.';
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
      <FiAlertTriangle className="text-red-400 flex-shrink-0" aria-hidden="true" />
      <p className="text-red-200 text-sm flex-1 min-w-[12rem]">
        {text}
        {error.status > 0 && <span className="text-red-300/60 text-xs ml-2">({error.status})</span>}
      </p>
      <div className="flex gap-2">
        {error.status === 401 && (
          <a href="/admin-portal" className={ERR_BTN}>Sign in</a>
        )}
        <button type="button" onClick={onRetry} aria-busy={loading} className={ERR_BTN}>
          <FiRefreshCw className={loading ? 'motion-safe:animate-spin' : ''} aria-hidden="true" /> Retry
        </button>
      </div>
    </div>
  );
}
