/* ─────────────────────────────────────────────
   Visitor analytics — reporting for /admin/analytics and the CSV export.

   Every number comes from cheap, index-free reads:
     • analytics_daily shards for the range (≤ 4 docs per day)
     • analytics_sessions with lastSeenAt in the last 5 min (live feed)
     • analytics_sessions with cartDay == today (live cart abandonment)
     • count() on analytics_visitors.lastSeenAt / lastSeenAtReg (unique
       visitors over 7 / 30 days — a daily sum would count a returning
       visitor once per day)
     • orders created in the range (conversion: real orders, not events)
   All are single-field filters, so no composite index is needed.

   Takes `db` (firebase-admin Firestore or the test fake).
   ───────────────────────────────────────────── */
import { istDateKey, istStartOfDay } from '@/lib/siteVisits';
import { CHANNELS, DEVICES, OSES, BROWSERS, regionLabel, decodeKey } from './classify.js';
import { LIVE_WINDOW_MS, SESSION_IDLE_MS } from './ingest.js';

export const RANGES = Object.freeze({ today: 'Today', yesterday: 'Yesterday', '7d': 'Last 7 days', '30d': 'Last 30 days' });
const DAY_MS = 86_400_000;
const LIVE_LIMIT = 200;
const CART_LIMIT = 2000;
const ORDER_LIMIT = 10_000;

/* ── Ranges (IST calendar days) ── */
export function rangeBounds(range, now = new Date()) {
  const r = Object.hasOwn(RANGES, range) ? range : 'today';
  const nowMs = now.getTime();
  const todayStart = istStartOfDay(now);
  if (r === 'today') return { range: r, label: RANGES[r], dateKeys: [istDateKey(now)], start: todayStart, end: now, includesToday: true };
  if (r === 'yesterday') {
    const y = new Date(nowMs - DAY_MS);
    return { range: r, label: RANGES[r], dateKeys: [istDateKey(y)], start: istStartOfDay(y), end: todayStart, includesToday: false };
  }
  const n = r === '7d' ? 7 : 30;
  const dateKeys = [];
  for (let i = n - 1; i >= 0; i -= 1) dateKeys.push(istDateKey(new Date(nowMs - i * DAY_MS)));
  return { range: r, label: RANGES[r], dateKeys, start: istStartOfDay(new Date(nowMs - (n - 1) * DAY_MS)), end: now, includesToday: true };
}

/* ── Rollups ── */
/** Deep-sums numeric leaves of several shard docs. */
export function mergeRollups(docs) {
  const out = {};
  const add = (target, src) => {
    for (const [k, v] of Object.entries(src || {})) {
      if (k === 'dateKey') continue;
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (typeof target[k] === 'object') continue;
        target[k] = (target[k] || 0) + v;
      } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if (typeof target[k] === 'number') continue;
        add((target[k] ||= {}), v);
      }
    }
  };
  for (const d of docs) add(out, d);
  return out;
}

export async function readDaily(db, dateKeys) {
  const snap = await db.collection('analytics_daily')
    .where('dateKey', '>=', dateKeys[0])
    .where('dateKey', '<=', dateKeys[dateKeys.length - 1])
    .get();
  const perDay = new Map(dateKeys.map((k) => [k, []]));
  for (const d of snap.docs) {
    const data = d.data();
    if (perDay.has(data.dateKey)) perDay.get(data.dateKey).push(data);
  }
  const days = dateKeys.map((k) => ({ dateKey: k, ...mergeRollups(perDay.get(k)) }));
  return { days, total: mergeRollups(days) };
}

/** count() aggregation; falls back to a capped read (the test fake has no count()). */
export async function countOf(query, cap = 20_000) {
  if (typeof query.count === 'function') {
    try {
      const s = await query.count().get();
      return { n: s.data().count, exact: true };
    } catch (err) {
      console.error('[analytics] count() failed, falling back:', err.message);
    }
  }
  const s = await query.limit(cap).get();
  return { n: s.size, exact: s.size < cap };
}

/* ── Small helpers ── */
const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const money = (v) => Math.round(n0(v) * 100) / 100;
const shortVid = (vid) => (typeof vid === 'string' ? vid.replace(/^tj_vid_/, '').slice(0, 8) : '');
const secondsBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000) || 0);

