import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderNumber = searchParams.get('orderNumber')?.trim();
    const email = searchParams.get('email')?.trim().toLowerCase();

    if (!orderNumber || !email) {
      return NextResponse.json({ success: false, message: 'Order number and email are required' }, { status: 400 });
    }

    const db = getDB();
    const snap = await db.collection('orders').where('orderNumber', '==', orderNumber).limit(1).get();

    if (snap.empty) {
      return NextResponse.json({ success: false, message: 'Order not found. Please check your order number.' }, { status: 404 });
    }

    const doc = snap.docs[0];
    const order = { id: doc.id, ...doc.data() };

    // Verify email matches — check guestEmail, shippingAddress email/fullName email, or userId email
    const orderEmail = (order.guestEmail || order.shippingAddress?.email || '').toLowerCase();
    const shippingEmail = (order.shippingAddress?.email || '').toLowerCase();
    if (orderEmail !== email && shippingEmail !== email) {
      return NextResponse.json({ success: false, message: 'Email does not match this order.' }, { status: 403 });
    }

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
        courierName: order.courierName || null,
        items: (order.items || []).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, image: i.image })),
        subtotal: order.subtotal || 0,
        total: order.total,
        shippingCost: order.shippingCost,
        discount: order.discount || 0,
        payment: { method: order.payment?.method, status: order.payment?.status },
        shippingAddress: {
          name:    order.shippingAddress?.name || order.shippingAddress?.fullName || '',
          street:  order.shippingAddress?.street || '',
          city:    order.shippingAddress?.city || '',
          state:   order.shippingAddress?.state || '',
          pincode: order.shippingAddress?.pincode || '',
          phone:   order.shippingAddress?.phone || '',
        },
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
