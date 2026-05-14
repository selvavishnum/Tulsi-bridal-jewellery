import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const snap = await db.collection('purchaseIndents').orderBy('createdAt', 'desc').get();
    return NextResponse.json({ success: true, data: snapshotToArr(snap) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    const { supplierId, supplierName, warehouseId, warehouseName, items, notes, status } = body;
    const db = getDB();
    const ref = db.collection('purchaseIndents').doc();
    const doc = {
      supplierId: supplierId || '',
      supplierName: supplierName || '',
      warehouseId: warehouseId || '',
      warehouseName: warehouseName || '',
      items: items || [],
      notes: notes || '',
      status: status || 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await ref.set(doc);
    return NextResponse.json({ success: true, data: { id: ref.id, ...doc } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const body = await request.json();
    const { id, ...rest } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    const ref = db.collection('purchaseIndents').doc(id);
    await ref.update({ ...rest, updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true, data: docToObj(await ref.get()) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    await db.collection('purchaseIndents').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
