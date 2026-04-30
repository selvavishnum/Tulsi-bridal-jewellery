import { NextResponse } from 'next/server';
import { getDB, paginate, snapshotToArr } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';

export async function GET(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');

    // Admin: paginated query as before
    if (session.user.role === 'admin') {
      let q = db.collection('orders').orderBy('createdAt', 'desc');
      if (status) q = q.where('status', '==', status);
      const result = await paginate(q, page, limit);
      return NextResponse.json({ success: true, data: { orders: result.data, total: result.total, pages: result.pages, page: result.page } });
    }

    // Regular user: fetch orders by userId AND by guestEmail matching their email, then merge
    const [byUserId, byEmail] = await Promise.all([
      db.collection('orders').where('userId', '==', session.user.id).orderBy('createdAt', 'desc').get(),
      session.user.email
        ? db.collection('orders').where('guestEmail', '==', session.user.email).orderBy('createdAt', 'desc').get()
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

    // Sort by createdAt desc, apply status filter in JS, then paginate in JS
    let orders = merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (status) orders = orders.filter((o) => o.status === status);

    const total = orders.length;
    const pages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paged = orders.slice(start, start + limit);

    return NextResponse.json({ success: true, data: { orders: paged, total, pages, page } });
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

    // Verify stock (skip if product ID is missing)
    for (const item of items) {
      if (!item.product) continue;
      const prodDoc = await db.collection('products').doc(item.product).get();
      if (!prodDoc.exists || prodDoc.data().stock < item.quantity) {
        return NextResponse.json({ success: false, message: `Insufficient stock for ${item.name}` }, { status: 400 });
      }
    }

    const orderRef = db.collection('orders').doc();
    const orderNumber = `TBJ${Date.now()}`;
    // Always store the email so guest orders can be linked when the user logs in later
    const resolvedEmail = guestEmail || session?.user?.email || shippingAddress?.email || null;
    const orderData = {
      orderNumber,
      userId: session?.user?.id || null,
      guestEmail: resolvedEmail,
      items,
      shippingAddress,
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
    return NextResponse.json({ success: true, data: { id: orderRef.id, ...orderData } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
