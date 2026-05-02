import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import { createShiprocketOrder, trackShiprocketAWB, isConfigured } from '@/lib/shiprocket';

/* POST /api/admin/shipments — Create Shiprocket shipment for an order */
export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { orderId, courierId, manualTracking, courierName, trackingNumber } = await request.json();
    if (!orderId) return NextResponse.json({ success: false, message: 'orderId required' }, { status: 400 });

    const db = getDB();
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });

    /* Manual tracking entry (without Shiprocket) */
    if (manualTracking) {
      await db.collection('orders').doc(orderId).update({
        trackingNumber: trackingNumber || '',
        courierName:    courierName   || '',
        status:         'shipped',
        shippedAt:      new Date().toISOString(),
        updatedAt:      new Date().toISOString(),
      });
      return NextResponse.json({ success: true, message: 'Tracking updated', manual: true });
    }

    /* Shiprocket auto-create */
    if (!isConfigured()) {
      return NextResponse.json({
        success: false,
        message: 'Shiprocket not configured. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in your .env.local file.',
      }, { status: 400 });
    }

    const order = orderDoc.data();
    const result = await createShiprocketOrder(order, courierId);
    if (!result.success) {
      return NextResponse.json({ success: false, message: result.message, details: result.data }, { status: 400 });
    }

    /* Save shipment info to order */
    await db.collection('orders').doc(orderId).update({
      shiprocketOrderId:    result.orderId,
      shiprocketShipmentId: result.shipmentId,
      trackingNumber:       result.awb || '',
      courierName:          result.courierName || '',
      status:               'shipped',
      shippedAt:            new Date().toISOString(),
      updatedAt:            new Date().toISOString(),
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

/* GET /api/admin/shipments?orderId=xxx — Get tracking status */
export async function GET(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');
    const awb     = searchParams.get('awb');

    if (awb) {
      if (!isConfigured()) {
        return NextResponse.json({ success: false, message: 'Shiprocket not configured' }, { status: 400 });
      }
      const tracking = await trackShiprocketAWB(awb);
      return NextResponse.json(tracking);
    }

    if (orderId) {
      const db = getDB();
      const doc = await db.collection('orders').doc(orderId).get();
      if (!doc.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
      const order = doc.data();
      if (!order.trackingNumber) return NextResponse.json({ success: false, message: 'No tracking number' });

      if (isConfigured() && order.trackingNumber.length > 5) {
        const tracking = await trackShiprocketAWB(order.trackingNumber);
        return NextResponse.json({ success: true, data: { ...tracking, courierName: order.courierName } });
      }
      return NextResponse.json({ success: true, data: { awb: order.trackingNumber, courierName: order.courierName, manual: true } });
    }

    return NextResponse.json({ success: false, message: 'orderId or awb required' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
