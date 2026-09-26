import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { generateLabel, isConfigured, ShiprocketError } from '@/lib/shiprocket';

/* POST /api/vendor/orders/:id/label — Shiprocket's label for this vendor's
   own booked parcel only (never another seller's parcel in the order). */
export async function POST(request, context) {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { id } = await context.params;
    const snap = await ctx.db.collection('orders').doc(String(id)).get();
    const order = snap.exists ? snap.data() : null;
    if (!order || !Array.isArray(order.vendorIds) || !order.vendorIds.includes(ctx.vendorId)) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    const parcel = order.shipments?.[ctx.vendorId];
    if (!parcel?.awb || !parcel.shipmentId) {
      return NextResponse.json({ success: false, message: 'Book your parcel with Shiprocket first — the label comes from the courier booking.' }, { status: 400 });
    }
    if (!isConfigured()) return NextResponse.json({ success: false, message: 'Shiprocket isn’t set up.' }, { status: 400 });
    const labelUrl = await generateLabel([parcel.shipmentId]);
    return NextResponse.json({ success: true, data: { labelUrl } });
  } catch (e) {
    if (e instanceof ShiprocketError) return NextResponse.json({ success: false, message: e.message }, { status: 400 });
    console.error('[vendor label]', e.message);
    return NextResponse.json({ success: false, message: 'Could not get the label' }, { status: 500 });
  }
}
