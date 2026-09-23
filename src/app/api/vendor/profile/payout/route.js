import { NextResponse } from 'next/server';
import { requireActiveVendor } from '@/lib/vendorAuth';
import { parsePayout } from '@/lib/payoutDestination';
import { maskPayoutDestination } from '@/lib/vendorLedger';

/* POST /api/vendor/profile/payout — ask to change where payouts go.
   The new bank account / UPI is stored as a request only: payouts keep
   going to the current destination until a Super Admin approves it on the
   Vendors page. A hijacked vendor login therefore can't redirect money on
   its own. A new request replaces any earlier pending one. */
export async function POST(request) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const body = await request.json().catch(() => ({}));
    const { payout, error } = parsePayout(body?.payout);
    if (error || !payout) return NextResponse.json({ success: false, message: error || 'Choose bank account or UPI.' }, { status: 400 });

    const now = new Date().toISOString();
    await ctx.db.collection('vendors').doc(ctx.vendorId).update({
      pendingPayout: { ...payout, requestedAt: now, requestedBy: ctx.session.user.email || null },
      updatedAt: now,
    });
    return NextResponse.json({ success: true, data: { destination: maskPayoutDestination(payout), requestedAt: now } });
  } catch (e) {
    console.error('[vendor/profile/payout POST]', e.message);
    return NextResponse.json({ success: false, message: 'Could not send the request' }, { status: 500 });
  }
}

/* DELETE — withdraw a pending change request. */
export async function DELETE() {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    await ctx.db.collection('vendors').doc(ctx.vendorId).update({ pendingPayout: null, updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[vendor/profile/payout DELETE]', e.message);
    return NextResponse.json({ success: false, message: 'Could not cancel the request' }, { status: 500 });
  }
}
