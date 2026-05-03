import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { getEffectiveSession, requireAdmin } from '@/lib/adminCollection';
import { sendStatusUpdateEmail } from '@/lib/email';
import { sendStatusWhatsApp } from '@/lib/whatsapp';

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const doc = await db.collection('orders').doc(id).get();
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

export async function PUT(request, context) {
  try {
    const { id } = await context.params;
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const body = await request.json();
    const { status, trackingNumber, courierName, notes } = body;
    const ref = db.collection('orders').doc(id);

    /* Non-admin: can only cancel own pending/confirmed orders */
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

    /* Fetch current order before update (needed for email) */
    const currentDoc = await ref.get();
    const currentOrder = currentDoc.exists ? currentDoc.data() : {};

    const update = { updatedAt: new Date().toISOString() };

    if (status) {
      update.status = status;
      if (status === 'delivered') update.deliveredAt = new Date().toISOString();
      if (status === 'cancelled') update.cancelledAt = new Date().toISOString();

      /* Deduct stock on confirmation */
      if (status === 'confirmed' && currentDoc.exists) {
        const batch = db.batch();
        for (const item of (currentDoc.data().items || [])) {
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
    if (trackingNumber !== undefined) update.trackingNumber = trackingNumber;
    if (courierName !== undefined) update.courierName = courierName;
    if (notes !== undefined) update.notes = notes;

    await ref.update(update);
    const updated = await ref.get();
    const updatedOrder = docToObj(updated);

    /* Send status update — email + WhatsApp */
    if (status && status !== currentOrder.status) {
      await Promise.all([
        sendStatusUpdateEmail(updatedOrder, status).catch((e) => console.error('[Email] Status update failed:', e.message)),
        sendStatusWhatsApp(updatedOrder, status).catch((e) => console.error('[WhatsApp] Status update failed:', e.message)),
      ]);
    }

    return NextResponse.json({ success: true, data: updatedOrder });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