function stageOf(s) {
  if (s.purchased) return 'paid';
  if (s.reachedCheckout) return 'checkout';
  if (s.addedToCart) return 'cart';
  if (s.triedOn) return 'tryon';
  if (s.viewedProduct) return 'product';
  return 'browsing';
}

/** Breakdown map → sorted rows, limited to known keys when `known` is given. */
function breakdown(map, { known = null, label = (k) => k, limit = 50 } = {}) {
  const entries = Object.entries(map || {}).filter(([k, v]) => n0(v) > 0 && (!known || known.includes(k)));
  const total = entries.reduce((a, [, v]) => a + n0(v), 0);
  return entries
    .map(([key, v]) => ({ key, label: label(key), count: n0(v), share: pct(n0(v), total) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function namesFor(db, userIds) {
  const ids = [...new Set(userIds.filter((id) => typeof id === 'string' && id))].slice(0, 100);
  const snaps = await Promise.all(ids.map((id) => db.collection('users').doc(id).get().catch(() => null)));
  const out = new Map();
  snaps.forEach((s, i) => { if (s?.exists) out.set(ids[i], String(s.data().name || '').slice(0, 60)); });
  return out;
}

/* ── Live: who is on the site right now ── */
export async function liveReport(db, now = new Date()) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const since = new Date(nowMs - LIVE_WINDOW_MS).toISOString();
  const todayKey = istDateKey(now);
  const idleCutoff = new Date(nowMs - SESSION_IDLE_MS).toISOString();

  const liveQ = db.collection('analytics_sessions').where('lastSeenAt', '>=', since);
  const [liveSnap, cartSnap] = await Promise.all([
    liveQ.orderBy('lastSeenAt', 'desc').limit(LIVE_LIMIT).get(),
    db.collection('analytics_sessions').where('cartDay', '==', todayKey).limit(CART_LIMIT).get(),
  ]);
  const live = liveSnap.docs.map((d) => d.data());
  let activeVisitors = new Set(live.map((s) => s.vid)).size;
  if (live.length >= LIVE_LIMIT) activeVisitors = Math.max(activeVisitors, (await countOf(liveQ)).n);

  /* Carts: still shopping (seen in the last 30 min) vs abandoned today. */
  /* One cart per browser: its most recent visit today. */
  const latestByVid = new Map();
  for (const s of cartSnap.docs.map((d) => d.data())) {
    const cur = latestByVid.get(s.vid);
    if (!cur || String(s.lastSeenAt) > String(cur.lastSeenAt)) latestByVid.set(s.vid, s);
  }
  const carts = [...latestByVid.values()].filter((s) => n0(s.cartItems) > 0 && !s.purchased);
  const abandoned = carts.filter((s) => s.lastSeenAt < idleCutoff);
  const open = carts.filter((s) => s.lastSeenAt >= idleCutoff);

  const names = await namesFor(db, [...live, ...abandoned].map((s) => s.userId));
  const visitorRow = (s) => ({
    sid: s.sid,
    visitor: shortVid(s.vid),
    ip: s.ipMasked || '',
    registered: !!s.userId,
    name: s.userId ? names.get(s.userId) || 'Customer' : '',
    city: s.city || '',
    region: s.region || regionLabel(s.regionKey),
    country: s.country || '',
    device: s.device || '', os: s.os || '', browser: s.browser || '',
    channel: s.channel || 'direct',
    channelLabel: CHANNELS[s.channel] || 'Direct',
    source: s.source || '',
    campaign: s.campaign || '',
    landingPath: s.landingPath || '',
    currentPath: s.currentPath || '',
    pageviews: n0(s.pageviews),
    activeSeconds: n0(s.activeSeconds),
    /* Wall-clock since the first page, but never less than measured active
       time (a visit's first batch can carry a heartbeat already). */
    durationSeconds: Math.max(secondsBetween(s.startedAt, s.lastSeenAt), n0(s.activeSeconds)),
    startedAt: s.startedAt, lastSeenAt: s.lastSeenAt,
    cartItems: n0(s.cartItems), cartValue: money(s.cartValue),
    stage: stageOf(s),
  });

  return {
    generatedAt: nowIso,
    activeVisitors,
    activeRegistered: new Set(live.filter((s) => s.userId).map((s) => s.vid)).size,
    sessions: live.slice(0, 60).map(visitorRow),
    carts: {
      abandoned: abandoned.length,
      abandonedValue: money(abandoned.reduce((a, s) => a + n0(s.cartValue), 0)),
      open: open.length,
      openValue: money(open.reduce((a, s) => a + n0(s.cartValue), 0)),
      recent: abandoned.sort((a, b) => n0(b.cartValue) - n0(a.cartValue)).slice(0, 10).map(visitorRow),
    },
  };
}

/* ── Range report ── */
async function uniqueVisitors(db, bounds, total) {
  /* One IST day: the rollup's "first time today" counter is exact. */
  if (bounds.dateKeys.length === 1) {
    const visitors = n0(total.visitors);
    const registered = Math.min(visitors, n0(total.registered));
    return { visitors, registered, guests: Math.max(0, visitors - registered), newVisitors: n0(total.newVisitors), exact: true };
  }
  /* Several days, ending now: a visitor seen since `start` has lastSeenAt ≥ start. */
  const col = db.collection('analytics_visitors');
  const startIso = bounds.start.toISOString();
  const [all, reg] = await Promise.all([
    countOf(col.where('lastSeenAt', '>=', startIso)),
    countOf(col.where('lastSeenAtReg', '>=', startIso)),
  ]);
  const visitors = all.n;
  const registered = Math.min(visitors, reg.n);
  return { visitors, registered, guests: Math.max(0, visitors - registered), newVisitors: n0(total.newVisitors), exact: all.exact && reg.exact };
}

/** Real orders in the range: paid online, or cash on delivery; not cancelled. */
async function ordersIn(db, bounds) {
  const snap = await db.collection('orders')
    .where('createdAt', '>=', bounds.start.toISOString())
    .where('createdAt', '<', bounds.end.toISOString())
    .select('createdAt', 'status', 'payment', 'total')
    .limit(ORDER_LIMIT)
    .get();
  let count = 0; let revenue = 0;
  for (const d of snap.docs) {
    const o = d.data();
    if (o.status === 'cancelled') continue;
    if (o.payment?.status !== 'paid' && o.payment?.method !== 'cod') continue;
    count += 1;
    revenue += n0(o.total);
  }
  return { count, revenue: money(revenue) };
}

async function topProducts(db, productsMap, limit = 10) {
  const rows = Object.entries(productsMap || {})
    .map(([id, m]) => ({ id, views: n0(m?.v), tryons: n0(m?.t), addToCarts: n0(m?.a) }))
    .filter((r) => r.views + r.tryons > 0)
    .sort((a, b) => (b.views + b.tryons) - (a.views + a.tryons) || b.addToCarts - a.addToCarts)
    .slice(0, limit);
  const snaps = await Promise.all(rows.map((r) => db.collection('products').doc(r.id).get().catch(() => null)));
  return rows.map((r, i) => {
    const p = snaps[i]?.exists ? snaps[i].data() : null;
    return {
      ...r,
      name: p ? String(p.name || 'Untitled') : 'Removed product',
      image: p && Array.isArray(p.images) && typeof p.images[0] === 'string' ? p.images[0] : null,
      price: p ? n0(p.discountPrice) || n0(p.price) : 0,
      category: p?.category || '',
      slug: p?.slug || null,
      tryonRate: pct(r.tryons, r.views),
      cartRate: pct(r.addToCarts, r.views),
    };
  });
}

export const FUNNEL_STEPS = Object.freeze([
  { key: 'sessions', label: 'Visited (Home / Catalog)', from: null },
  { key: 'product', label: 'Product detail', from: 'sessions' },
  { key: 'tryon', label: 'Virtual try-on', from: 'product', optional: true },
  { key: 'cart', label: 'Add to cart', from: 'product' },
  { key: 'checkout', label: 'Checkout', from: 'cart' },
  { key: 'paid', label: 'Paid / order placed', from: 'checkout' },
]);

export function funnelRows(f = {}) {
  const visits = n0(f.sessions);
  return FUNNEL_STEPS.map((s) => {
    const count = n0(f[s.key]);
    const prev = s.from ? n0(f[s.from]) : visits;
    return { key: s.key, label: s.label, optional: !!s.optional, count, ofVisits: pct(count, visits), ofPrevious: s.from ? pct(count, prev) : 100, dropOff: s.from ? Math.max(0, prev - count) : 0 };
  });
}

function seriesFor(bounds, days) {
  if (bounds.dateKeys.length === 1) {
    const hours = days[0]?.hours || {};
    return {
      unit: 'hour',
      points: Array.from({ length: 24 }, (_, h) => {
        const k = String(h).padStart(2, '0');
        return { key: k, label: `${k}:00`, sessions: n0(hours[k]?.s), pageviews: n0(hours[k]?.p) };
      }),
    };
  }
  return {
    unit: 'day',
    points: days.map((d) => ({
      key: d.dateKey, label: d.dateKey.slice(5), visitors: n0(d.visitors), sessions: n0(d.sessions),
      pageviews: n0(d.pageviews), orders: n0(d.orders), revenue: money(d.revenue),
    })),
  };
}

/**
 * Everything the dashboard shows for a range.
 * @param {object} db
 * @param {{ range?: string, now?: Date }} opts
 */
export async function rangeReport(db, { range = 'today', now = new Date() } = {}) {
  const bounds = rangeBounds(range, now);
  const { days, total } = await readDaily(db, bounds.dateKeys);
  const [visitors, orders, products] = await Promise.all([
    uniqueVisitors(db, bounds, total),
    ordersIn(db, bounds),
    topProducts(db, total.products),
  ]);

  const sessions = n0(total.sessions);
  const funnel = total.funnel || {};
  const channelOrders = total.ordersByChannel || {};
  const channelRevenue = total.revenueByChannel || {};
  const sources = breakdown(total.channels, { known: Object.keys(CHANNELS), label: (k) => CHANNELS[k] })
    .map((r) => ({ ...r, orders: n0(channelOrders[r.key]), revenue: money(channelRevenue[r.key]), conversion: pct(n0(channelOrders[r.key]), r.count) }));

  return {
    generatedAt: now.toISOString(),
    range: bounds.range,
    label: bounds.label,
    from: bounds.dateKeys[0],
    to: bounds.dateKeys[bounds.dateKeys.length - 1],
    visitors,
    kpis: {
      sessions,
      pageviews: n0(total.pageviews),
      pagesPerSession: sessions ? Math.round((n0(total.pageviews) / sessions) * 10) / 10 : 0,
      avgActiveSeconds: sessions ? Math.round(n0(total.activeSeconds) / sessions) : 0,
      engagedSessions: n0(total.engaged),
      bounceRate: sessions ? Math.round((1 - n0(total.engaged) / sessions) * 1000) / 10 : 0,
      productViews: n0(total.productViews),
      tryons: n0(total.tryons),
      addToCarts: n0(total.addToCarts),
      checkouts: n0(total.checkouts),
      orders: orders.count,
      revenue: orders.revenue,
      trackedOrders: n0(total.orders),
      conversionRate: pct(orders.count, visitors.visitors),
      cartAbandonmentRate: n0(funnel.cart) ? Math.round((1 - Math.min(n0(funnel.paid), n0(funnel.cart)) / n0(funnel.cart)) * 1000) / 10 : 0,
    },
    funnel: funnelRows(funnel),
    sources,
    devices: breakdown(total.devices, { known: DEVICES }),
    os: breakdown(total.os, { known: OSES }),
    browsers: breakdown(total.browsers, { known: BROWSERS }),
    regions: breakdown(total.regions, { label: regionLabel, limit: 12 }),
    pages: breakdown(total.pages, { label: decodeKey, limit: 12 }),
    tryon: {
      opens: n0(total.tryons),
      modes: breakdown(total.tryonModes, { known: ['ai', 'live'], label: (k) => (k === 'ai' ? 'AI model' : 'Live camera') }),
      tones: breakdown(total.tones, { known: ['fair', 'wheatish', 'dusky', 'bronze'], label: (k) => k[0].toUpperCase() + k.slice(1) }),
    },
    topProducts: products,
    series: seriesFor(bounds, days),
  };
}

/* ── CSV export ── */
const IST_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
export function toIst(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return IST_FMT.format(new Date(t)).replace(', ', ' ');
}

/** One CSV cell. Text that a spreadsheet would run as a formula is defused. */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r|%]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells) => cells.map(csvCell).join(',');

export const EXPORT_LIMITS = Object.freeze({ sessions: 20_000, events: 50_000 });

const SESSION_COLUMNS = [
  ['session_id', (s) => s.sid], ['visitor_id', (s) => s.vid], ['customer_id', (s) => s.userId || ''], ['visitor_type', (s) => (s.userId ? 'registered' : 'guest')],
  ['date', (s) => s.dateKey], ['started_ist', (s) => toIst(s.startedAt)], ['last_seen_ist', (s) => toIst(s.lastSeenAt)],
  ['channel', (s) => CHANNELS[s.channel] || s.channel], ['source', (s) => s.source], ['medium', (s) => s.medium], ['campaign', (s) => s.campaign],
  ['referrer_host', (s) => s.refHost], ['landing_page', (s) => s.landingPath], ['last_page', (s) => s.currentPath],
  ['device', (s) => s.device], ['os', (s) => s.os], ['browser', (s) => s.browser],
  ['city', (s) => s.city], ['state', (s) => s.region], ['country', (s) => s.country], ['ip_masked', (s) => s.ipMasked],
  ['pageviews', (s) => n0(s.pageviews)], ['active_seconds', (s) => n0(s.activeSeconds)], ['duration_seconds', (s) => secondsBetween(s.startedAt, s.lastSeenAt)],
  ['viewed_product', (s) => !!s.viewedProduct], ['tried_on', (s) => !!s.triedOn], ['added_to_cart', (s) => !!s.addedToCart],
  ['reached_checkout', (s) => !!s.reachedCheckout], ['purchased', (s) => !!s.purchased], ['order_numbers', (s) => (s.orderNumbers || []).join(' ')],
  ['revenue', (s) => money(s.revenue)], ['cart_items', (s) => n0(s.cartItems)], ['cart_value', (s) => money(s.cartValue)],
];
const EVENT_COLUMNS = [
  ['time_ist', (e) => toIst(e.at)], ['event', (e) => e.type], ['visitor_id', (e) => e.vid], ['session_id', (e) => e.sid], ['customer_id', (e) => e.userId || ''],
  ['page', (e) => e.path], ['product_id', (e) => e.productId || ''], ['product_name', (e) => e.productName || ''], ['qty', (e) => e.qty ?? ''],
  ['tryon_mode', (e) => e.mode || ''], ['skin_tone', (e) => e.tone || ''], ['order_number', (e) => e.orderNumber || ''],
  ['channel', (e) => CHANNELS[e.channel] || e.channel || ''], ['device', (e) => e.device || ''], ['region', (e) => regionLabel(e.regionKey)],
];

/**
 * Raw visitor data for a range as CSV text.
 * @returns {Promise<{ csv: string, rows: number, truncated: boolean, filename: string }>}
 */
export async function exportCsv(db, { range = 'today', type = 'sessions', now = new Date() } = {}) {
  const bounds = rangeBounds(range, now);
  const kind = type === 'events' ? 'events' : 'sessions';
  const cap = EXPORT_LIMITS[kind];
  const columns = kind === 'events' ? EVENT_COLUMNS : SESSION_COLUMNS;
  const snap = await db.collection(kind === 'events' ? 'analytics_events' : 'analytics_sessions')
    .where('dateKey', '>=', bounds.dateKeys[0])
    .where('dateKey', '<=', bounds.dateKeys[bounds.dateKeys.length - 1])
    .limit(cap + 1)
    .get();
  const docs = snap.docs.slice(0, cap).map((d) => d.data());
  const timeKey = kind === 'events' ? 'at' : 'startedAt';
  docs.sort((a, b) => String(a[timeKey] || '').localeCompare(String(b[timeKey] || '')));
  const lines = [csvLine(columns.map(([h]) => h)), ...docs.map((d) => csvLine(columns.map(([, get]) => get(d))))];
  return {
    /* BOM so Excel opens ₹ and Tamil city names as UTF-8. */
    csv: `﻿${lines.join('\r\n')}\r\n`,
    rows: docs.length,
    truncated: snap.docs.length > cap,
    filename: `tulsi-${kind}-${bounds.dateKeys[0]}${bounds.dateKeys.length > 1 ? `_to_${bounds.dateKeys[bounds.dateKeys.length - 1]}` : ''}.csv`,
  };
}
