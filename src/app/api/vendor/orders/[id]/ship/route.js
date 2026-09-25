import { NextResponse } from 'next/server';
import { requireActiveVendor } from '@/lib/vendorAuth';
import { toVendorOrderDetail, vendorFulfils, vendorTransitionError } from '@/lib/vendorOrders';
import { applyOrderUpdate, OrderStateError } from '@/lib/orderStatus';
import { createShiprocketOrder, assignAwb, getFreightQuote, isConfigured } from '@/lib/shiprocket';

export const maxDuration = 60;

const forbidden = (message = 'Forbidden') => NextResponse.json({ success: false, message }, { status: 403 });

/* POST /api/vendor/orders/:id/ship
     { courierName, trackingNumber }  — the vendor booked the courier themselves
     { shiprocket: true }             — book through Tulsi's Shiprocket account,
                                        from the vendor's own pickup address
   Either way the order moves to Shipped through the shared status path
   (customer email + WhatsApp). A Shiprocket booking also records the
   courier charge, which is deducted from the vendor's payout unless they
   set their own per-piece shipping charge. */
export async function POST(request, context) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const doc = await ctx.db.collection('orders').doc(String(id)).get();
    const order = doc.exists ? { id: doc.id, ...doc.data() } : null;
    if (!order || !Array.isArray(order.vendorIds) || !order.vendorIds.includes(ctx.vendorId)) return forbidden();
    if (!vendorFulfils(order, ctx.vendorId, ctx.vendor)) return forbidden('Tulsi ships this order.');
    const precheck = order.status === 'shipped' ? null : vendorTransitionError(order, 'shipped', { trackingNumber: 'pending' });
    if (precheck) return NextResponse.json({ success: false, message: precheck }, { status: 400 });

    let trackingNumber;
    let courierName;
    const extra = {};

    if (body.shiprocket === true) {
      if (!isConfigured()) return NextResponse.json({ success: false, message: 'Shiprocket isn’t set up — add the tracking number manually.' }, { status: 400 });
      const pickupLocation = ctx.vendor.shiprocketPickupLocation;
      if (!pickupLocation) {
        return NextResponse.json({ success: false, message: 'Your pickup address isn’t registered with Tulsi’s Shiprocket yet. Ask Tulsi to add it, or enter your own courier’s tracking number.' }, { status: 400 });
      }
      let result;
      if (order.shiprocketShipmentId && !order.trackingNumber) {
        const awb = await assignAwb(order.shiprocketShipmentId);
        result = { success: true, orderId: order.shiprocketOrderId, shipmentId: order.shiprocketShipmentId, ...awb };
      } else {
        result = await createShiprocketOrder(order, null, { pickupLocation });
        if (!result.success) {
          console.error('[vendor ship] Shiprocket create failed:', JSON.stringify(result.data));
          return NextResponse.json({ success: false, message: `Shiprocket: ${result.message}` }, { status: 400 });
        }
      }
      if (!result.awb) {
        await ctx.db.collection('orders').doc(order.id).update({ shiprocketOrderId: result.orderId, shiprocketShipmentId: result.shipmentId, updatedAt: new Date().toISOString() });
        return NextResponse.json({ success: false, message: `Booked in Shiprocket but no courier was assigned yet: ${result.awbError}. Try again shortly.` }, { status: 400 });
      }
      trackingNumber = result.awb;
      courierName = result.courierName || 'Shiprocket';
      extra.shiprocketOrderId = result.orderId;
      extra.shiprocketShipmentId = result.shipmentId;
      if (order.shippingCostSource !== 'manual') {
        const quote = await getFreightQuote({ pincode: order.shippingAddress?.pincode, cod: order.payment?.method === 'cod', courierId: result.courierId }).catch(() => null);
        if (quote !== null && quote !== undefined) { extra.shippingCostActual = quote; extra.shippingCostSource = 'shiprocket_quote'; }
      }
    } else {
      trackingNumber = String(body.trackingNumber || '').trim();
      courierName = String(body.courierName || '').trim();
      if (!/^[A-Za-z0-9-]{4,40}$/.test(trackingNumber)) return NextResponse.json({ success: false, message: 'Enter the tracking number (letters, numbers and - only).' }, { status: 400 });
      if (!courierName || courierName.length > 40 || /[<>]/.test(courierName)) return NextResponse.json({ success: false, message: 'Enter the courier name.' }, { status: 400 });
    }

    const { after } = await applyOrderUpdate(ctx.db, order.id,
      { status: order.status === 'shipped' ? undefined : 'shipped', trackingNumber, courierName, extra: { ...extra, statusUpdatedBy: `vendor:${ctx.vendorId}` } },
      {
        writeFulfilmentFields: true,
        codPaidOnDelivery: false,
        check(fresh) {
          if (!vendorFulfils(fresh, ctx.vendorId, ctx.vendor)) throw new OrderStateError('Tulsi ships this order.');
          if (fresh.status !== 'shipped') {
            const err = vendorTransitionError(fresh, 'shipped', { trackingNumber });
            if (err) throw new OrderStateError(err);
          }
        },
      });
    return NextResponse.json({ success: true, data: toVendorOrderDetail({ ...after, id: order.id }, ctx.vendorId, ctx.vendor) });
  } catch (e) {
    if (e instanceof OrderStateError) return NextResponse.json({ success: false, message: e.message }, { status: 400 });
    console.error('[vendor ship]', e.message);
    return NextResponse.json({ success: false, message: 'Could not ship the order' }, { status: 500 });
  }
}
