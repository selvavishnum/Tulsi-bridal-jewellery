import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// Check if order is within 3-day return window
function withinReturnWindow(order) {
  const ref = order.deliveredAt || order.updatedAt || order.createdAt;
  if (!ref) return false;
  const diffMs = Date.now() - new Date(ref).getTime();
  return diffMs <= 3 * 24 * 60 * 60 * 1000;
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ success: false, message: 'Login required' }, { status: 401 });

    const { orderId, reason, description, items } = await request.json();
    if (!orderId || !reason) return NextResponse.json({ success: false, message: 'Order and reason required' }, { status: 400 });

    const db = getDB();

    // Verify order belongs to user and is delivered
    const orderSnap = await db.collection('orders').doc(orderId).get();
    if (!orderSnap.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });

    const order = { id: orderSnap.id, ...orderSnap.data() };
    if (order.userId !== session.user.id && order.guestEmail !== session.user.email) {
      return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    }
    if (order.status !== 'delivered') {
      return NextResponse.json({ success: false, message: 'Only delivered orders can be returned' }, { status: 400 });
    }
    if (!withinReturnWindow(order)) {
      return NextResponse.json({ success: false, message: 'Return window of 3 days has passed' }, { status: 400 });
    }

    // Check no existing return request for this order
    const existingSnap = await db.collection('returns').where('orderId', '==', orderId).get();
    if (!existingSnap.empty) {
      return NextResponse.json({ success: false, message: 'A return request already exists for this order' }, { status: 400 });
    }

    const ref = db.collection('returns').doc();
    const returnItems = items?.length ? items : order.items || [];
    const refundAmount = returnItems.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);

    const doc = {
      orderId,
      orderNumber: order.orderNumber || orderId,
      userId: session.user.id || '',
      customerName: order.shippingAddress?.fullName || session.user.name || '',
      customerEmail: session.user.email || '',
      customerPhone: order.shippingAddress?.phone || '',
      orderTotal: order.total || 0,
      paymentMethod: order.payment?.method || '',
      paymentStatus: order.payment?.status || '',
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

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ success: false, message: 'Login required' }, { status: 401 });

    const db = getDB();
    const snap = await db.collection('returns')
      .where('userId', '==', session.user.id || '')
      .orderBy('createdAt', 'desc')
      .get();

    return NextResponse.json({ success: true, data: snapshotToArr(snap) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
