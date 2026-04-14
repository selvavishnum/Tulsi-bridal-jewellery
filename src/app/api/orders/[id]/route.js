import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Product from '@/models/Product';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    await connectDB();
    const order = await Order.findById(params.id).populate('user', 'name email').lean();
    if (!order) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
    if (session.user.role !== 'admin' && order.user?._id?.toString() !== session.user.id) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ success: true, data: order });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    await connectDB();
    const { status, trackingNumber, notes } = await request.json();
    const update = {};
    if (status) {
      update.status = status;
      if (status === 'delivered') update.deliveredAt = new Date();
      if (status === 'cancelled') update.cancelledAt = new Date();

      // Deduct stock on confirmation
      if (status === 'confirmed') {
        const order = await Order.findById(params.id);
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
        }
      }
    }
    if (trackingNumber) update.trackingNumber = trackingNumber;
    if (notes) update.notes = notes;
    const order = await Order.findByIdAndUpdate(params.id, update, { new: true });
    return NextResponse.json({ success: true, data: order });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
