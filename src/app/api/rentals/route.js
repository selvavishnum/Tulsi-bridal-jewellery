import { NextResponse } from 'next/server';
import { getDB, paginate, docToObj } from '@/lib/firebase';
import { getEffectiveSession } from '@/lib/adminCollection';
import { calculateRentalDays } from '@/lib/utils';

export async function GET(request) {
  try {
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');

    let q = db.collection('rentals');
    if (session.user.role !== 'admin') q = q.where('userId', '==', session.user.id);
    if (status) q = q.where('status', '==', status);
    q = q.orderBy('createdAt', 'desc');

    const result = await paginate(q, page, limit);
    return NextResponse.json({ success: true, data: { rentals: result.data, total: result.total, pages: result.pages, page: result.page } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await getEffectiveSession();
    const db = getDB();
    const body = await request.json();
    const { productId, rentalStartDate, rentalEndDate, customerDetails, payment, guestEmail } = body;

    const prodDoc = await db.collection('products').doc(productId).get();
    if (!prodDoc.exists) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    const product = prodDoc.data();
    if (!product.isAvailableForRent || product.rentalStock < 1) {
      return NextResponse.json({ success: false, message: 'Product not available for rent' }, { status: 400 });
    }

    const rentalDays = calculateRentalDays(rentalStartDate, rentalEndDate);
    const pricePerDay = product.rentalPrice || 0;
    const totalRentalCost = pricePerDay * rentalDays;
    const securityDeposit = Math.round((product.price || 0) * 0.3);
    const total = totalRentalCost + securityDeposit;

    const rentalRef = db.collection('rentals').doc();
    const rentalData = {
      rentalNumber: `TBJr${Date.now()}`,
      userId: session?.user?.id || null,
      guestEmail: guestEmail || null,
      productId,
      productName: product.name,
      productImage: product.images?.[0] || null,
      rentalStartDate,
      rentalEndDate,
      rentalDays,
      pricePerDay,
      securityDeposit,
      totalRentalCost,
      total,
      customerDetails: customerDetails || {},
      payment: payment || { method: 'razorpay', status: 'pending' },
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await rentalRef.set(rentalData);
    return NextResponse.json({ success: true, data: { id: rentalRef.id, ...rentalData } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
