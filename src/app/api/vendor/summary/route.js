import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { summarizeLedger, retailSalesOf, RETURN_WINDOW_DAYS } from '@/lib/settlement';
import { maskPayoutDestination } from '@/lib/vendorLedger';

/* GET /api/vendor/summary — the signed-in vendor's ledger:
     Total sold − Logistics − Tulsi charges = Net earnings
   "Tulsi charges" is the margin (supplyCost) and platform fee combined, per order and
   in total — never per product, and never the fee rate — so the platform's
   retained margin stays internal while the vendor can still reconcile
   every rupee (sold − net was always derivable from what they see). */
export async function GET() {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { db, sdb, vendorId } = ctx;

    const [vendorSnap, ledgerSnap, payoutSnap] = await Promise.all([
      db.collection('vendors').doc(vendorId).get(),
      sdb.query('vendorLedger').get(),
      sdb.query('vendorPayouts').get(),
    ]);
    if (!vendorSnap.exists) return NextResponse.json({ success: false, message: 'Vendor not found' }, { status: 404 });
    const vendor = vendorSnap.data();

    const now = Date.now();
    const raw = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const s = summarizeLedger(raw, now);
    const entries = raw
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100)
      .map((e) => ({
        id: e.id,
        type: e.type,
        orderNumber: e.orderNumber,
        deliveredAt: e.deliveredAt || e.createdAt,
        availableAt: e.availableAt,
        status: e.status,
        held: e.status === 'unsettled' && new Date(e.availableAt).getTime() > now,
        retailSalesPaise: retailSalesOf(e),
        totalSoldPaise: e.grossPaise || 0,
        logisticsPaise: e.shippingPaise || 0,
        chargesPaise: (e.supplyCostPaise || 0) + (e.platformFeePaise || 0),
        netPaise: e.netPaise || 0,
      }));
    const payouts = payoutSnap.docs
      .map((d) => {
        const p = d.data();
        return { id: d.id, amountPaise: p.amountPaise, destination: p.destination, reference: p.reference, createdAt: p.createdAt };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 50);

    return NextResponse.json({
      success: true,
      data: {
        vendor: { name: vendor.name, status: vendor.status, payoutDestination: maskPayoutDestination(vendor.payout) },
        holdDays: RETURN_WINDOW_DAYS,
        summary: {
          retailSalesPaise: s.itemsPaise,
          totalSoldPaise: s.grossPaise,
          logisticsPaise: s.shippingPaise,
          chargesPaise: s.supplyCostPaise + s.platformFeePaise,
          netPaise: s.netPaise,
          paidOutPaise: s.paidOutPaise,
          availablePaise: s.availablePaise,
          pendingPaise: s.pendingPaise,
        },
        entries,
        payouts,
      },
    });
  } catch (e) {
    console.error('[vendor/summary]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load your summary' }, { status: 500 });
  }
}
