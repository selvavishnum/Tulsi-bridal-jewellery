import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const db = getDB();
    const doc = await db.collection('products').doc(id).get();
    if (!doc.exists) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: docToObj(doc) });
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
    const ref = db.collection('products').doc(id);
    const doc = await ref.get();
    if (!doc.exists) return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    await ref.update({ ...body, updatedAt: new Date().toISOString() });
    const updated = await ref.get();
    return NextResponse.json({ success: true, data: docToObj(updated) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function DELETE(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    await db.collection('products').doc(id).update({ isActive: false });
    return NextResponse.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
