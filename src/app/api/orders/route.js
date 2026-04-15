import { NextResponse } from 'next/server';
import { getDB, paginate } from '@/lib/firebase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const db = getDB();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');

    let q = db.collection('orders');
    if (session.user.role !== 'admin') q = q.where('userId', '==', session.user.id);
    if (status) q = q.where('status', '==', status);
    q = q.orderBy('createdAt', 'desc');

    const result = await paginate(q, page, limit);
    return NextResponse.json({ success: true, data: { orders: result.data, total: result.total, pages: result.pages, page: result.page } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    const db = getDB();
    const body = await request.json();
    const { items, shippingAddress, payment, coupon, couponCode, subtotal, shippingCost, discount, total, guestEmail } = body;

    if (!items?.length || !shippingAddress) {
      return NextResponse.json({ success: false, message: 'Items and shipping address are required' }, { status: 400 });
    }

    // Verify stock
    for (const item of items) {
      const prodDoc = await db.collection('products').doc(item.product).get();
      if (!prodDoc.exists || prodDoc.data().stock < item.quantity) {
        return NextResponse.json({ success: false, message: `Insufficient stock for ${item.name}` }, { status: 400 });
      }
    }

    const orderRef = db.collection('orders').doc();
    const orderNumber = `TBJ${Date.now()}`;
    const orderData = {
      orderNumber,
      userId: session?.user?.id || null,
      guestEmail: guestEmail || null,
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
