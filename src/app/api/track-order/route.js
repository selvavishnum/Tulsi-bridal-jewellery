import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderNumber = searchParams.get('orderNumber')?.trim();
    const email = searchParams.get('email')?.trim().toLowerCase();

    if (!orderNumber || !email) {
      return NextResponse.json({ success: false, message: 'Order number and email are required' }, { status: 400 });
    }

    const db = getDB();
    const limited = await hit(db, `track:ip:${clientIp(request.headers)}`, LIMITS.trackOrder);
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Too many lookups. Please try again later.');

    const snap = await db.collection('orders').where('orderNumber', '==', orderNumber).limit(1).get();
    /* One answer for "no such order" and "wrong email", so order numbers
       can't be confirmed without the matching email. */
    const notFound = () => NextResponse.json({ success: false, message: 'No order matches that order number and email.' }, { status: 404 });
    if (snap.empty) return notFound();

    const doc = snap.docs[0];
    const order = { id: doc.id, ...doc.data() };

    // Verify email matches — check guestEmail, shippingAddress email/fullName email, or userId email
    const orderEmail = (order.guestEmail || order.shippingAddress?.email || '').toLowerCase();
    const shippingEmail = (order.shippingAddress?.email || '').toLowerCase();
    if (orderEmail !== email && shippingEmail !== email) return notFound();

    // Return only safe public fields
    return NextResponse.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        deliveredAt: order.deliveredAt || null,
        trackingNumber: order.trackingNumber || null,
        /* Split orders ship as several parcels from different warehouses. */
        parcels: Object.values(order.shipments || {}).filter((p) => p.awb)
          .map((p) => ({ awb: p.awb, courierName: p.courierName || null, trackingUrl: p.trackingUrl || null, items: (p.items || []).map((i) => i.name) })),
        courierName: order.courierName || null,
        items: (order.items || []).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, image: i.image })),
        subtotal: order.subtotal || 0,
        total: order.total,
        shippingCost: order.shippingCost,
        codFee: order.codFee || 0,
        discount: order.discount || 0,
        payment: { method: order.payment?.method, status: order.payment?.status },
        shippingAddress: {
          name:    order.shippingAddress?.name || order.shippingAddress?.fullName || '',

          city:    order.shippingAddress?.city || '',
          state:   order.shippingAddress?.state || '',
          pincode: order.shippingAddress?.pincode || '',
          /* Street and full phone aren't needed to track a parcel. */
          phone:   order.shippingAddress?.phone ? `••••••${String(order.shippingAddress.phone).slice(-4)}` : '',
        },
      },
    });
  } catch (error) {
    console.error('[track-order]', error.message);
    return NextResponse.json({ success: false, message: 'Could not look up the order right now.' }, { status: 500 });
  }
}
