'use client';

/* Data for /admin/analytics.
   • Full load (live + range report) on mount, on range change, on manual
     refresh and every 60 s while the tab is visible.
   • Live block alone every 15 s while the tab is visible.
   • Every request is aborted on unmount / when superseded.
   State is only set from fetch callbacks; "loading" is derived. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export const RANGE_OPTIONS = Object.freeze([
  { key: 'today', label: 'Today', short: 'Today' },
  { key: 'yesterday', label: 'Yesterday', short: 'Yesterday' },
  { key: '7d', label: 'Last 7 days', short: '7 days' },
  { key: '30d', label: 'Last 30 days', short: '30 days' },
]);
const RANGE_KEYS = RANGE_OPTIONS.map((r) => r.key);
const STORAGE_KEY = 'tj-analytics-range';
const LIVE_MS = 15_000;
const FULL_MS = 60_000;
/* Yesterday / 7 days / 30 days barely move minute to minute (the server
   caches them for minutes too); only the live block needs to be fresh. */
const SLOW_FULL_MS = 5 * 60_000;
const fullEvery = (r) => (r === 'today' ? FULL_MS : SLOW_FULL_MS);

/* ── Remembered range ──
   An external store: the server render and hydration see 'today', the
   client then reads localStorage — no setState inside an effect. */
let storedRange = null;
const rangeListeners = new Set();

function readRange() {
  if (storedRange === null) {
    storedRange = 'today';
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (RANGE_KEYS.includes(v)) storedRange = v;
    } catch { /* storage blocked (private mode) — use the default */ }
  }
  return storedRange;
}
const serverRange = () => 'today';

function subscribeRange(cb) {
  rangeListeners.add(cb);
  return () => { rangeListeners.delete(cb); };
}

function writeRange(v) {
  if (!RANGE_KEYS.includes(v) || v === storedRange) return;
  storedRange = v;
  try { window.localStorage.setItem(STORAGE_KEY, v); } catch { /* not persisted — still applies */ }
  rangeListeners.forEach((cb) => cb());
}

/* ── Fetch ── */
async function getJson(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal, cache: 'no-store', headers: { accept: 'application/json' } });
  } catch (err) {
    if (signal.aborted) throw err;
    throw Object.assign(new Error('Network error — check your connection.'), { status: 0 });
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok || !body?.success) {
    throw Object.assign(new Error(body?.message || `Request failed (${res.status})`), { status: res.ok ? 500 : res.status });
  }
  return body.data || {};
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const newer = (prev, next) => (prev && next && String(prev.generatedAt || '') > String(next.generatedAt || '') ? prev : next);

export function useAnalytics() {
  const range = useSyncExternalStore(subscribeRange, readRange, serverRange);
  const [tick, setTick] = useState(0);
  const [report, setReport] = useState(null);
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);
  const [finished, setFinished] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  /* Touched only from callbacks, never during render. */
  const lastFullAt = useRef(0);
  const authBlocked = useRef(false);
  const rangeRef = useRef(range);
  useEffect(() => { rangeRef.current = range; }, [range]);

  const wanted = `${range}:${tick}`;
  const loading = finished !== wanted;

  /* Full load: live + report for the range. */
  useEffect(() => {
    const ctrl = new AbortController();
    const key = `${range}:${tick}`;
    getJson(`/api/admin/analytics?range=${encodeURIComponent(range)}`, ctrl.signal)
      .then((data) => {
        if (ctrl.signal.aborted) return;
        lastFullAt.current = Date.now();
        authBlocked.current = false;
        setReport(data.report || null);
        if (data.live) setLive((prev) => newer(prev, data.live));
        setError(null);
        setUpdatedAt(new Date());
        setFinished(key);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        authBlocked.current = err.status === 401 || err.status === 403;
        setError({ status: err.status ?? 0, message: err.message || 'Something went wrong.' });
        setFinished(key);
      });
    return () => ctrl.abort();
  }, [range, tick]);

  /* Background timers, visible tab only: live every 15 s; the full report
     every 60 s for Today, every 5 minutes for the other ranges. */
  useEffect(() => {
    let liveCtrl = null;
    const pollLive = () => {
      if (!isVisible() || authBlocked.current) return;
      liveCtrl?.abort();
      const ctrl = new AbortController();
      liveCtrl = ctrl;
      getJson('/api/admin/analytics?part=live', ctrl.signal)
        .then((data) => {
          if (ctrl.signal.aborted || !data.live) return;
          setLive((prev) => newer(prev, data.live));
          setUpdatedAt(new Date());
        })
        .catch(() => { /* next poll retries; full loads surface errors */ });
    };
    const due = () => !lastFullAt.current || Date.now() - lastFullAt.current >= fullEvery(rangeRef.current) - 1_000;
    const refreshIfVisible = () => { if (isVisible() && !authBlocked.current && due()) setTick((t) => t + 1); };
    const onVisibility = () => {
      if (!isVisible()) return;
      if (due()) refreshIfVisible();
      else pollLive();
    };
    const liveTimer = setInterval(pollLive, LIVE_MS);
    const fullTimer = setInterval(refreshIfVisible, FULL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(liveTimer);
      clearInterval(fullTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      liveCtrl?.abort();
    };
  }, []);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { range, setRange: writeRange, report, live, error, loading, updatedAt, refresh };
}
