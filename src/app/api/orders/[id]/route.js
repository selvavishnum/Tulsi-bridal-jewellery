import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { getEffectiveSession, requireAdmin } from '@/lib/adminCollection';

export async function GET(request, { params }) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const doc = await db.collection('orders').doc(params.id).get();
    if (!doc.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    const order = docToObj(doc);
    if (session.user.role !== 'admin' && order.userId !== session.user.id) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ success: true, data: order });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const { status, trackingNumber, notes } = await request.json();
    const ref = db.collection('orders').doc(params.id);

    // Non-admin users can only cancel their own orders if still pending/confirmed
    if (session.user.role !== 'admin') {
      if (status !== 'cancelled') {
        return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
      }
      const orderDoc = await ref.get();
      if (!orderDoc.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
      const order = orderDoc.data();
      const isOwner = order.userId === session.user.id || order.guestEmail === session.user.email;
      if (!isOwner) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
      if (!['pending', 'confirmed'].includes(order.status)) {
        return NextResponse.json({ success: false, message: `Order cannot be cancelled — it is already ${order.status}` }, { status: 400 });
      }
    }

    const update = { updatedAt: new Date().toISOString() };

    if (status) {
      update.status = status;
      if (status === 'delivered') update.deliveredAt = new Date().toISOString();
      if (status === 'cancelled') update.cancelledAt = new Date().toISOString();

      // Deduct stock on confirmation
      if (status === 'confirmed') {
        const orderDoc = await ref.get();
        if (orderDoc.exists) {
          const batch = db.batch();
          for (const item of (orderDoc.data().items || [])) {
            if (!item.product) continue;
            const prodRef = db.collection('products').doc(item.product);
            const prodDoc = await prodRef.get();
            if (prodDoc.exists) {
              batch.update(prodRef, { stock: (prodDoc.data().stock || 0) - item.quantity });
            }
          }
          await batch.commit();
        }
      }
    }
    if (trackingNumber) update.trackingNumber = trackingNumber;
    if (notes) update.notes = notes;

    await ref.update(update);
    const updated = await ref.get();
    return NextResponse.json({ success: true, data: docToObj(updated) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
