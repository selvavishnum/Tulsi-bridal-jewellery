import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session?.user) return NextResponse.json({ success: false, message: 'Login required' }, { status: 401 });

    const { orderId, reason, description, items } = await request.json();
    if (!orderId || !reason) return NextResponse.json({ success: false, message: 'Order and reason required' }, { status: 400 });

    const db = getDB();

    // Find the order using the same dual-query as GET /api/orders
    const [byUserId, byEmail] = await Promise.all([
      session.user.id
        ? db.collection('orders').where('userId', '==', session.user.id).get()
        : Promise.resolve({ docs: [] }),
      session.user.email
        ? db.collection('orders').where('guestEmail', '==', session.user.email).get()
        : Promise.resolve({ docs: [] }),
    ]);

    const allDocs = [...byUserId.docs, ...byEmail.docs];
    const orderDoc = allDocs.find((d) => d.id === orderId);

    if (!orderDoc) {
      // Fallback: fetch by doc ID and check shippingAddress.email
      const directSnap = await db.collection('orders').doc(orderId).get();
      if (!directSnap.exists) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
      }
      const directOrder = directSnap.data();
      const emailMatch =
        directOrder.shippingAddress?.email === session.user.email ||
        directOrder.shippingAddress?.name === session.user.email;
      if (!emailMatch) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
      }
    }

    const orderSnap = orderDoc || await db.collection('orders').doc(orderId).get();
    const order = { id: orderSnap.id || orderId, ...orderSnap.data() };

    /* Only a paid order can be refunded — otherwise a return could be opened
       against an unpaid order and approved for money that never came in. */
    if (order.payment?.status !== 'paid') {
      return NextResponse.json(
        { success: false, message: 'This order has not been paid for yet.' },
        { status: 400 }
      );
    }

    // Check no existing return request for this order
    const existingSnap = await db.collection('returns').where('orderId', '==', orderId).get();
    if (!existingSnap.empty) {
      return NextResponse.json({ success: false, message: 'A return request already exists for this order' }, { status: 400 });
    }

    const ref = db.collection('returns').doc();
    /* Refund value comes from the stored order, never from the request body */
    const returnItems = order.items || [];
    const refundAmount = Number(order.total) || 0;

    const doc = {
      orderId,
      orderNumber: order.orderNumber || orderId,
      userId: session.user.id || '',
      customerName: order.shippingAddress?.fullName || order.shippingAddress?.name || session.user.name || '',
      customerEmail: session.user.email || '',
      customerPhone: order.shippingAddress?.phone || '',
      orderTotal: order.total || 0,
      paymentMethod: order.payment?.method || '',
      paymentStatus: order.payment?.status || '',
      orderStatus: order.status || '',
      items: returnItems,
      reason,
      description: description || '',
      returnStatus: 'requested',
      refundStatus: 'pending',
      refundAmount,
      adminNote: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await ref.set(doc);
    return NextResponse.json({ success: true, data: { id: ref.id, ...doc } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getEffectiveSession();
    if (!session?.user) return NextResponse.json({ success: false, message: 'Login required' }, { status: 401 });

    const db = getDB();

    const [byUserId, byEmail] = await Promise.all([
      session.user.id
        ? db.collection('returns').where('userId', '==', session.user.id).get()
        : Promise.resolve({ docs: [] }),
      session.user.email
        ? db.collection('returns').where('customerEmail', '==', session.user.email).get()
        : Promise.resolve({ docs: [] }),
    ]);

    const seen = new Set();
    const results = [];
    for (const doc of [...byUserId.docs, ...byEmail.docs]) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        results.push({ id: doc.id, ...doc.data() });
      }
    }
    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return NextResponse.json({ success: true, data: results });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
