/* ─────────────────────────────────────────────
   Visitor analytics — ingestion. Every visitor counts: guests and
   signed-in customers alike.

   Collections
     analytics_visitors/{vid}       one per browser (HttpOnly tj_vid cookie)
     analytics_sessions/{sid}       one per visit: 30 min idle timeout,
                                    split at IST midnight; source, device,
                                    geo, funnel flags, live cart
     analytics_events/{auto}        raw meaningful events (TTL expireAt)
     analytics_daily/{date}_{n}     pre-summed counters, sharded across
                                    SHARDS docs so a busy minute never hits
                                    Firestore's ~1 write/s/document limit
     analytics_totals/{n}           all-time counters (same sharding)
     analytics_seen/{date}_{vid}    "already counted today" marker (TTL)
     analytics_orders/{orderNo}     "purchase already counted" marker

   One transaction per batch: reads the visitor, the session, today's
   marker, purchase markers and (for customers) the user doc; then writes
   everything. Retried batches are de-duplicated by their (tab, n) id,
   remembered on the session — order-independent, so a late fetch and an
   unload beacon can arrive either way round.

   Takes `db` (firebase-admin Firestore or the test fake).
   ───────────────────────────────────────────── */
import crypto from 'crypto';
import { FieldValue } from '@/lib/firebase';
import { istDateKey } from '@/lib/siteVisits';
import { classifySource, routeKey, encodeKey, isProductId, parseUserAgent, cleanPath } from './classify.js';
import { cartTotals, MAX_ACTIVE_PER_BEAT } from './events.js';

export const SHARDS = 8;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const LIVE_WINDOW_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const EVENT_TTL_DAYS = 180;
const SESSION_TTL_DAYS = 400;
/* Batch ids remembered per session for de-duplication. */
const RECENT_BATCHES = 60;

export const VID_RE = /^tj_vid_[A-Za-z0-9_-]{20,40}$/;
export const SID_RE = /^tj_sid_[A-Za-z0-9_-]{20,40}$/;
export const newVisitorId = () => `tj_vid_${crypto.randomBytes(16).toString('base64url')}`;
export const newSessionId = () => `tj_sid_${crypto.randomBytes(16).toString('base64url')}`;

/* A browser's first requests carry no cookie until the first response sets
   one — and a beacon sent while that response is still on its way, or a
   retry of a lost first batch, would otherwise each become a new visitor.
   So a cookie-less request gets an id derived from its page load (the
   tracker's random tab id) plus UA and masked IP: every request from one
   page load lands on the same visitor, the transactions serialise on its
   doc, and the later ones continue (or de-duplicate into) the first visit.
   The tab id is random per page load and never leaves that page, so this
   links nothing across page loads. */
const ID_SECRET = process.env.ANALYTICS_ID_SECRET || process.env.NEXTAUTH_SECRET || 'tulsi-analytics';
export function derivedVisitorId(tab, ctx = {}) {
  const mac = crypto.createHmac('sha256', ID_SECRET).update(`v1:${tab}:${ctx.ua || ''}:${ctx.ipMasked || ''}`).digest('base64url');
  return `tj_vid_${mac.slice(0, 22)}`;
}

/** A cookie's value from a NextRequest or a plain Request. */
export function cookieFrom(request, name) {
  const v = request?.cookies?.get?.(name)?.value;
  if (v) return v;
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(request?.headers?.get?.('cookie') || '');
  return m ? m[1] : '';
}

/** This browser's analytics id from the request cookie (orders keep it so
 *  a purchase can be credited to the visit that led to it), or null. */
export function analyticsVidFrom(request) {
  const v = cookieFrom(request, 'tj_vid');
  return VID_RE.test(v) ? v : null;
}

/* Raw events worth keeping for the CSV export (heartbeats are not). */
const STORED_EVENTS = new Set(['page_view', 'product_view', 'tryon_open', 'tryon_mode', 'tryon_tone', 'add_to_cart', 'remove_from_cart', 'checkout_start', 'purchase']);

/* ── Small per-instance caches (best effort; serverless instances are short-lived) ──
   Real products and unknown ids are cached apart, so a flood of random ids
   can't push the real catalogue out. */
const productCache = new Map();
const missCache = new Map();
const PRODUCT_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 5000;
export function _resetCaches() { productCache.clear(); missCache.clear(); }

