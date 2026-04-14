import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Coupon from '@/models/Coupon';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function POST(request) {
  try {
    await connectDB();
    const session = await getServerSession(authOptions);
    const { code, orderAmount } = await request.json();
    if (!code) return NextResponse.json({ success: false, message: 'Coupon code required' }, { status: 400 });

    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (!coupon) return NextResponse.json({ success: false, message: 'Invalid coupon code' }, { status: 404 });

    const validation = coupon.isValid(orderAmount, session?.user?.id);
    if (!validation.valid) return NextResponse.json({ success: false, message: validation.message }, { status: 400 });

    const discount = coupon.calculateDiscount(orderAmount);
    return NextResponse.json({
      success: true,
      data: { coupon: { _id: coupon._id, code: coupon.code, type: coupon.type, value: coupon.value }, discount },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
