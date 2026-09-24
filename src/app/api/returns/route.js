import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { toCustomerOrder, RETURN_WINDOW_DAYS } from '@/lib/settlement';
import { ownsOrder, canMatchGuestOrders } from '@/lib/orderOwnership';

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    if (!session?.user) return NextResponse.json({ success: false, message: 'Login required' }, { status: 401 });

    const { orderId, reason, description } = await request.json();
    if (!orderId || !reason) return NextResponse.json({ success: false, message: 'Order and reason required' }, { status: 400 });

    const db = getDB();

    const orderSnap = await db.collection('orders').doc(String(orderId)).get();
    /* Same answer for "not yours" and "doesn't exist" — no probing ids. */
    if (!orderSnap.exists || !ownsOrder(orderSnap.data(), session.user)) {
      return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }
    const order = { id: orderSnap.id, ...orderSnap.data() };

    /* Only a paid, delivered order, inside the return window — otherwise a
       cancelled (already refunded) or undelivered order could be refunded
       again. */
    if (order.payment?.status !== 'paid') {
      return NextResponse.json({ success: false, message: 'This order has not been paid for yet.' }, { status: 400 });
    }
    if (order.status !== 'delivered' || !order.deliveredAt) {
      return NextResponse.json({ success: false, message: 'Returns open once the order is delivered.' }, { status: 400 });
    }
    if (Date.now() - new Date(order.deliveredAt).getTime() > RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ success: false, message: `Returns are accepted within ${RETURN_WINDOW_DAYS} days of delivery.` }, { status: 400 });
    }

    /* One return per order, enforced by the id itself: parallel requests
       can't open two refunds for the same order. */
    const ref = db.collection('returns').doc(String(orderId));
    /* Refund value comes from the stored order, never from the request body */
    /* Customer-safe copy: the stored order items carry the platform's
       supply cost and vendor id, which must never reach the shopper. */
    const returnItems = toCustomerOrder({ items: order.items || [] }).items;
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
      reason: String(reason).slice(0, 200),
      description: String(description || '').slice(0, 2000),
      returnStatus: 'requested',
      refundStatus: 'pending',
      refundAmount,
      adminNote: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const legacy = await db.collection('returns').where('orderId', '==', String(orderId)).limit(1).get();
    const created = legacy.empty && await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, doc);
      return true;
    });
    if (!created) return NextResponse.json({ success: false, message: 'A return request already exists for this order' }, { status: 400 });
    return NextResponse.json({ success: true, data: { id: ref.id, ...doc } }, { status: 201 });
  } catch (e) {
    console.error('[returns]', e.message);
    return NextResponse.json({ success: false, message: 'Something went wrong. Please try again.' }, { status: 500 });
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
      canMatchGuestOrders(session.user)
        ? db.collection('returns').where('customerEmail', '==', String(session.user.email).toLowerCase()).get()
        : Promise.resolve({ docs: [] }),
    ]);

    const seen = new Set();
    const results = [];
    for (const doc of [...byUserId.docs, ...byEmail.docs]) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        const r = { id: doc.id, ...doc.data() };
        // Returns opened before the fix stored raw order items — strip on the way out too.
        if (Array.isArray(r.items)) r.items = toCustomerOrder({ items: r.items }).items;
        results.push(r);
      }
    }
    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return NextResponse.json({ success: true, data: results });
  } catch (e) {
    console.error('[returns]', e.message);
    return NextResponse.json({ success: false, message: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
