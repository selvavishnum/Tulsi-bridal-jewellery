import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { toVendorOrderView } from '@/lib/settlement';

/* GET /api/vendor/orders — orders containing the vendor's pieces, reduced
   to their own lines (toVendorOrderView): no other vendors' items or
   totals, no customer contact details. Orders is a platform collection, so
   the vendor filter is the array-contains on vendorIds written at checkout. */
export async function GET() {
  try {
    const ctx = await requireVendor('orders:read');
    if (!ctx) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const { db, actor } = ctx;

    const snap = await db.collection('orders').where('vendorIds', 'array-contains', actor.vendorId).get();
    const orders = snap.docs
      .map((d) => toVendorOrderView({ id: d.id, ...d.data() }, actor.vendorId))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 300);

    return NextResponse.json({ success: true, data: orders });
  } catch (e) {
    console.error('[vendor/orders]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load orders' }, { status: 500 });
  }
}
