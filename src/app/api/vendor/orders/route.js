import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { toVendorOrderView } from '@/lib/settlement';

/* GET /api/vendor/orders — orders containing the vendor's pieces. The
   tenant filter is the query itself (`vendorIds array-contains <vendor>`,
   written at checkout), and each order is then cut down to that vendor's
   own lines by toVendorOrderView. */
export async function GET() {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { db, vendorId } = ctx;

    const snap = await db.collection('orders').where('vendorIds', 'array-contains', vendorId).get();
    const orders = snap.docs
      .map((d) => toVendorOrderView({ id: d.id, ...d.data() }, vendorId))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 300);

    return NextResponse.json({ success: true, data: orders });
  } catch (e) {
    console.error('[vendor/orders]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load orders' }, { status: 500 });
  }
}
