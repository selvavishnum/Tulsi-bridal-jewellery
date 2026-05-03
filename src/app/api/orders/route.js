import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { sendOrderConfirmation, sendOrderNotificationToAdmin } from '@/lib/email';
import { sendOrderWhatsAppToAdmin, sendOrderWhatsAppToCustomer } from '@/lib/whatsapp';

export async function GET(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');

    if (session.user.role === 'admin') {
      const snap = await db.collection('orders').orderBy('createdAt', 'desc').get();
      let orders = snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() }));
      if (status) orders = orders.filter((o) => o.status === status);
      const total = orders.length;
      const pages = Math.ceil(total / limit);
      const start = (page - 1) * limit;
      return NextResponse.json({ success: true, data: { orders: orders.slice(start, start + limit), total, pages, page } });
    }

    const [byUserId, byEmail] = await Promise.all([
      db.collection('orders').where('userId', '==', session.user.id).get(),
      session.user.email
        ? db.collection('orders').where('guestEmail', '==', session.user.email).get()
        : Promise.resolve({ docs: [] }),
    ]);

    const seen = new Set();
    const merged = [];
    for (const doc of [...byUserId.docs, ...byEmail.docs]) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        merged.push({ id: doc.id, _id: doc.id, ...doc.data() });
      }
    }

    let orders = merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (status) orders = orders.filter((o) => o.status === status);

    const total = orders.length;
    const pages = Math.ceil(total / limit);
    const start = (page - 1) * limit;

    return NextResponse.json({ success: true, data: { orders: orders.slice(start, start + limit), total, pages, page } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    const db = getDB();
    const body = await request.json();
    const { items, shippingAddress, payment, coupon, couponCode, subtotal, shippingCost, discount, total, guestEmail } = body;

    if (!items?.length || !shippingAddress) {
      return NextResponse.json({ success: false, message: 'Items and shipping address are required' }, { status: 400 });
    }

    for (const item of items) {
      if (!item.product) continue;
      const prodDoc = await db.collection('products').doc(item.product).get();
      if (!prodDoc.exists || prodDoc.data().stock < item.quantity) {
        return NextResponse.json({ success: false, message: `Insufficient stock for ${item.name}` }, { status: 400 });
      }
    }

    const orderRef = db.collection('orders').doc();
    const orderNumber = `TBJ${Date.now()}`;
    const resolvedEmail = guestEmail || session?.user?.email || shippingAddress?.email || null;

    /* Normalize address fields: checkout sends fullName, emails expect name */
    const normalizedAddress = {
      ...shippingAddress,
      name:  shippingAddress.fullName || shippingAddress.name || '',
      email: shippingAddress.email || resolvedEmail || '',
    };

    const orderData = {
      orderNumber,
      userId: session?.user?.id || null,
      guestEmail: resolvedEmail,
      items,
      shippingAddress: normalizedAddress,
      payment: payment || { method: 'razorpay', status: 'pending' },
      coupon: coupon || null,
      couponCode: couponCode || null,
      subtotal: Number(subtotal) || 0,
      shippingCost: Number(shippingCost) || 0,
      discount: Number(discount) || 0,
      total: Number(total) || 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await orderRef.set(orderData);

    const fullOrder = { id: orderRef.id, _id: orderRef.id, ...orderData };

    /* Send emails + WhatsApp — await so they complete before response */
    await Promise.all([
      sendOrderConfirmation(fullOrder).catch((e) => console.error('[Email] Customer confirmation failed:', e.message)),
      sendOrderNotificationToAdmin(fullOrder).catch((e) => console.error('[Email] Admin notification failed:', e.message)),
      sendOrderWhatsAppToAdmin(fullOrder).catch((e) => console.error('[WhatsApp] Admin alert failed:', e.message)),
      sendOrderWhatsAppToCustomer(fullOrder).catch((e) => console.error('[WhatsApp] Customer alert failed:', e.message)),
    ]);

    return NextResponse.json({ success: true, data: fullOrder }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
