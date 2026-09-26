import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { trackShiprocketAWB, isConfigured } from '@/lib/shiprocket';
import { vendorFulfils } from '@/lib/vendorOrders';

/* GET /api/vendor/orders/:id/tracking — live courier milestones for this
   vendor's parcel (or the whole order, when it's entirely theirs). */
export async function GET(request, context) {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { id } = await context.params;
    const [snap, vendorSnap] = await Promise.all([
      ctx.db.collection('orders').doc(String(id)).get(),
      ctx.db.collection('vendors').doc(ctx.vendorId).get(),
    ]);
    const order = snap.exists ? snap.data() : null;
    if (!order || !Array.isArray(order.vendorIds) || !order.vendorIds.includes(ctx.vendorId)) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    const own = order.shipments?.[ctx.vendorId]?.awb
      || (vendorFulfils(order, ctx.vendorId, vendorSnap.data()) ? order.shipments?.tulsi?.awb || order.trackingNumber : null);
    if (!own) return NextResponse.json({ success: false, message: 'No tracking number yet.' }, { status: 404 });
    if (!isConfigured() || !order.shiprocketOrderId) {
      return NextResponse.json({ success: true, data: { awb: own, courierName: order.courierName || null, manual: true, activities: [] } });
    }
    const tracking = await trackShiprocketAWB(String(own).split(',')[0].trim());
    return NextResponse.json({ success: true, data: tracking });
  } catch (e) {
    console.error('[vendor tracking]', e.message);
    return NextResponse.json({ success: false, message: 'Tracking is unavailable right now. Try again shortly.' }, { status: 502 });
  }
}
