import { NextResponse } from 'next/server';
import { requireVendor, requireActiveVendor } from '@/lib/vendorAuth';
import { toVendorOrderDetail, vendorFulfils, vendorTransitionError } from '@/lib/vendorOrders';
import { applyOrderUpdate, OrderStateError } from '@/lib/orderStatus';
import { autoDispatchOnPacked } from '@/lib/shipmentDispatch';
import { vendorHasPickup } from '@/lib/shipmentPlan';

/* One answer for "not yours", "not self-fulfilled by you" and "doesn't
   exist", so order ids can't be probed. */
const forbidden = (message = 'Forbidden') => NextResponse.json({ success: false, message }, { status: 403 });

async function load(ctx, id) {
  const [doc, vendorSnap] = await Promise.all([
    ctx.db.collection('orders').doc(String(id)).get(),
    ctx.vendor ? null : ctx.db.collection('vendors').doc(ctx.vendorId).get(),
  ]);
  const vendor = ctx.vendor || (vendorSnap?.exists ? vendorSnap.data() : {});
  const order = doc.exists ? { id: doc.id, ...doc.data() } : null;
  const mine = order && Array.isArray(order.vendorIds) && order.vendorIds.includes(ctx.vendorId);
  return { order: mine ? order : null, vendor };
}

/* GET /api/vendor/orders/:id — IDOR guard: only an order containing this
   vendor's pieces, cut down to those pieces. */
export async function GET(request, context) {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { id } = await context.params;
    const { order, vendor } = await load(ctx, id);
    const view = order && toVendorOrderDetail(order, ctx.vendorId, vendor);
    if (!view) return forbidden();
    return NextResponse.json({ success: true, data: view });
  } catch (e) {
    console.error('[vendor/orders/:id]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load the order' }, { status: 500 });
  }
}

/* PATCH /api/vendor/orders/:id — { status?, trackingNumber?, courierName? }
   Only on an order this vendor fulfils (every piece theirs, and Tulsi has
   switched on self-shipping for them), and only along the vendor state
   machine (vendorTransitionError). Rechecked inside the transaction on the
   fresh order. Stock, points, settlement and customer notifications go
   through the same code path as the admin panel (applyOrderUpdate). */
export async function PATCH(request, context) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const extraKeys = Object.keys(body || {}).filter((k) => !['status', 'trackingNumber', 'courierName'].includes(k));
    if (extraKeys.length) return forbidden(`These fields are managed by Tulsi: ${extraKeys.join(', ')}`);

    const status = body.status || undefined;
    const trackingNumber = body.trackingNumber !== undefined ? String(body.trackingNumber).trim().slice(0, 40) : undefined;
    const courierName = body.courierName !== undefined ? String(body.courierName).trim().slice(0, 40) : undefined;
    if (trackingNumber && !/^[A-Za-z0-9-]{4,40}$/.test(trackingNumber)) {
      return NextResponse.json({ success: false, message: 'Tracking number: letters, numbers and - only.' }, { status: 400 });
    }
    if (courierName && /[<>]/.test(courierName)) return NextResponse.json({ success: false, message: 'Invalid courier name.' }, { status: 400 });
    if (!status && trackingNumber === undefined && courierName === undefined) {
      return NextResponse.json({ success: false, message: 'Nothing to update.' }, { status: 400 });
    }

    const { order } = await load(ctx, id);
    if (!order || !vendorFulfils(order, ctx.vendorId, ctx.vendor)) {
      return forbidden(order ? 'Tulsi handles this order — contact Tulsi to change it.' : 'Forbidden');
    }

    const { after, settlementNote } = await applyOrderUpdate(ctx.db, order.id,
      {
        status,
        trackingNumber,
        courierName,
        extra: {
          ...(status && { statusUpdatedBy: `vendor:${ctx.vendorId}` }),
          ...(status === 'delivered' && { deliveryReportedBy: 'vendor' }),
        },
      },
      {
        writeFulfilmentFields: true,
        /* A vendor saying "delivered" doesn't prove Tulsi has the COD cash:
           it stays unpaid (no payout) until Tulsi confirms it. */
        codPaidOnDelivery: false,
        check(fresh) {
          if (!vendorFulfils(fresh, ctx.vendorId, ctx.vendor)) throw new OrderStateError('Tulsi handles this order.');
          if (status) {
            const err = vendorTransitionError(fresh, status, { trackingNumber });
            if (err) throw new OrderStateError(err);
          } else if (!['confirmed', 'processing', 'shipped'].includes(fresh.status)) {
            throw new OrderStateError('Tracking can only be changed before delivery.');
          }
        },
      });

    /* Packed → book the vendor's parcel from their warehouse right away. */
    let data = toVendorOrderDetail({ ...after, id: order.id }, ctx.vendorId, ctx.vendor);
    let dispatch = null;
    if (status === 'processing' && vendorHasPickup(ctx.vendor)) {
      dispatch = await autoDispatchOnPacked(ctx.db, order.id, { onlyKey: ctx.vendorId });
      const fresh = await ctx.db.collection('orders').doc(order.id).get();
      data = toVendorOrderDetail({ id: order.id, ...fresh.data() }, ctx.vendorId, ctx.vendor);
    }
    return NextResponse.json({
      success: true,
      data,
      ...(dispatch && { dispatch }),
      ...(status === 'delivered' && order.payment?.method === 'cod' && { note: 'Marked delivered. Your earnings post once Tulsi confirms the COD cash has come in.' }),
      ...(settlementNote && status !== 'delivered' && { note: settlementNote }),
    });
  } catch (e) {
    if (e instanceof OrderStateError) return NextResponse.json({ success: false, message: e.message }, { status: 400 });
    console.error('[vendor/orders/:id PATCH]', e.message);
    return NextResponse.json({ success: false, message: 'Could not update the order' }, { status: 500 });
  }
}
