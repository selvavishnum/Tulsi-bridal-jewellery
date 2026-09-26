import { NextResponse } from 'next/server';
import { requireActiveVendor } from '@/lib/vendorAuth';
import { syncVendorPickup } from '@/lib/pickupSync';
import { hit } from '@/lib/rateLimit';

/* POST /api/vendor/profile/pickup-sync — retry registering the saved
   warehouse address with Shiprocket (5 tries an hour). */
export async function POST() {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const limited = await hit(ctx.db, `pickup-sync:${ctx.vendorId}`, { limit: 5, windowMs: 60 * 60_000 });
    if (!limited.allowed) return NextResponse.json({ success: false, message: 'Too many tries — wait a while, or contact Tulsi.' }, { status: 429 });
    const result = await syncVendorPickup(ctx.db, ctx.vendorId, { force: true });
    const ok = ['active', 'needs_verification', 'unchanged'].includes(result.status);
    return NextResponse.json({ success: ok, message: result.message, data: result }, { status: ok ? 200 : 400 });
  } catch (e) {
    console.error('[pickup-sync]', e.message);
    return NextResponse.json({ success: false, message: 'Could not reach Shiprocket. Try again shortly.' }, { status: 502 });
  }
}
