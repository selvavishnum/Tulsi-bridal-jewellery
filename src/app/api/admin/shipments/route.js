import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { trackShiprocketAWB, isConfigured } from '@/lib/shiprocket';
import { dispatchOrder, DispatchError, parcelsFor } from '@/lib/shipmentDispatch';
import { applyOrderUpdate } from '@/lib/orderStatus';

/* POST /api/admin/shipments — book an order's parcels on Tulsi's Shiprocket
   account (split per pickup warehouse), or record a manual courier. The
   courier charge is stored on the order and deducted from vendor earnings
   on delivery — per vendor when parcels are split. */
export async function POST(request) {
  try {
    const auth = await requireRole(CAN.fulfilOrders);
    if (auth.error) return auth.error;
    const { session } = auth;

    const { orderId, courierId, manualTracking, courierName, trackingNumber, shippingCost } = await request.json();
    if (!orderId) return NextResponse.json({ success: false, message: 'orderId required' }, { status: 400 });

    const db = getDB();
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    const order = orderDoc.data();
    if (order.status === 'cancelled') {
      return NextResponse.json({ success: false, message: 'This order is cancelled — it cannot be shipped.' }, { status: 400 });
    }
    /* Fulfilment staff ship confirmed orders only (a pending COD order hasn't
       had its stock deducted yet); re-shipping to fix tracking is fine. */
    if (!CAN.manageOrders.includes(auth.tier) && !['confirmed', 'processing', 'shipped'].includes(order.status)) {
      return NextResponse.json({ success: false, message: 'Only confirmed orders can be shipped — ask a Super Admin to confirm this one first.' }, { status: 400 });
    }

    const isSuper = CAN.manageOrders.includes(auth.tier); // may set the courier charge
    const sentCost = shippingCost !== undefined && shippingCost !== '' && shippingCost !== null;
    /* The courier charge is deducted from vendor payouts, so setting it is a
       financial action: fulfilment staff book the parcel, a Super Admin
       records what it cost (or the Shiprocket quote does, automatically). */
    if (sentCost && !isSuper) {
      return NextResponse.json({ success: false, message: 'Forbidden: only a Super Admin can record the courier charge' }, { status: 403 });
    }
    let manualCost;
    if (sentCost) {
      manualCost = Number(shippingCost);
      if (!Number.isFinite(manualCost) || manualCost < 0) {
        return NextResponse.json({ success: false, message: 'Shipping cost must be a number ≥ 0' }, { status: 400 });
      }
    }

    /* Manual tracking entry (without Shiprocket) */
    if (manualTracking) {
      /* Through the shared status path: customer is notified on the first
         move to Shipped, and a hand-entered charge replaces parcel quotes. */
      await applyOrderUpdate(db, orderId,
        { status: order.status === 'shipped' ? undefined : 'shipped', trackingNumber: String(trackingNumber || ''), courierName: String(courierName || ''), shippingCostPatch: manualCost },
        { writeFulfilmentFields: true });
      return NextResponse.json({ success: true, message: 'Tracking updated', manual: true });
    }

    /* Shiprocket: one parcel per pickup warehouse — Tulsi's, and each
       self-shipping vendor's (shipmentDispatch). Parcels already booked are
       kept; the rest are booked now. */
    let dispatched;
    try {
      dispatched = await dispatchOrder(db, orderId, { courierId });
    } catch (e) {
      if (e instanceof DispatchError) return NextResponse.json({ success: false, message: e.message }, { status: 400 });
      throw e;
    }
    const { results, summary } = dispatched;
    const failed = results.filter((r) => !r.ok);
    if (summary.allBooked) {
      /* Every parcel has an AWB: the order is shipped (customer notified). */
      await applyOrderUpdate(db, orderId,
        { status: order.status === 'shipped' ? undefined : 'shipped', trackingNumber: summary.trackingNumber, courierName: summary.courierName },
        { writeFulfilmentFields: true });
    }
    return NextResponse.json({
      success: failed.length === 0,
      message: failed.length
        ? failed.map((f) => `${f.key === 'tulsi' ? 'Tulsi warehouse' : 'Vendor warehouse'}: ${f.error}`).join(' · ')
        : summary.allBooked ? `Booked ${results.length} parcel(s): ${summary.trackingNumber}` : 'Booked.',
      data: { parcels: results, awb: summary.trackingNumber, ...(isSuper && { shippingCostActual: summary.shippingCost }) },
    }, { status: failed.length ? 400 : 200 });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

/* GET /api/admin/shipments?orderId=xxx — Get tracking status */
export async function GET(request) {
  try {
    const auth = await requireRole(CAN.fulfilOrders);
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
      const parcels = parcelsFor(order).filter((p) => p.awb);
      if (!parcels.length && !order.trackingNumber) return NextResponse.json({ success: false, message: 'No tracking number' });
      if (!parcels.length || !isConfigured()) {
        return NextResponse.json({ success: true, data: { awb: order.trackingNumber, courierName: order.courierName, manual: true, parcels: [] } });
      }
      const tracked = await Promise.all(parcels.map(async (p) => ({ ...p, tracking: await trackShiprocketAWB(p.awb).catch((e) => ({ success: false, message: e.message })) })));
      return NextResponse.json({ success: true, data: { parcels: tracked, ...(tracked[0]?.tracking || {}) } });
    }

    return NextResponse.json({ success: false, message: 'orderId or awb required' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
