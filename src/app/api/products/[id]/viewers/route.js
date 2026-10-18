/* ─────────────────────────────────────────────
   GET /api/products/[id]/viewers — public.

   { success: true, data: { viewing } }: how many OTHER people (distinct
   browsers, not the requester's own) are on /product/<id> right now,
   from our own visitor analytics (src/lib/analytics/viewers.js). Only the
   number is returned — never ids, paths or anything about who they are.

   A social-proof badge must never break the product page: any failure
   answers 0 (the badge then stays hidden).
   ───────────────────────────────────────────── */
import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { cookieFrom, SID_RE, VID_RE } from '@/lib/analytics/ingest';
import { viewersOnPage } from '@/lib/analytics/viewers';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const reply = (viewing, cacheControl) => NextResponse.json(
  { success: true, data: { viewing } },
  { headers: { 'Cache-Control': cacheControl } },
);

export async function GET(request, context) {
  let id;
  try { ({ id } = await context.params); } catch { id = null; }
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return NextResponse.json({ success: false, message: 'Invalid product id' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const sid = cookieFrom(request, 'tj_sid');
    const vid = cookieFrom(request, 'tj_vid');
    const excludeSid = SID_RE.test(sid) ? sid : null;
    const excludeVid = VID_RE.test(vid) ? vid : null;
    let viewing = await viewersOnPage(getDB(), `/product/${id}`, { excludeSid, excludeVid });
    /* No analytics cookies yet (a first visit whose tracker response hasn't
       landed): this shopper may already be among those counted, so count
       one fewer — the figure may come out low, never high. */
    if (!excludeSid && !excludeVid) viewing = Math.max(0, viewing - 1);
    return reply(viewing, 'private, max-age=30');
  } catch (err) {
    console.error('[viewers] count failed:', err?.message);
    /* Not cached: the next poll tries again. */
    return reply(0, 'no-store');
  }
}
