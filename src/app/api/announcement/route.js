/* ─────────────────────────────────────────────
   GET /api/announcement — public.

   { success, enabled, message, code, active } for the welcome strip
   (src/components/layout/WelcomeBar.jsx): the owner's announcement
   (settings/site.announcement, normalised as everywhere else) and whether
   it may be shown. `active` is decided here, on the server: the configured
   code is an existing coupon that is switched on, has started, hasn't
   expired and isn't used up — so the strip never advertises a code that
   checkout would refuse. Nothing else about the coupon is returned.

   Cost: two reads per server instance a minute (one cached answer, shared
   by every visitor; in-flight reads are shared too). A failed read isn't
   cached and answers "don't show the offer" — the strip keeps its tagline.
   ───────────────────────────────────────────── */
import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { normalizeAnnouncement } from '@/lib/welcomeOffer';
import { couponStateRefusal } from '@/lib/coupons';

/* Read at request time (never prerendered at build); cached in memory below. */
export const dynamic = 'force-dynamic';

const CACHE_MS = 60_000;
let cache = null; // { db, at, promise }

async function readAnnouncement(db) {
  const site = await db.collection('settings').doc('site').get();
  const { enabled, message, code } = normalizeAnnouncement(site.exists ? site.data() : {});
  if (!enabled) return { enabled, message, code, active: false };
  /* A message without a code advertises nothing that checkout must honour. */
  if (!code) return { enabled, message, code, active: !!message };
  const snap = await db.collection('coupons').where('code', '==', code).limit(1).get();
  const coupon = snap.empty ? null : snap.docs[0].data();
  return { enabled, message, code, active: !!coupon && couponStateRefusal(coupon) === null };
}

function cachedAnnouncement(db) {
  const now = Date.now();
  if (cache && cache.db === db && now >= cache.at && now - cache.at < CACHE_MS) return cache.promise;
  const entry = { db, at: now, promise: readAnnouncement(db) };
  cache = entry;
  entry.promise.catch(() => { if (cache === entry) cache = null; });
  return entry.promise;
}

export async function GET() {
  try {
    const data = await cachedAnnouncement(getDB());
    return NextResponse.json({ success: true, ...data }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    console.error('[announcement] read failed:', err?.message);
    return NextResponse.json(
      { success: false, enabled: false, message: '', code: '', active: false },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
