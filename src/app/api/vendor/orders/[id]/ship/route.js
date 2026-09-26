import { NextResponse } from 'next/server';
import { requireActiveVendor } from '@/lib/vendorAuth';
import { toVendorOrderDetail, vendorFulfils, vendorShipsParcel, vendorTransitionError } from '@/lib/vendorOrders';
import { applyOrderUpdate, OrderStateError } from '@/lib/orderStatus';
import { dispatchOrder, DispatchError } from '@/lib/shipmentDispatch';

export const maxDuration = 60;

const forbidden = (message = 'Forbidden') => NextResponse.json({ success: false, message }, { status: 403 });

/* POST /api/vendor/orders/:id/ship
     { shiprocket: true }             — book this vendor's parcel on Tulsi's
                                        Shiprocket, from their registered
                                        warehouse (also their part of an order
                                        that mixes several sellers)
     { courierName, trackingNumber }  — the vendor's own courier (only on an
                                        order that is entirely theirs)
   When every parcel of the order is booked, the order moves to Shipped
   through the shared status path (customer email + WhatsApp). */
export async function POST(request, context) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const doc = await ctx.db.collection('orders').doc(String(id)).get();
    const order = doc.exists ? { id: doc.id, ...doc.data() } : null;
    if (!order || !Array.isArray(order.vendorIds) || !order.vendorIds.includes(ctx.vendorId)) return forbidden();
    const fulfils = vendorFulfils(order, ctx.vendorId, ctx.vendor);

    let trackingNumber;
    let courierName;
    if (body.shiprocket === true) {
      if (!vendorShipsParcel(order, ctx.vendorId, ctx.vendor)) {
        return forbidden(ctx.vendor.shiprocketPickupLocation
          ? 'This order isn’t ready to ship from your warehouse (it must be confirmed first).'
          : 'Save your warehouse address in Store Profile first — it registers your pickup with Tulsi’s Shiprocket.');
      }
      let result;
      try {
        result = await dispatchOrder(ctx.db, order.id, { onlyKey: ctx.vendorId });
      } catch (e) {
        if (e instanceof DispatchError) return NextResponse.json({ success: false, message: e.message }, { status: 400 });
        throw e;
      }
      const mine = result.results.find((r) => r.key === ctx.vendorId);
      if (!mine?.ok) return NextResponse.json({ success: false, message: mine?.error || 'Could not book the courier.' }, { status: 400 });
      if (!result.summary.allBooked) {
        const fresh = (await ctx.db.collection('orders').doc(order.id).get()).data();
        return NextResponse.json({ success: true, message: `Booked — AWB ${mine.awb}. The order shows as shipped once every seller’s parcel is booked.`, data: toVendorOrderDetail({ id: order.id, ...fresh }, ctx.vendorId, ctx.vendor) });
      }
      trackingNumber = result.summary.trackingNumber;
      courierName = result.summary.courierName;
    } else {
      if (!fulfils) return forbidden('Tulsi ships this order.');
      trackingNumber = String(body.trackingNumber || '').trim();
      courierName = String(body.courierName || '').trim();
      if (!/^[A-Za-z0-9-]{4,40}$/.test(trackingNumber)) return NextResponse.json({ success: false, message: 'Enter the tracking number (letters, numbers and - only).' }, { status: 400 });
      if (!courierName || courierName.length > 40 || /[<>]/.test(courierName)) return NextResponse.json({ success: false, message: 'Enter the courier name.' }, { status: 400 });
    }

    const { after } = await applyOrderUpdate(ctx.db, order.id,
      { status: order.status === 'shipped' ? undefined : 'shipped', trackingNumber, courierName, extra: { statusUpdatedBy: `vendor:${ctx.vendorId}` } },
      {
        writeFulfilmentFields: true,
        codPaidOnDelivery: false,
        check(fresh) {
          if (fresh.status !== 'shipped' && !['confirmed', 'processing'].includes(fresh.status)) {
            throw new OrderStateError(vendorTransitionError(fresh, 'shipped', { trackingNumber }) || 'This order can’t be shipped now.');
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