function toProductInfo(id, snap) {
  const p = snap?.exists ? snap.data() : null;
  if (!p) return null;
  const stock = Number(p.stock);
  return {
    id,
    name: String(p.name || '').slice(0, 120),
    slug: p.slug || null,
    image: Array.isArray(p.images) && typeof p.images[0] === 'string' ? p.images[0] : null,
    price: Number(p.discountPrice) || Number(p.price) || 0,
    category: typeof p.category === 'string' && /^[a-z0-9-]{1,40}$/.test(p.category) ? p.category : null,
    stock: Number.isFinite(stock) ? stock : null,
    /* On sale in the shop (same test as the public product list). */
    sellable: p.isActive !== false && p.showMe !== false,
  };
}

/** Name / category / price / image of real products (unknown ids are left
 *  out). Keeps rollup keys bounded to the catalogue and prices honest. One
 *  round trip for every id not already cached. */
async function productInfos(db, ids, nowMs) {
  const out = new Map();
  const misses = [];
  for (const id of ids) {
    if (!isProductId(id)) continue;
    const hit = productCache.get(id);
    if (hit && nowMs - hit.at < PRODUCT_TTL_MS) { out.set(id, hit.data); continue; }
    const miss = missCache.get(id);
    if (miss && nowMs - miss < PRODUCT_TTL_MS) continue;
    misses.push(id);
  }
  if (misses.length) {
    const refs = misses.map((id) => db.collection('products').doc(id));
    const snaps = typeof db.getAll === 'function' ? await db.getAll(...refs) : await Promise.all(refs.map((r) => r.get()));
    snaps.forEach((snap, i) => {
      const data = toProductInfo(misses[i], snap);
      if (data) {
        if (productCache.size >= CACHE_MAX) productCache.clear();
        productCache.set(misses[i], { at: nowMs, data });
        out.set(misses[i], data);
      } else {
        if (missCache.size >= CACHE_MAX) missCache.clear();
        missCache.set(misses[i], nowMs);
      }
    });
  }
  return out;
}

/* ── Rollup helpers: a nested object of increments ── */
function bump(target, path, n = 1) {
  if (!n) return;
  let o = target;
  for (let i = 0; i < path.length - 1; i += 1) o = (o[path[i]] ||= {});
  const k = path[path.length - 1];
  o[k] = (o[k] || 0) + n;
}
/** { a: 1, b: { c: 2 } } → same shape with FieldValue.increment leaves. */
function toIncrements(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'number' ? FieldValue.increment(v) : toIncrements(v);
  return out;
}

const TOTAL_FIELDS = Object.freeze(['sessions', 'pageviews', 'newVisitors', 'orders', 'revenue']);

const FUNNEL_FLAGS = Object.freeze([
  ['viewedProduct', 'product'], ['triedOn', 'tryon'], ['addedToCart', 'cart'], ['reachedCheckout', 'checkout'], ['purchased', 'paid'],
]);

/* Per-batch limits. A real tracker batch carries a page or two and a few
   actions; a crafted 30-event batch must not count (or cost) 30 times. */
const MAX_EVENT_PRODUCTS = 10;
/* Cart lines priced per batch (jewellery carts hold a handful of pieces). */
const MAX_CART_LINES = 12;
const MAX_CLAIMS_PER_BATCH = 2;
const MAX_PAGEVIEWS_PER_BATCH = 10;
/* Shopping actions counted per batch, across all products. */
const MAX_PER_BATCH = Object.freeze({ product_view: 5, tryon_open: 5, add_to_cart: 6 });
const MAX_ADDS_PER_PRODUCT_PER_BATCH = 3;
const MAX_STORED_PER_BATCH = 10;
/* Products a session has opened try-on for (one try-on per product per visit). */
const MAX_TRIED_PRODUCTS = 30;
/* Heartbeat seconds wait on the session and reach the shared daily counters
   together with other counts, every minute, or when the tab hides — so
   someone quietly reading doesn't write the shard docs every 30 seconds. */
const ACTIVE_FLUSH_SECONDS = 60;

/** Cart snapshot rows → [{ id, qty }] merged by product id (quantities
 *  summed, at most 99), sorted, at most MAX_CART_LINES lines. */
