import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Rental from '@/models/Rental';
import Product from '@/models/Product';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { calculateRentalDays } from '@/lib/utils';

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
    const [rentals, total] = await Promise.all([
      Rental.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('user', 'name email').lean(),
      Rental.countDocuments(query),
    ]);
    return NextResponse.json({ success: true, data: { rentals, total, pages: Math.ceil(total / limit), page } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await connectDB();
    const session = await getServerSession(authOptions);
    const body = await request.json();
    const { productId, rentalStartDate, rentalEndDate, customerDetails, payment, guestEmail } = body;

    const product = await Product.findById(productId);
    if (!product) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    if (!product.isAvailableForRent || product.rentalStock < 1) {
      return NextResponse.json({ success: false, message: 'Product not available for rent' }, { status: 400 });
    }

    const rentalDays = calculateRentalDays(rentalStartDate, rentalEndDate);
    const pricePerDay = product.rentalPrice;
    const totalRentalCost = pricePerDay * rentalDays;
    const securityDeposit = Math.round(product.price * 0.3);
    const total = totalRentalCost + securityDeposit;

    const rental = await Rental.create({
      user: session?.user?.id || null,
      guestEmail,
      product: productId,
      productName: product.name,
      productImage: product.images?.[0],
      rentalStartDate,
      rentalEndDate,
      rentalDays,
      pricePerDay,
      securityDeposit,
      totalRentalCost,
      total,
      customerDetails,
      payment: payment || { method: 'razorpay', status: 'pending' },
    });

    return NextResponse.json({ success: true, data: rental }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
