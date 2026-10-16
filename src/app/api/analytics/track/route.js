/* ─────────────────────────────────────────────
   POST /api/analytics/track — the single ingestion endpoint for visitor
   analytics. Public by design: every visitor counts, signed in or not.

   Body: { tab, cart?, events: [...] } (see src/lib/analytics/events.js),
   sent as JSON by fetch(keepalive) or as text/plain by navigator.sendBeacon.

   Identity lives in two first-party HttpOnly cookies the server issues:
     tj_vid  — this browser (≈400 days)
     tj_sid  — this visit (30 min, refreshed on every batch)
   Page scripts never see them, so a third-party script on the page can't
   read or replay the visitor id.

   Defences, cheapest first: body size cap → cross-site check → bot filter
   (UA + Accept-Language) → per-IP in-memory rate limit → schema check →
   staff/vendor skip. Tracking never breaks the page: any server error is
   logged and answered with 204.
   ───────────────────────────────────────────── */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getDB } from '@/lib/firebase';
import { clientIp } from '@/lib/rateLimit';
import { isBotLike, geoFromHeaders, maskIp } from '@/lib/analytics/classify';
import { parseBatch, MAX_BODY_BYTES } from '@/lib/analytics/events';
import { ingestBatch, cookieFrom, VID_RE, SID_RE, SESSION_IDLE_MS } from '@/lib/analytics/ingest';

export const dynamic = 'force-dynamic';

const VID_MAX_AGE = 400 * 24 * 60 * 60; // seconds; browsers cap cookies at 400 days
const SID_MAX_AGE = SESSION_IDLE_MS / 1000;
const SECURE = process.env.NODE_ENV === 'production';

/* Per-instance limiter. A Firestore-backed limiter would cost a write per
   beacon; for analytics a best-effort cap per serverless instance is the
   right trade (a real visitor sends ~5 batches a minute). */
const RATE = { limit: 120, windowMs: 60_000 };
const buckets = new Map();
/* IPv6 by its /64 (one home or phone gets a whole /64 and can rotate
   inside it); IPv4 as is (Indian mobile carriers share addresses widely). */
const limitKey = (ip) => (ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip);
function allowIp(ipRaw, now = Date.now()) {
  const ip = limitKey(String(ipRaw || 'unknown'));
  const b = buckets.get(ip);
  if (!b || now - b.start >= RATE.windowMs) {
    if (buckets.size > 10_000) buckets.clear();
    buckets.set(ip, { start: now, count: 1 });
    return true;
  }
  b.count += 1;
  return b.count <= RATE.limit;
}

const noContent = () => new NextResponse(null, { status: 204 });
/* gRPC codes worth a resend: DEADLINE_EXCEEDED, ABORTED, UNAVAILABLE.
   (Not RESOURCE_EXHAUSTED: a used-up quota doesn't come back in seconds.) */
const TRANSIENT = new Set([4, 10, 14]);
const stripHost = (h) => String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');

/** Another website's page can't make visitors' browsers post here. */
function crossSite(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'cross-site';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return stripHost(new URL(origin).host) !== stripHost(request.headers.get('x-forwarded-host') || request.headers.get('host'));
  } catch {
    return true;
  }
}

async function readBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return { tooLarge: true };
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    return { json: JSON.parse(text) };
  } catch {
    return { json: null };
  }
}

export async function POST(request) {
  const h = request.headers;
  const ua = h.get('user-agent') || '';

  if (crossSite(request)) return NextResponse.json({ success: false }, { status: 403 });
  /* Bots get the same empty answer as everyone else — nothing to probe. */
  if (isBotLike({ ua, acceptLanguage: h.get('accept-language') })) return noContent();

  const ip = clientIp(h);
  if (!allowIp(ip)) return NextResponse.json({ success: false }, { status: 429, headers: { 'retry-after': '60' } });

  const body = await readBody(request);
  if (body.tooLarge) return NextResponse.json({ success: false }, { status: 413 });
  const parsed = parseBatch(body.json);
  if (parsed.error) return NextResponse.json({ success: false, message: parsed.error }, { status: 400 });

  try {
    /* Staff and sellers browsing the shop would skew customer numbers. */
    const session = await getServerSession(authOptions).catch(() => null);
    const role = session?.user?.role;
    if (role && role !== 'customer') return noContent();
    const user = role === 'customer' && session.user.id ? { id: String(session.user.id) } : null;

    const vidIn = cookieFrom(request, 'tj_vid');
    const sidIn = cookieFrom(request, 'tj_sid');
    const out = await ingestBatch(getDB(), {
      vid: VID_RE.test(vidIn || '') ? vidIn : undefined,
      sid: SID_RE.test(sidIn || '') ? sidIn : undefined,
      user,
      ctx: {
        ua,
        ipMasked: maskIp(ip),
        geo: geoFromHeaders((name) => h.get(name)),
        siteHost: h.get('x-forwarded-host') || h.get('host') || '',
      },
      batch: parsed.batch,
    });

    const res = noContent();
    const base = { httpOnly: true, secure: SECURE, sameSite: 'lax', path: '/' };
    res.cookies.set('tj_vid', out.vid, { ...base, maxAge: VID_MAX_AGE });
    res.cookies.set('tj_sid', out.sid, { ...base, maxAge: SID_MAX_AGE });
    return res;
  } catch (err) {
    console.error('[analytics/track] ingest failed:', err.message);
    /* Contention, timeout or a Firestore blip: ask the tracker to resend the
       same batch (de-duplicated by its id). Anything else is dropped. */
    if (TRANSIENT.has(err?.code)) return NextResponse.json({ success: false }, { status: 503, headers: { 'retry-after': '10' } });
    return noContent();
  }
}