function mergeCartLines(items) {
  const byId = new Map();
  for (const i of items) byId.set(i.id, Math.min(99, (byId.get(i.id) || 0) + i.qty));
  return [...byId.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_CART_LINES).map(([id, qty]) => ({ id, qty }));
}

/* One transaction attempt, plus one quick retry on contention or a blip.
   (The SDK default is 5 attempts with long back-offs — far too slow for a
   beacon; anything else fails fast and the tracker resends later.) */
const RETRYABLE = new Set([10, 14]); // ABORTED, UNAVAILABLE
async function runTx(db, fn) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.runTransaction(fn, { maxAttempts: 1 });
    } catch (err) {
      if (attempt >= 1 || !RETRYABLE.has(err?.code)) throw err;
      await new Promise((r) => { setTimeout(r, 100 + crypto.randomInt(0, 200)); });
    }
  }
}

/**
 * Process one batch.
 * @param {object} db
 * @param {{
 *   vid?: string, sid?: string,
 *   user?: { id: string } | null,
 *   ctx: { ua: string, ip?: string, ipMasked?: string, geo: object, siteHost?: string, now?: Date },
 *   batch: { tab: string, n: number, final?: boolean, cart: object|null, events: object[] },
 * }} input
 * @returns {Promise<{ vid: string, sid: string, accepted: number, newSession: boolean, newVisitor: boolean }>}
 */
