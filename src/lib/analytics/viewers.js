/* ─────────────────────────────────────────────
   Visitor analytics — "N people are viewing this right now".

   Honest social proof from our own visitor analytics, never a made-up or
   randomised figure: the number of OTHER browsers (distinct tj_vid) whose
   current page (analytics_sessions.currentPath, written by ingestBatch) is
   this page and that were seen within the live window (the same 5 minutes
   the admin dashboard's "live" view uses).

   Cost: one query per server instance every 30 s, shared by every product —
     analytics_sessions where lastSeenAt >= now − 5 min
                        orderBy lastSeenAt desc · limit 500
   (single-field index, no composite needed; currentPath is not indexed, so
   it's matched here, in memory). Only vid / sid / currentPath / lastSeenAt
   are fetched. With more than 500 live sessions the least recent ones are
   left out — the count can only come out low, never high.

   Takes `db` (firebase-admin Firestore or the test fake).
   ───────────────────────────────────────────── */
import { LIVE_WINDOW_MS } from './ingest.js';

export const VIEWERS_WINDOW_MS = LIVE_WINDOW_MS;
export const VIEWERS_CACHE_MS = 30_000;
export const VIEWERS_SCAN_LIMIT = 500;

/* "/product/abc/" and "/product/abc" are the same page. */
const normPath = (p) => (typeof p === 'string' ? p.replace(/\/+$/, '') : '');

/* One snapshot of the live sessions per instance, keyed by the db and the
   time it was taken (the caller's `now`, so tests control time). In-flight
   reads are shared: a burst of product pages costs one query. */
let cache = null; // { db, at, promise }
export function _resetViewersCache() { cache = null; }

async function readLiveSessions(db, nowMs) {
  const since = new Date(nowMs - VIEWERS_WINDOW_MS).toISOString();
  const snap = await db.collection('analytics_sessions')
    .where('lastSeenAt', '>=', since)
    .orderBy('lastSeenAt', 'desc')
    .select('vid', 'sid', 'currentPath', 'lastSeenAt')
    .limit(VIEWERS_SCAN_LIMIT)
    .get();
  return snap.docs.map((d) => {
    const s = d.data() || {};
    return { sid: String(s.sid || d.id || ''), vid: String(s.vid || ''), path: normPath(s.currentPath), lastSeenAt: String(s.lastSeenAt || '') };
  });
}

function liveSessions(db, nowMs) {
  const fresh = cache && cache.db === db && nowMs >= cache.at && nowMs - cache.at < VIEWERS_CACHE_MS;
  if (fresh) return cache.promise;
  const entry = { db, at: nowMs, promise: readLiveSessions(db, nowMs) };
  cache = entry;
  /* A failed read isn't kept: the next request tries again. */
  entry.promise.catch(() => { if (cache === entry) cache = null; });
  return entry.promise;
}

/**
 * How many other people are on `path` right now.
 * @param {object} db
 * @param {string} path  e.g. "/product/abc123"
 * @param {{ now?: Date, excludeSid?: string|null, excludeVid?: string|null }} [opts]
 *   excludeSid — the requester's own visit (tj_sid); their browser (its vid)
 *   is left out too, so a second session of theirs never counts.
 * @returns {Promise<number>} distinct browsers, excluding the requester
 */
export async function viewersOnPage(db, path, { now = new Date(), excludeSid = null, excludeVid = null } = {}) {
  const target = normPath(path);
  if (!target) return 0;
  const nowMs = now.getTime();
  const sessions = await liveSessions(db, nowMs);
  /* The snapshot may be up to 30 s old: re-apply the window from `now`. */
  const since = new Date(nowMs - VIEWERS_WINDOW_MS).toISOString();

  const own = new Set(excludeVid ? [excludeVid] : []);
  if (excludeSid) {
    const mine = sessions.find((s) => s.sid === excludeSid);
    if (mine?.vid) own.add(mine.vid);
  }

  const vids = new Set();
  for (const s of sessions) {
    if (s.path !== target || s.lastSeenAt < since) continue;
    if (!s.vid || own.has(s.vid) || (excludeSid && s.sid === excludeSid)) continue;
    vids.add(s.vid);
  }
  return vids.size;
}
