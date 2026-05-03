import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { getEffectiveSession, requireAdmin } from '@/lib/adminCollection';

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const session = await getEffectiveSession();
    if (!session) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const db = getDB();
    const doc = await db.collection('rentals').doc(id).get();
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

export async function PUT(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const body = await request.json();
    const update = { updatedAt: new Date().toISOString() };
    if (body.status) {
      update.status = body.status;
      if (body.status === 'returned')  update.returnedAt  = new Date().toISOString();
      if (body.status === 'active')    update.activatedAt = new Date().toISOString();
      if (body.status === 'cancelled') update.cancelledAt = new Date().toISOString();
    }
    if (body.notes           !== undefined) update.notes           = body.notes;
    if (body.returnCondition !== undefined) update.returnCondition = body.returnCondition;
    if (body.trackingNumber  !== undefined) update.trackingNumber  = body.trackingNumber;
    if (body.courierName     !== undefined) update.courierName     = body.courierName;
    const ref = db.collection('rentals').doc(id);
    await ref.update(update);
    const updated = await ref.get();
    return NextResponse.json({ success: true, data: docToObj(updated) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
