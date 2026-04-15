import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const db = getDB();
    const doc = await db.collection('rentals').doc(params.id).get();
    if (!doc.exists) return NextResponse.json({ success: false, message: 'Rental not found' }, { status: 404 });
    const rental = docToObj(doc);
    if (session.user.role !== 'admin' && rental.userId !== session.user.id) {
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
    const db = getDB();
    const body = await request.json();
    const update = { updatedAt: new Date().toISOString() };
    if (body.status) {
      update.status = body.status;
      if (body.status === 'returned') update.returnedAt = new Date().toISOString();
    }
    if (body.notes) update.notes = body.notes;
    if (body.returnCondition) update.returnCondition = body.returnCondition;
    const ref = db.collection('rentals').doc(params.id);
    await ref.update(update);
    const updated = await ref.get();
    return NextResponse.json({ success: true, data: docToObj(updated) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
