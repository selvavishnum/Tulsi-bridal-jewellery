import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj, FieldValue } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const snap = await db.collection('categories').orderBy('seqNo', 'asc').get();
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
    const { name, slug, description, seqNo, isVisible, parentId } = body;
    if (!name) return NextResponse.json({ success: false, message: 'Name is required' }, { status: 400 });
    const db = getDB();
    const ref = db.collection('categories').doc();
    const doc = {
      name,
      slug: slug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      description: description || '',
      seqNo: seqNo || 0,
      isVisible: isVisible !== false,
      parentId: parentId || null,
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
    const ref = db.collection('categories').doc(id);
    await ref.update({ ...rest, updatedAt: new Date().toISOString() });
    const updated = docToObj(await ref.get());
    return NextResponse.json({ success: true, data: updated });
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
    const deleteChildren = searchParams.get('deleteChildren') === 'true';
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    if (deleteChildren) {
      const subSnap = await db.collection('categories').where('parentId', '==', id).get();
      const batch = db.batch();
      subSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(db.collection('categories').doc(id));
      await batch.commit();
    } else {
      await db.collection('categories').doc(id).delete();
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
