import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { summarizeLedger, RETURN_WINDOW_DAYS } from '@/lib/settlement';
import { maskPayoutDestination } from '@/lib/vendorLedger';

/* GET /api/vendor/summary — the signed-in vendor's wallet: totals, recent
   ledger lines and payouts. Read-only; only their own records. */
export async function GET() {
  try {
    const ctx = await requireVendor('finance:read');
    if (!ctx) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const { db, sdb, actor } = ctx;

    const [vendorSnap, ledgerSnap, payoutSnap] = await Promise.all([
      db.collection('vendors').doc(actor.vendorId).get(),
      sdb.query('vendorLedger').get(),
      sdb.query('vendorPayouts').get(),
    ]);
    if (!vendorSnap.exists) return NextResponse.json({ success: false, message: 'Vendor not found' }, { status: 404 });
    const vendor = vendorSnap.data();

    const now = Date.now();
    const entries = ledgerSnap.docs.map((d) => {
      const e = { id: d.id, ...d.data() };
      return { ...e, held: e.status === 'unsettled' && new Date(e.availableAt).getTime() > now };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const payouts = payoutSnap.docs.map((d) => {
      const { entryIds: _e, createdBy: _c, ...p } = d.data();
      return { id: d.id, ...p };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return NextResponse.json({
      success: true,
      data: {
        vendor: {
          name: vendor.name,
          status: vendor.status,
          platformFeePercent: (Number(vendor.platformFeeBps) || 0) / 100,
          payoutDestination: maskPayoutDestination(vendor.payout),
          payoutMethod: vendor.payout?.method || null,
        },
        holdDays: RETURN_WINDOW_DAYS,
        summary: summarizeLedger(entries, now),
        entries: entries.slice(0, 100),
        payouts: payouts.slice(0, 50),
      },
    });
  } catch (e) {
    console.error('[vendor/summary]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load your summary' }, { status: 500 });
  }
}
