import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, ROLES } from '@/lib/requireRole';
import { createShiprocketOrder, assignAwb, getFreightQuote, trackShiprocketAWB, isConfigured } from '@/lib/shiprocket';
import { sendStatusUpdateEmail } from '@/lib/email';
import { sendStatusWhatsApp } from '@/lib/whatsapp';

/* The ship modal promises the customer is told — this route used to mark
   orders shipped without ever sending the email/WhatsApp that the order
   status route sends. Only on the first transition into "shipped". */
async function notifyShipped(orderRef, previousStatus) {
  if (previousStatus === 'shipped') return;
  const snap = await orderRef.get();
  const order = { id: snap.id, _id: snap.id, ...snap.data() };
  await Promise.all([
    sendStatusUpdateEmail(order, 'shipped').catch((e) => console.error('[Email] shipped update failed:', e.message)),
    sendStatusWhatsApp(order, 'shipped').catch((e) => console.error('[WhatsApp] shipped update failed:', e.message)),
  ]);
}

/* POST /api/admin/shipments — dispatch an order through the platform's
   Shiprocket account (or record a manual courier). Every parcel ships from
   the platform's pickup address; the courier charge is stored on the order
   as shippingCostActual and deducted from vendor earnings on delivery. */
export async function POST(request) {
  try {
    const auth = await requireRole([ROLES.SUPER_ADMIN, ROLES.ORDER_FULFILLMENT_STAFF]);
    if (auth.error) return auth.error;
    const { session } = auth;

    const { orderId, courierId, manualTracking, courierName, trackingNumber, shippingCost } = await request.json();
    if (!orderId) return NextResponse.json({ success: false, message: 'orderId required' }, { status: 400 });

    const db = getDB();
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    const order = orderDoc.data();
    if (order.status === 'cancelled') {
      return NextResponse.json({ success: false, message: 'This order is cancelled — it cannot be shipped.' }, { status: 400 });
    }
    /* Fulfilment staff ship confirmed orders only (a pending COD order hasn't
       had its stock deducted yet); re-shipping to fix tracking is fine. */
    if (auth.tier === ROLES.ORDER_FULFILLMENT_STAFF && !['confirmed', 'processing', 'shipped'].includes(order.status)) {
      return NextResponse.json({ success: false, message: 'Only confirmed orders can be shipped — ask a Super Admin to confirm this one first.' }, { status: 400 });
    }

    let manualCost;
    if (shippingCost !== undefined && shippingCost !== '' && shippingCost !== null) {
      manualCost = Number(shippingCost);
      if (!Number.isFinite(manualCost) || manualCost < 0) {
        return NextResponse.json({ success: false, message: 'Shipping cost must be a number ≥ 0' }, { status: 400 });
      }
    }

    /* Manual tracking entry (without Shiprocket) */
    if (manualTracking) {
      await orderRef.update({
        trackingNumber: trackingNumber || '',
        courierName:    courierName   || '',
        status:         'shipped',
        shippedAt:      new Date().toISOString(),
        updatedAt:      new Date().toISOString(),
        ...(manualCost !== undefined && { shippingCostActual: manualCost, shippingCostSource: 'manual' }),
      });
      await notifyShipped(orderRef, order.status);
      return NextResponse.json({ success: true, message: 'Tracking updated', manual: true });
    }

    /* Shiprocket auto-create */
    if (!isConfigured()) {
      return NextResponse.json({
        success: false,
        message: 'Shiprocket is not configured. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in Vercel → Settings → Environment Variables, then redeploy.',
      }, { status: 400 });
    }

    /* A previous attempt created the Shiprocket order but got no AWB (e.g.
       low wallet balance). Retry the courier assignment on that shipment —
       creating it again would duplicate the order in Shiprocket. */
    let result;
    if (order.shiprocketShipmentId && !order.trackingNumber) {
      const awb = await assignAwb(order.shiprocketShipmentId, courierId);
      result = { success: true, orderId: order.shiprocketOrderId, shipmentId: order.shiprocketShipmentId, ...awb };
    } else {
      result = await createShiprocketOrder(order, courierId);
      if (!result.success) {
        console.error('[Shiprocket] createShiprocketOrder failed:', JSON.stringify(result.data));
        return NextResponse.json({ success: false, message: result.message, details: result.data }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    if (!result.awb) {
      /* Keep the Shiprocket ids so the next attempt retries instead of
         duplicating, but don't mark the order shipped — it previously was,
         with an empty tracking number, while nothing had been booked. */
      await orderRef.update({
        shiprocketOrderId:    result.orderId,
        shiprocketShipmentId: result.shipmentId,
        updatedAt:            now,
      });
      return NextResponse.json({
        success: false,
        message: `Shiprocket order created, but no courier was assigned: ${result.awbError}. Fix it in Shiprocket (e.g. wallet balance) and click Ship again to retry.`,
      }, { status: 400 });
    }

    /* Capture the actual courier charge unless an admin already entered one. */
    let shippingCostActual = manualCost;
    let shippingCostSource = manualCost !== undefined ? 'manual' : undefined;
    if (shippingCostActual === undefined && order.shippingCostSource !== 'manual') {
      try {
        const quote = await getFreightQuote({
          pincode: order.shippingAddress?.pincode,
          cod: order.payment?.method === 'cod',
          courierId: result.courierId,
        });
        if (quote !== null) { shippingCostActual = quote; shippingCostSource = 'shiprocket_quote'; }
      } catch (e) {
        console.error('[Shiprocket] freight quote failed:', e.message);
      }
    }

    await orderRef.update({
      shiprocketOrderId:    result.orderId,
      shiprocketShipmentId: result.shipmentId,
      trackingNumber:       result.awb,
      courierName:          result.courierName || '',
      status:               'shipped',
      shippedAt:            now,
      updatedAt:            now,
      ...(shippingCostActual !== undefined && { shippingCostActual, shippingCostSource }),
    });
    await notifyShipped(orderRef, order.status);

    const { raw: _raw, ...publicResult } = result;
    return NextResponse.json({ success: true, data: { ...publicResult, shippingCostActual: shippingCostActual ?? null } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

/* GET /api/admin/shipments?orderId=xxx — Get tracking status */
export async function GET(request) {
  try {
    const auth = await requireRole([ROLES.SUPER_ADMIN, ROLES.ORDER_FULFILLMENT_STAFF]);
    if (auth.error) return auth.error;
    const { session } = auth;

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
