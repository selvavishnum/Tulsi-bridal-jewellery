import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { generateLabel, isConfigured, ShiprocketError } from '@/lib/shiprocket';

/* POST /api/admin/shipments/label { orderId } — Shiprocket's printable
   label(s) for every booked parcel of the order (one PDF). */
export async function POST(request) {
  try {
    const auth = await requireRole(CAN.fulfilOrders);
    if (auth.error) return auth.error;
    const { orderId } = await request.json().catch(() => ({}));
    if (!orderId) return NextResponse.json({ success: false, message: 'orderId required' }, { status: 400 });
    if (!isConfigured()) return NextResponse.json({ success: false, message: 'Shiprocket isn’t set up.' }, { status: 400 });
    const snap = await getDB().collection('orders').doc(String(orderId)).get();
    if (!snap.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    const order = snap.data();
    const ids = Object.values(order.shipments || {}).filter((s) => s.awb && s.shipmentId).map((s) => s.shipmentId);
    if (!ids.length && order.shiprocketShipmentId && order.trackingNumber) ids.push(order.shiprocketShipmentId);
    if (!ids.length) return NextResponse.json({ success: false, message: 'Book the courier first — labels exist only for booked parcels.' }, { status: 400 });
    const labelUrl = await generateLabel(ids);
    return NextResponse.json({ success: true, data: { labelUrl, parcels: ids.length } });
  } catch (e) {
    if (e instanceof ShiprocketError) return NextResponse.json({ success: false, message: e.message }, { status: 400 });
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
