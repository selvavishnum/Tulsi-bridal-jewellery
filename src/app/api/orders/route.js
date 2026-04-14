import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Product from '@/models/Product';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    await connectDB();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const query = session.user.role === 'admin' ? {} : { user: session.user.id };
    const status = searchParams.get('status');
    if (status) query.status = status;
    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('user', 'name email').lean(),
      Order.countDocuments(query),
    ]);
    return NextResponse.json({ success: true, data: { orders, total, pages: Math.ceil(total / limit), page } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await connectDB();
    const session = await getServerSession(authOptions);
    const body = await request.json();
    const { items, shippingAddress, payment, coupon, couponCode, subtotal, shippingCost, discount, total, guestEmail } = body;

    if (!items?.length || !shippingAddress) {
      return NextResponse.json({ success: false, message: 'Items and shipping address are required' }, { status: 400 });
    }

    // Verify stock and prices
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product || product.stock < item.quantity) {
        return NextResponse.json({ success: false, message: `Insufficient stock for ${item.name}` }, { status: 400 });
      }
    }

    const order = await Order.create({
      user: session?.user?.id || null,
      guestEmail,
      items,
      shippingAddress,
      payment: payment || { method: 'razorpay', status: 'pending' },
      coupon,
      couponCode,
      subtotal,
      shippingCost: shippingCost || 0,
      discount: discount || 0,
      total,
    });

    return NextResponse.json({ success: true, data: order }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
