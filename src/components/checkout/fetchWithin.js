/* ─────────────────────────────────────────────
   fetch with a deadline. A request that stalls (a mobile network that
   neither answers nor fails) would otherwise hold whatever waits on it,
   e.g. "Place order" while the coupon is checked, until the browser gives
   up on the connection, which can take minutes.

   fetchJsonWithin(url, init, { ms, fetchImpl })
     → { res, data }   data is null when the body isn't JSON
     ✗ TimeoutError    no complete answer (headers and body) within `ms`;
                       the request is aborted where the browser can
     ✗ the network error, as fetch throws it

   Pure module (no React, no app imports): safe in tests.
   ───────────────────────────────────────────── */

export class TimeoutError extends Error {
  constructor(ms) {
    super(`No answer within ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export async function fetchJsonWithin(url, init = {}, { ms, fetchImpl } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new TypeError('fetch is unavailable');
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(ms));
      try { ctrl?.abort(); } catch { /* nothing to abort */ }
    }, ms);
  });
  const work = (async () => {
    const res = await doFetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
    let data = null;
    try { data = await res.json(); } catch { /* not JSON (proxy/edge error page) */ }
    return { res, data };
  })();
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    /* Lost the race (aborted after the deadline): nobody waits for it. */
    work.catch(() => {});
  }
}
