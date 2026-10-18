'use client';

/* "N people are viewing this right now" — the real count of OTHER visitors
   on this product page in the last few minutes, from our own visitor
   analytics (GET /api/products/[id]/viewers). Never a made-up number: it
   shows nothing unless at least two other people are really here.

   Light: one request ~1.5 s after mount (when the browser is idle), then
   one a minute while the tab is visible — none while it's hidden. Renders
   inline in the badges row, so nothing is reserved while it's hidden. */
import { useEffect, useState } from 'react';
import { FiEye } from 'react-icons/fi';

const FIRST_DELAY_MS = 1500;
const POLL_MS = 60_000;
const MIN_SHOWN = 2;

export default function LiveViewersBadge({ productId }) {
  /* Tagged with the product, so a client-side move to another piece never
     shows the previous piece's count. */
  const [seen, setSeen] = useState({ id: null, viewing: 0 });

  useEffect(() => {
    if (!productId) return undefined;
    let alive = true;
    let timer = null;
    let idle = null;
    let waitingForVisible = false;
    const ctrl = new AbortController();
    const visible = () => document.visibilityState === 'visible';

    async function load() {
      try {
        const res = await fetch(`/api/products/${encodeURIComponent(productId)}/viewers`, { signal: ctrl.signal });
        const d = await res.json();
        const viewing = Math.max(0, Math.floor(Number(d?.data?.viewing) || 0));
        if (alive) setSeen({ id: productId, viewing });
      } catch { /* offline or aborted: keep what's shown */ }
      if (alive) timer = setTimeout(tick, POLL_MS);
    }
    function tick() {
      timer = null;
      if (visible()) load();
      else waitingForVisible = true;
    }
    function onVisibility() {
      if (waitingForVisible && visible()) { waitingForVisible = false; load(); }
    }

    timer = setTimeout(() => {
      timer = null;
      if (!visible()) { waitingForVisible = true; return; }
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(load, { timeout: 2000 });
      else load();
    }, FIRST_DELAY_MS);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      ctrl.abort();
      if (timer) clearTimeout(timer);
      if (idle !== null) window.cancelIdleCallback?.(idle);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [productId]);

  const viewing = seen.id === productId ? seen.viewing : 0;
  if (viewing < MIN_SHOWN) return null;
  return (
    <span role="status" aria-live="polite" aria-atomic="true" className="inline-flex items-center gap-1.5 py-1 text-xs text-stone-500">
      <FiEye aria-hidden="true" className="text-stone-400 flex-shrink-0" />
      {viewing} people are viewing this right now
    </span>
  );
}