export async function ingestBatch(db, { vid: vidIn, sid: sidIn, user = null, ctx, batch }) {
  const now = ctx.now || new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const dateKey = istDateKey(now);
  const vid = VID_RE.test(vidIn || '') ? vidIn : derivedVisitorId(batch.tab, ctx);
  const sidCookie = SID_RE.test(sidIn || '') ? sidIn : null;
  const ua = parseUserAgent(ctx.ua);
  const registered = !!user?.id;
  const events = [...batch.events].sort((a, b) => a.seq - b.seq);
  const rawCart = batch.cart ? batch.cart.items : null;

  /* Reads that don't need the transaction, in parallel: the products named
     by events (bounded keys, CRM detail) — ten distinct, so repeats don't
     use up the budget — and at most two orders claimed by purchase events. */
  const productIds = [...new Set(events.map((e) => e.productId).filter(Boolean))].slice(0, MAX_EVENT_PRODUCTS);
  const claimNumbers = [...new Set(events.filter((e) => e.type === 'purchase' && e.orderNumber).map((e) => e.orderNumber))].slice(0, MAX_CLAIMS_PER_BATCH);
  const [products, claimSnaps] = await Promise.all([
    productInfos(db, productIds, nowMs),
    Promise.all(claimNumbers.map((no) => db.collection('orders').where('orderNumber', '==', no).limit(1).get())),
  ]);
  const purchaseClaims = [];
  claimSnaps.forEach((snap, i) => {
    const doc = snap.docs[0];
    if (!doc) return;
    const o = doc.data();
    /* Only the browser (or customer) that placed the order can claim it,
       and only within a day — a guessed order number counts for nothing. */
    const mine = (o.analyticsVid && o.analyticsVid === vid) || (registered && o.userId && o.userId === user.id);
    const recent = o.createdAt && nowMs - Date.parse(o.createdAt) < DAY_MS;
    const live = o.status !== 'cancelled';
    /* Paid online, or a cash-on-delivery order (paid at the door). */
    const placed = o.payment?.status === 'paid' || o.payment?.method === 'cod';
    if (mine && recent && live && placed) purchaseClaims.push({ orderNumber: claimNumbers[i], ref: doc.ref, total: Number(o.total) || 0 });
  });

  /* The cart snapshot as lines merged by product (a repeated id is one
     line), at most MAX_CART_LINES, in a stable order — and its signature,
     so an unchanged cart isn't re-priced on every batch. */
  const cartLines = rawCart ? mergeCartLines(rawCart) : null;
  const cartSig = cartLines ? cartLines.map((l) => `${l.id}:${l.qty}`).join(',') : null;

  const visitorsCol = db.collection('analytics_visitors');
  const sessionsCol = db.collection('analytics_sessions');
  const vRef = visitorsCol.doc(vid);
  const markRef = db.collection('analytics_seen').doc(`${dateKey}_${vid}`);
  const userRef = registered ? db.collection('users').doc(user.id) : null;
  const shard = crypto.randomInt(0, SHARDS);
  const shardRef = db.collection('analytics_daily').doc(`${dateKey}_${shard}`);
  const totalsRef = db.collection('analytics_totals').doc(String(shard));

  const result = await runTx(db, async (tx) => {
    const [vSnap, cookieSnap, mSnap, uSnap, ...orderMarks] = await Promise.all([
      tx.get(vRef),
      sidCookie ? tx.get(sessionsCol.doc(sidCookie)) : Promise.resolve(null),
      tx.get(markRef),
      userRef ? tx.get(userRef) : Promise.resolve(null),
      ...purchaseClaims.map((c) => tx.get(db.collection('analytics_orders').doc(c.orderNumber))),
    ]);

    const visitor = vSnap.exists ? vSnap.data() : null;
    /* The browser's previous visit: from the session cookie, or — once that
       cookie has expired, or when the first response never arrived — from
       the visitor record. Lets a retry be de-duplicated, a visit continue,
       and an old visit hand over its cart. */
    let prevSid = sidCookie;
    let sSnap = cookieSnap;
    if (!prevSid && visitor && SID_RE.test(visitor.lastSessionId || '')) {
      prevSid = visitor.lastSessionId;
      sSnap = await tx.get(sessionsCol.doc(prevSid));
    }
    const prev = sSnap?.exists ? sSnap.data() : null;
    const inc = {};

    /* ── Session: continue, or start a new one ── */
    const firstView = events.find((e) => e.type === 'page_view');
    const acq = classifySource({
      utm: firstView?.utm, referrer: firstView?.referrer, ua: ctx.ua, siteHost: ctx.siteHost, clickIds: firstView?.clickIds,
    });
    const taggedArrival = !!(firstView && (firstView.utm?.source || firstView.clickIds?.gclid || firstView.clickIds?.fbclid));
    const ownPrev = !!(prev && prev.vid === vid);
    const awake = ownPrev && nowMs - Date.parse(prev.lastSeenAt) < SESSION_IDLE_MS;
    /* A new tagged campaign click starts a new session (as GA does). */
    const newCampaign = ownPrev && taggedArrival && (acq.channel !== prev.channel || acq.campaign !== prev.campaign);
    const continues = awake && prev.dateKey === dateKey && !newCampaign;
    /* Split only because the IST date changed: the visit keeps its source. */
    const dateSplit = awake && prev.dateKey !== dateKey && !newCampaign;
    const src = dateSplit
      ? { channel: prev.channel, source: prev.source, medium: prev.medium, campaign: prev.campaign, content: prev.content, refHost: prev.refHost }
      : acq;
    const sid = continues ? prevSid : newSessionId();
    const sRef = sessionsCol.doc(sid);

    /* ── De-duplicate retried batches: (tab, n) already counted on this
       browser's last visit — even if a retry lands after midnight or after
       the visit went idle. ── */
    const batchId = `${batch.tab}:${batch.n}`;
    if (ownPrev && (prev.batchIds || []).includes(batchId)) {
      return { sid: prevSid, accepted: 0, newSession: false, newVisitor: false, stitched: false, duplicate: true };
    }

    /* ── The cart as the server prices it: products on sale, at their real
       price, no more pieces than are in stock — a crafted snapshot can't
       plant a crore-rupee "abandoned cart". Re-priced only when the cart
       changed since this visit's last batch. (A plain read, before any
       transaction write.) ── */
    let cart = null;
    if (cartLines && !(continues && prev.cartSig === cartSig)) {
      const info = await productInfos(db, cartLines.map((l) => l.id), nowMs);
      cart = {
        items: cartLines.filter((l) => info.get(l.id)?.sellable).map((l) => {
          const p = info.get(l.id);
          /* No more pieces than are in stock (when stock is recorded). */
          const qty = p.stock === null ? l.qty : Math.min(l.qty, Math.max(1, p.stock));
          return { id: l.id, name: p.name, qty, price: p.price };
        }),
      };
    }

    /* The previous visit is over: its cart travels with the shopper (so it
       isn't also an "abandoned cart"), and its saved-up active seconds go
       to that visit's own day. */
    if (!continues && ownPrev && (prev.cartDay || prev.pendingActive > 0)) {
      const close = {};
      if (prev.cartDay) close.cartDay = null;
      if (prev.pendingActive > 0) {
        close.pendingActive = 0;
        tx.set(db.collection('analytics_daily').doc(`${prev.dateKey}_${shard}`), { dateKey: prev.dateKey, activeSeconds: FieldValue.increment(prev.pendingActive) }, { merge: true });
      }
      tx.update(sessionsCol.doc(prevSid), close);
    }

    const s = continues ? { ...prev } : {
      sid, vid, dateKey,
      userId: registered ? user.id : (visitor?.userId || null),
      registered,
      startedAt: nowIso,
      channel: src.channel, source: src.source, medium: src.medium, campaign: src.campaign, content: src.content, refHost: src.refHost,
      landingPath: '', currentPath: '',
      device: ua.device, os: ua.os, browser: ua.browser,
      city: ctx.geo.city || '', region: ctx.geo.region || '', regionKey: ctx.geo.regionKey || 'unknown', country: ctx.geo.country || '',
      ipMasked: ctx.ipMasked || '',
      pageviews: 0, activeSeconds: 0, pendingActive: 0, events: 0,
      viewedProduct: false, triedOn: false, addedToCart: false, reachedCheckout: false, purchased: false, engaged: false,
      triedProducts: [],
      cartItems: 0, cartValue: 0, cartDay: null,
      orderNumbers: [], revenue: 0,
      batchIds: [],
      expireAt: new Date(nowMs + SESSION_TTL_DAYS * DAY_MS),
    };
    if (registered && !s.userId) { s.userId = user.id; s.registered = true; }
    s.batchIds = [...(s.batchIds || []), batchId].slice(-RECENT_BATCHES);
    /* What this browser's cart held before this batch (this visit, or the
       one it follows). */
    const hadCart = (ownPrev ? Number(prev.cartItems) : 0) > 0;

    const hour = String(new Date(nowMs + IST_OFFSET_MS).getUTCHours()).padStart(2, '0');
    if (!continues) {
      bump(inc, ['sessions']);
      bump(inc, ['hours', hour, 's']);
      bump(inc, ['channels', src.channel]);
      bump(inc, ['devices', ua.device]);
      bump(inc, ['os', ua.os]);
      bump(inc, ['browsers', ua.browser]);
      bump(inc, ['regions', ctx.geo.regionKey || 'unknown']);
      bump(inc, ['funnel', 'sessions']);
    }

    /* ── Unique visitor today (guest vs registered) ──
       "Registered" = a customer's browser: signed in now, or ever before.
       Same meaning as the 7 / 30 day counts (lastSeenAtReg). */
    const regVisitor = registered || !!visitor?.registered;
    const mark = mSnap.exists ? mSnap.data() : null;
    let markWrite = null;
    if (!mark) {
      bump(inc, ['visitors']);
      bump(inc, [regVisitor ? 'registered' : 'guests']);
      if (!visitor) bump(inc, ['newVisitors']);
      markWrite = { dateKey, vid, reg: regVisitor, at: nowIso, expireAt: new Date(nowMs + 3 * DAY_MS) };
    } else if (regVisitor && !mark.reg) {
      /* Signed in later today: move them from Guests to Registered. */
      bump(inc, ['guests'], -1);
      bump(inc, ['registered']);
      markWrite = { ...mark, reg: true };
    }

    /* ── Apply events ── */
    const flagsBefore = Object.fromEntries(FUNNEL_FLAGS.map(([f]) => [f, !!s[f]]));
    const stored = [];
    const crm = { pages: [], product: null, engagement: null, categories: {}, active: 0 };
    const once = new Set();
    const firstInBatch = (key) => (once.has(key) ? false : (once.add(key), true));
    const addsPerProduct = new Map();
    const counted = { product_view: 0, tryon_open: 0, add_to_cart: 0 };
    const roomFor = (type) => counted[type] < MAX_PER_BATCH[type];
    let pageviewsNow = 0;
    let purchasedNow = false;
    for (const e of events) {
      const path = cleanPath(e.path);
      if (path) {
        s.currentPath = path;
        /* Any event's page can be the landing page (a resumed tab's first
           batch may be a heartbeat). */
        if (!s.landingPath) s.landingPath = path;
      }
      s.events = (s.events || 0) + 1;
      const product = e.productId ? products.get(e.productId) : null;
      /* A purchase row is kept only when it was credited just now (below):
         a guessed, someone else's or re-sent order number is not a sale. */
      let keep = STORED_EVENTS.has(e.type) && e.type !== 'purchase';
      switch (e.type) {
        case 'page_view': {
          if (pageviewsNow >= MAX_PAGEVIEWS_PER_BATCH) { keep = false; break; }
          pageviewsNow += 1;
          s.pageviews = (s.pageviews || 0) + 1;
          bump(inc, ['pageviews']);
          bump(inc, ['hours', hour, 'p']);
          bump(inc, ['pages', encodeKey(routeKey(path))]);
          if (path) crm.pages.push(path);
          break;
        }
        case 'heartbeat': {
          /* Active time can't exceed wall-clock time since the session began. */
          const wall = Math.max(0, Math.floor((nowMs - Date.parse(s.startedAt)) / 1000)) + MAX_ACTIVE_PER_BEAT;
          const add = Math.max(0, Math.min(MAX_ACTIVE_PER_BEAT, Math.round(e.active || 0), wall - (s.activeSeconds || 0)));
          s.activeSeconds = (s.activeSeconds || 0) + add;
          s.pendingActive = (s.pendingActive || 0) + add;
          crm.active += add;
          break;
        }
        case 'product_view': {
          if (!product || !roomFor(e.type) || !firstInBatch(`v:${product.id}`)) { keep = false; break; }
          counted.product_view += 1;
          s.viewedProduct = true;
          bump(inc, ['productViews']);
          bump(inc, ['products', product.id, 'v']);
          crm.product = product;
          if (product.category) crm.categories[product.category] = (crm.categories[product.category] || 0) + 1;
          break;
        }
        case 'product_engagement': {
          if (!product) break;
          crm.product = product;
          crm.engagement = { dwellSeconds: e.dwell || 0, scrollDepthPercentage: e.scroll || 0, carouselClicks: e.carousel || 0, zoomInteractions: e.zoom || 0 };
          break;
        }
        case 'tryon_open': {
          /* One try-on per product per visit, however often the modal opens:
             "try-on %" (try-ons ÷ views) stays a true rate. */
          const key = product ? product.id : '(none)';
          if (!roomFor(e.type) || (s.triedProducts || []).includes(key)) { keep = false; break; }
          counted.tryon_open += 1;
          s.triedProducts = [...(s.triedProducts || []), key].slice(-MAX_TRIED_PRODUCTS);
          s.triedOn = true;
          bump(inc, ['tryons']);
          if (e.mode) bump(inc, ['tryonModes', e.mode]);
          if (product) bump(inc, ['products', product.id, 't']);
          break;
        }
        case 'tryon_mode': {
          if (!e.mode || !firstInBatch(`m:${e.mode}`)) { keep = false; break; }
          bump(inc, ['tryonModes', e.mode]);
          break;
        }
        case 'tryon_tone': {
          if (!e.tone || !firstInBatch(`t:${e.tone}`)) { keep = false; break; }
          bump(inc, ['tones', e.tone]);
          break;
        }
        case 'add_to_cart': {
          /* Add actions, not pieces: keeps "views → cart" a true rate. A
             few quick real taps count; a crafted burst doesn't. */
          const key = product ? product.id : '(none)';
          const n = addsPerProduct.get(key) || 0;
          if (n >= MAX_ADDS_PER_PRODUCT_PER_BATCH || !roomFor(e.type)) { keep = false; break; }
          addsPerProduct.set(key, n + 1);
          counted.add_to_cart += 1;
          s.addedToCart = true;
          bump(inc, ['addToCarts']);
          if (product) bump(inc, ['products', product.id, 'a']);
          break;
        }
        case 'remove_from_cart': break;
        case 'checkout_start': {
          if (!firstInBatch('checkout')) { keep = false; break; }
          s.reachedCheckout = true;
          bump(inc, ['checkouts']);
          break;
        }
        case 'purchase': {
          const i = purchaseClaims.findIndex((c) => c.orderNumber === e.orderNumber);
          if (i < 0 || orderMarks[i]?.exists) break; // unverified, or already counted
          const claim = purchaseClaims[i];
          if ((s.orderNumbers || []).includes(claim.orderNumber)) break;
          s.purchased = true;
          s.reachedCheckout = true;
          s.orderNumbers = [...(s.orderNumbers || []), claim.orderNumber].slice(-10);
          s.revenue = Math.round(((s.revenue || 0) + claim.total) * 100) / 100;
          bump(inc, ['orders']);
          bump(inc, ['revenue'], claim.total);
          bump(inc, ['ordersByChannel', s.channel]);
          bump(inc, ['revenueByChannel', s.channel], claim.total);
          tx.set(db.collection('analytics_orders').doc(claim.orderNumber), { orderNumber: claim.orderNumber, vid, sid, at: nowIso });
          tx.update(claim.ref, {
            attribution: {
              vid, sid, channel: s.channel, source: s.source, medium: s.medium, campaign: s.campaign,
              landingPath: s.landingPath, device: s.device, regionKey: s.regionKey, city: s.city,
            },
          });
          purchasedNow = true;
          keep = true;
          break;
        }
        default: break;
      }
      /* Raw rows for the export, capped per batch (a credited purchase always). */
      if (keep && (stored.length < MAX_STORED_PER_BATCH || e.type === 'purchase')) {
        stored.push({
          type: e.type, at: nowIso, dateKey, vid, sid, userId: s.userId || null,
          path, productId: product?.id || null, productName: product?.name || null,
          qty: e.qty || null, mode: e.mode || null, tone: e.tone || null,
          orderNumber: e.type === 'purchase' ? e.orderNumber : null,
          channel: s.channel, device: s.device, regionKey: s.regionKey,
          expireAt: new Date(nowMs + EVENT_TTL_DAYS * DAY_MS),
        });
      }
    }

    /* Funnel: count each step once per session. */
    for (const [flag, step] of FUNNEL_FLAGS) if (s[flag] && !flagsBefore[flag]) bump(inc, ['funnel', step]);

    /* Engaged (GA-style): 2+ pages, 10s+ active, or any shopping action. */
    if (!s.engaged && (s.pageviews >= 2 || s.activeSeconds >= 10 || s.triedOn || s.addedToCart || s.reachedCheckout || s.purchased)) {
      s.engaged = true;
      bump(inc, ['engaged']);
    }

    /* Saved-up active seconds join the daily counters when this batch writes
       them anyway, once two minutes have built up, or when the tab hides. */
    if (s.pendingActive > 0 && (Object.keys(inc).length || s.pendingActive >= ACTIVE_FLUSH_SECONDS || batch.final)) {
      bump(inc, ['activeSeconds'], s.pendingActive);
      s.pendingActive = 0;
    }

    /* Live cart (abandonment): what's in the cart right now, server-priced. */
    const totals = cartTotals(cart);
    if (totals) { s.cartItems = totals.items; s.cartValue = totals.value; }
    if (cartLines) s.cartSig = cartSig;
    if (purchasedNow) { s.cartItems = 0; s.cartValue = 0; }
    s.cartDay = s.cartItems > 0 && !s.purchased ? dateKey : null;

    s.lastSeenAt = nowIso;
    s.userId = s.userId || (registered ? user.id : null);
    s.registered = !!s.userId;
    s.updatedAt = nowIso;

    /* ── Visitor (identity stitching on sign-in) ── */
    const stitched = registered && visitor && visitor.userId !== user.id;
    const v = visitor ? { ...visitor } : {
      vid, firstSeenAt: nowIso, userId: null, registered: false, sessions: 0, pageviews: 0,
      firstTouch: { channel: src.channel, source: src.source, medium: src.medium, campaign: src.campaign, refHost: src.refHost, landingPath: s.landingPath || s.currentPath || '' },
    };
    if (registered) { v.userId = user.id; v.registered = true; }
    if (!continues) {
      v.sessions = (v.sessions || 0) + 1;
      v.lastTouch = { channel: s.channel, source: s.source, campaign: s.campaign, at: nowIso };
    }
    v.pageviews = (v.pageviews || 0) + pageviewsNow;
    v.lastSeenAt = nowIso;
    /* Separate field so "registered visitors since X" is a single-field query. */
    if (v.registered) v.lastSeenAtReg = nowIso;
    v.lastSessionId = sid;
    v.device = s.device; v.os = s.os; v.browser = s.browser;
    v.city = s.city; v.region = s.region; v.regionKey = s.regionKey; v.country = s.country;
    v.ipMasked = s.ipMasked;
    v.expireAt = new Date(nowMs + SESSION_TTL_DAYS * DAY_MS);
    /* The visitor record is only read by day ("seen since IST midnight"):
       a same-day, same-visit batch with no page view changes nothing. */
    const visitorChanged = !visitor || !continues || stitched || pageviewsNow > 0
      || (registered && !visitor.registered)
      || istDateKey(new Date(Date.parse(visitor.lastSeenAt) || 0)) !== dateKey;

    /* ── Customer profile (CRM pages read these) ── */
    if (uSnap?.exists) {
      const u = uSnap.data();
      const patch = { lastLogoutAt: nowIso };
      /* Once per visit — including a visit where they signed in halfway. */
      if (!s.crmCounted) {
        patch.lastLoginAt = nowIso;
        patch.sessionCount = (Number(u.sessionCount) || 0) + 1;
        s.crmCounted = true;
      }
      if (crm.active) patch.totalSessionSeconds = (Number(u.totalSessionSeconds) || 0) + crm.active;
      if (crm.pages.length) patch.recentPages = [...(u.recentPages || []), ...crm.pages.map((p) => ({ path: p, visitedAt: nowIso }))].slice(-20);
      if (Object.keys(crm.categories).length) {
        const ci = { ...(u.categoryInterests || {}) };
        for (const [c, n] of Object.entries(crm.categories)) ci[c] = (Number(ci[c]) || 0) + n;
        patch.categoryInterests = ci;
      }
      if (crm.product) {
        const base = u.lastSeenProduct?.id === crm.product.id ? u.lastSeenProduct : {};
        patch.lastSeenProduct = {
          ...base, id: crm.product.id, name: crm.product.name, slug: crm.product.slug, image: crm.product.image,
          price: crm.product.price || null, category: crm.product.category, viewedAt: nowIso,
          ...(crm.engagement || {}),
        };
      }
      /* Saved cart (CRM "Abandoned Cart"): written when it changes, cleared
         when this browser's cart is emptied or the order is placed. A visit
         from another device with an empty cart leaves it alone. */
      const saved = Array.isArray(u.savedCart) ? u.savedCart : [];
      const cartNow = cart?.items.length ? cart.items.map((i) => ({ _id: i.id, id: i.id, name: i.name, quantity: i.qty, price: i.price })) : null;
      /* Compared by value: Firestore doesn't keep a map's key order. */
      const cartKey = (items) => JSON.stringify(items.map((i) => [String(i.id ?? i._id ?? ''), String(i.name ?? ''), Number(i.quantity), Number(i.price)]));
      if (cartNow && cartKey(cartNow) !== cartKey(saved)) {
        patch.savedCart = cartNow;
        patch.cartUpdatedAt = nowIso;
      }
      const emptied = rawCart && rawCart.length === 0 && hadCart && saved.length > 0;
      if (purchasedNow || emptied) { patch.savedCart = []; patch.cartUpdatedAt = nowIso; }
      const ids = Array.isArray(u.visitorIds) ? u.visitorIds : [];
      if (!ids.includes(vid)) patch.visitorIds = [...ids, vid].slice(-20);
      tx.update(userRef, patch);
    }

    /* ── Writes ── */
    tx.set(sRef, s);
    if (visitorChanged) tx.set(vRef, v);
    if (markWrite) tx.set(markRef, markWrite);
    if (Object.keys(inc).length) tx.set(shardRef, { dateKey, ...toIncrements(inc) }, { merge: true });
    /* All-time counters (customers page "All-Time Visitors"). */
    const allTime = Object.fromEntries(TOTAL_FIELDS.filter((k) => inc[k]).map((k) => [k, inc[k]]));
    if (Object.keys(allTime).length) tx.set(totalsRef, toIncrements(allTime), { merge: true });
    for (const ev of stored) tx.set(db.collection('analytics_events').doc(), ev);

    return { sid, accepted: events.length, newSession: !continues, newVisitor: !visitor, stitched };
  });

  /* Back-fill this browser's earlier guest sessions with the customer id
     (outside the transaction; best effort, bounded). */
  if (result.stitched) {
    try {
      const older = await sessionsCol.where('vid', '==', vid).limit(100).get();
      await Promise.all(older.docs.filter((d) => !d.data().userId).map((d) => d.ref.update({ userId: user.id, registered: true })));
    } catch (err) {
      console.error('[analytics] stitch back-fill failed:', err.message);
    }
  }

  return { vid, sid: result.sid, accepted: result.accepted, newSession: result.newSession, newVisitor: result.newVisitor };
}
