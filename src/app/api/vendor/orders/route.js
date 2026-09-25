import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { toVendorOrderDetail, vendorTabCounts } from '@/lib/vendorOrders';

/* GET /api/vendor/orders — every order containing this vendor's pieces,
   each cut down to their own lines (toVendorOrderDetail), plus the tab
   counts computed from exactly that list. The tenant filter is the query
   itself: `vendorIds array-contains <this vendor>`, written at checkout
   from the products' own vendorId. */
export async function GET() {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { db, vendorId } = ctx;

    const [snap, vendorSnap] = await Promise.all([
      db.collection('orders').where('vendorIds', 'array-contains', vendorId).get(),
      db.collection('vendors').doc(vendorId).get(),
    ]);
    const vendor = vendorSnap.exists ? vendorSnap.data() : {};
    const orders = snap.docs
      .map((d) => toVendorOrderDetail({ id: d.id, ...d.data() }, vendorId, vendor))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 500);

    return NextResponse.json({
      success: true,
      data: { orders, counts: vendorTabCounts(orders), selfFulfil: vendor.selfFulfil === true },
    });
  } catch (e) {
    console.error('[vendor/orders]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load orders' }, { status: 500 });
  }
}
