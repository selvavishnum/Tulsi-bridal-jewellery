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

export const SHARDS = 4;
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

/* ── Small per-instance caches (best effort; serverless instances are short-lived) ── */
const productCache = new Map();
const PRODUCT_TTL_MS = 10 * 60 * 1000;
export function _resetCaches() { productCache.clear(); }

/** Name / category / price / image of a real product, or null. Keeps rollup
 *  keys bounded to the actual catalogue. */
async function productInfo(db, id, nowMs) {
  if (!isProductId(id)) return null;
  const hit = productCache.get(id);
  if (hit && nowMs - hit.at < PRODUCT_TTL_MS) return hit.data;
  const snap = await db.collection('products').doc(id).get();
  const p = snap.exists ? snap.data() : null;
  const data = p ? {
    id,
    name: String(p.name || '').slice(0, 120),
    slug: p.slug || null,
    image: Array.isArray(p.images) && typeof p.images[0] === 'string' ? p.images[0] : null,
    price: Number(p.discountPrice) || Number(p.price) || 0,
    category: typeof p.category === 'string' && /^[a-z0-9-]{1,40}$/.test(p.category) ? p.category : null,
  } : null;
  if (productCache.size > 5000) productCache.clear();
  productCache.set(id, { at: nowMs, data });
  return data;
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

/**
 * Process one batch.
 * @param {object} db
 * @param {{
 *   vid?: string, sid?: string,
 *   user?: { id: string } | null,
 *   ctx: { ua: string, ip?: string, ipMasked?: string, geo: object, siteHost?: string, now?: Date },
 *   batch: { tab: string, cart: object|null, events: object[] },
 * }} input
 * @returns {Promise<{ vid: string, sid: string, accepted: number, newSession: boolean, newVisitor: boolean }>}
 */
export async function ingestBatch(db, { vid: vidIn, sid: sidIn, user = null, ctx, batch }) {
  const now = ctx.now || new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const dateKey = istDateKey(now);
  const vid = VID_RE.test(vidIn || '') ? vidIn : newVisitorId();
  const sidCookie = SID_RE.test(sidIn || '') ? sidIn : null;
  const ua = parseUserAgent(ctx.ua);
  const registered = !!user?.id;
  const events = [...batch.events].sort((a, b) => a.seq - b.seq);

  /* Reads that don't need the transaction: products named by events (for
     bounded keys + CRM detail) and orders claimed by purchase events. */
  const productIds = [...new Set(events.map((e) => e.productId).filter(Boolean))].slice(0, 10);
  const products = new Map();
  for (const id of productIds) {
    const info = await productInfo(db, id, nowMs);
    if (info) products.set(id, info);
  }
  const purchaseClaims = [];
  for (const e of events) {
    if (e.type !== 'purchase' || !e.orderNumber || purchaseClaims.some((c) => c.orderNumber === e.orderNumber)) continue;
    const snap = await db.collection('orders').where('orderNumber', '==', e.orderNumber).limit(1).get();
    const doc = snap.docs[0];
    if (!doc) continue;
    const o = doc.data();
    /* Only the browser (or customer) that placed the order can claim it,
       and only within a day — a guessed order number counts for nothing. */
    const mine = (o.analyticsVid && o.analyticsVid === vid) || (registered && o.userId && o.userId === user.id);
    const fresh = o.createdAt && nowMs - Date.parse(o.createdAt) < DAY_MS;
    const live = o.status !== 'cancelled';
    /* Paid online, or a cash-on-delivery order (paid at the door). */
    const placed = o.payment?.status === 'paid' || o.payment?.method === 'cod';
    if (mine && fresh && live && placed) purchaseClaims.push({ orderNumber: e.orderNumber, ref: doc.ref, total: Number(o.total) || 0 });
  }

  const visitorsCol = db.collection('analytics_visitors');
  const sessionsCol = db.collection('analytics_sessions');
  const vRef = visitorsCol.doc(vid);
  const markRef = db.collection('analytics_seen').doc(`${dateKey}_${vid}`);
  const userRef = registered ? db.collection('users').doc(user.id) : null;
  const shard = crypto.randomInt(0, SHARDS);
  const shardRef = db.collection('analytics_daily').doc(`${dateKey}_${shard}`);
  const totalsRef = db.collection('analytics_totals').doc(String(shard));

  const result = await db.runTransaction(async (tx) => {
    const [vSnap, sSnap, mSnap, uSnap, ...orderMarks] = await Promise.all([
      tx.get(vRef),
      sidCookie ? tx.get(sessionsCol.doc(sidCookie)) : Promise.resolve(null),
      tx.get(markRef),
      userRef ? tx.get(userRef) : Promise.resolve(null),
      ...purchaseClaims.map((c) => tx.get(db.collection('analytics_orders').doc(c.orderNumber))),
    ]);

    const visitor = vSnap.exists ? vSnap.data() : null;
    const prev = sSnap?.exists ? sSnap.data() : null;
    const inc = {};

    /* ── Session: continue, or start a new one ── */
    const firstView = events.find((e) => e.type === 'page_view');
    const acq = classifySource({
      utm: firstView?.utm, referrer: firstView?.referrer, ua: ctx.ua, siteHost: ctx.siteHost, clickIds: firstView?.clickIds,
    });
    const taggedArrival = !!(firstView && (firstView.utm?.source || firstView.clickIds?.gclid || firstView.clickIds?.fbclid));
    const continues = prev
      && prev.vid === vid
      && prev.dateKey === dateKey
      && nowMs - Date.parse(prev.lastSeenAt) < SESSION_IDLE_MS
      /* A new tagged campaign click starts a new session (as GA does). */
      && !(taggedArrival && (acq.channel !== prev.channel || acq.campaign !== prev.campaign));
    const sid = continues ? sidCookie : newSessionId();
    const sRef = sessionsCol.doc(sid);
    const s = continues ? { ...prev } : {
      sid, vid, dateKey,
      userId: registered ? user.id : (visitor?.userId || null),
      registered,
      startedAt: nowIso,
      channel: acq.channel, source: acq.source, medium: acq.medium, campaign: acq.campaign, content: acq.content, refHost: acq.refHost,
      landingPath: '', currentPath: '',
      device: ua.device, os: ua.os, browser: ua.browser,
      city: ctx.geo.city || '', region: ctx.geo.region || '', regionKey: ctx.geo.regionKey || 'unknown', country: ctx.geo.country || '',
      ipMasked: ctx.ipMasked || '',
      pageviews: 0, activeSeconds: 0, events: 0,
      viewedProduct: false, triedOn: false, addedToCart: false, reachedCheckout: false, purchased: false, engaged: false,
      cartItems: 0, cartValue: 0, cartDay: null,
      orderNumbers: [], revenue: 0,
      batchIds: [],
      expireAt: new Date(nowMs + SESSION_TTL_DAYS * DAY_MS),
    };
    if (registered && !s.userId) { s.userId = user.id; s.registered = true; }

    /* ── De-duplicate retried batches: (tab, n) seen on this session ── */
    const batchId = `${batch.tab}:${batch.n}`;
    if (continues && (s.batchIds || []).includes(batchId)) {
      return { sid, accepted: 0, newSession: false, newVisitor: false, stitched: false, duplicate: true };
    }
    s.batchIds = [...(s.batchIds || []), batchId].slice(-RECENT_BATCHES);
    const fresh = events;

    const hour = String(new Date(nowMs + IST_OFFSET_MS).getUTCHours()).padStart(2, '0');
    if (!continues) {
      bump(inc, ['sessions']);
      bump(inc, ['hours', hour, 's']);
      bump(inc, ['channels', acq.channel]);
      bump(inc, ['devices', ua.device]);
      bump(inc, ['os', ua.os]);
      bump(inc, ['browsers', ua.browser]);
      bump(inc, ['regions', ctx.geo.regionKey || 'unknown']);
      bump(inc, ['funnel', 'sessions']);
    }

    /* ── Unique visitor today (guest vs registered) ── */
    const mark = mSnap.exists ? mSnap.data() : null;
    let markWrite = null;
    if (!mark) {
      bump(inc, ['visitors']);
      bump(inc, [registered ? 'registered' : 'guests']);
      if (!visitor) bump(inc, ['newVisitors']);
      markWrite = { dateKey, vid, reg: registered, at: nowIso, expireAt: new Date(nowMs + 3 * DAY_MS) };
    } else if (registered && !mark.reg) {
      /* Signed in later today: move them from Guests to Registered. */
      bump(inc, ['guests'], -1);
      bump(inc, ['registered']);
      markWrite = { ...mark, reg: true };
    }

    /* ── Apply events ── */
    const flagsBefore = Object.fromEntries(FUNNEL_FLAGS.map(([f]) => [f, !!s[f]]));
    const stored = [];
    const crm = { pages: [], product: null, engagement: null, categories: {}, active: 0 };
    let purchasedNow = false;
    for (const e of fresh) {
      const path = cleanPath(e.path);
      if (path) s.currentPath = path;
      s.events = (s.events || 0) + 1;
      const product = e.productId ? products.get(e.productId) : null;
      /* A purchase row is kept only when it was credited just now (below):
         a guessed, someone else's or re-sent order number is not a sale. */
      let keep = STORED_EVENTS.has(e.type) && e.type !== 'purchase';
      switch (e.type) {
        case 'page_view': {
          s.pageviews = (s.pageviews || 0) + 1;
          if (!s.landingPath && path) s.landingPath = path;
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
          bump(inc, ['activeSeconds'], add);
          crm.active += add;
          break;
        }
        case 'product_view': {
          if (!product) break;
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
          s.triedOn = true;
          bump(inc, ['tryons']);
          if (e.mode) bump(inc, ['tryonModes', e.mode]);
          if (product) bump(inc, ['products', product.id, 't']);
          break;
        }
        case 'tryon_mode': { if (e.mode) bump(inc, ['tryonModes', e.mode]); break; }
        case 'tryon_tone': { if (e.tone) bump(inc, ['tones', e.tone]); break; }
        case 'add_to_cart': {
          s.addedToCart = true;
          bump(inc, ['addToCarts']);
          /* Add actions, not pieces: keeps "views → cart" a true rate. */
          if (product) bump(inc, ['products', product.id, 'a']);
          break;
        }
        case 'remove_from_cart': break;
        case 'checkout_start': {
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
      if (keep) {
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

    /* Live cart (abandonment): what's in the cart right now. */
    const totals = cartTotals(batch.cart);
    if (totals) { s.cartItems = totals.items; s.cartValue = totals.value; }
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
      firstTouch: { channel: acq.channel, source: acq.source, medium: acq.medium, campaign: acq.campaign, refHost: acq.refHost, landingPath: s.landingPath || s.currentPath || '' },
    };
    if (registered) { v.userId = user.id; v.registered = true; }
    if (!continues) {
      v.sessions = (v.sessions || 0) + 1;
      v.lastTouch = { channel: s.channel, source: s.source, campaign: s.campaign, at: nowIso };
    }
    v.pageviews = (v.pageviews || 0) + fresh.filter((e) => e.type === 'page_view').length;
    v.lastSeenAt = nowIso;
    /* Separate field so "registered visitors since X" is a single-field query. */
    if (v.registered) v.lastSeenAtReg = nowIso;
    v.lastSessionId = sid;
    v.device = s.device; v.os = s.os; v.browser = s.browser;
    v.city = s.city; v.region = s.region; v.regionKey = s.regionKey; v.country = s.country;
    v.ipMasked = s.ipMasked;
    v.expireAt = new Date(nowMs + SESSION_TTL_DAYS * DAY_MS);

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
      if (batch.cart?.items?.length) {
        patch.savedCart = batch.cart.items.map((i) => ({ _id: i.id, id: i.id, name: i.name, quantity: i.qty, price: i.price }));
        patch.cartUpdatedAt = nowIso;
      }
      if (purchasedNow) { patch.savedCart = []; patch.cartUpdatedAt = nowIso; }
      const ids = Array.isArray(u.visitorIds) ? u.visitorIds : [];
      if (!ids.includes(vid)) patch.visitorIds = [...ids, vid].slice(-20);
      tx.update(userRef, patch);
    }

    /* ── Writes ── */
    tx.set(sRef, s);
    tx.set(vRef, v);
    if (markWrite) tx.set(markRef, markWrite);
    if (Object.keys(inc).length) tx.set(shardRef, { dateKey, ...toIncrements(inc) }, { merge: true });
    /* All-time counters (customers page "All-Time Visitors"). */
    const allTime = Object.fromEntries(TOTAL_FIELDS.filter((k) => inc[k]).map((k) => [k, inc[k]]));
    if (Object.keys(allTime).length) tx.set(totalsRef, toIncrements(allTime), { merge: true });
    for (const ev of stored) tx.set(db.collection('analytics_events').doc(), ev);

    return { sid, accepted: fresh.length, newSession: !continues, newVisitor: !visitor, stitched };
  });

  /* Back-fill this browser's earlier guest sessions with the customer id
     (outside the transaction; best effort, bounded). */
  if (result.stitched) {
    try {
      const older = await sessionsCol.where('vid', '==', vid).limit(100).get();
      for (const d of older.docs) if (!d.data().userId) await d.ref.update({ userId: user.id, registered: true });
    } catch (err) {
      console.error('[analytics] stitch back-fill failed:', err.message);
    }
  }

  return { vid, sid: result.sid, accepted: result.accepted, newSession: result.newSession, newVisitor: result.newVisitor };
}
