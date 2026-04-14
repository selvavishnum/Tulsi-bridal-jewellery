import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Rental from '@/models/Rental';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    await connectDB();
    const rental = await Rental.findById(params.id).populate('user', 'name email').lean();
    if (!rental) return NextResponse.json({ success: false, message: 'Rental not found' }, { status: 404 });
    if (session.user.role !== 'admin' && rental.user?._id?.toString() !== session.user.id) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ success: true, data: rental });
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
    const body = await request.json();
    const update = {};
    if (body.status) {
      update.status = body.status;
      if (body.status === 'returned') update.returnedAt = new Date();
    }
    if (body.notes) update.notes = body.notes;
    if (body.returnCondition) update.returnCondition = body.returnCondition;
    const rental = await Rental.findByIdAndUpdate(params.id, update, { new: true });
    return NextResponse.json({ success: true, data: rental });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
