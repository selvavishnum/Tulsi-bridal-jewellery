import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj } from '@/lib/firebase';
import { requireRole, ROLES } from '@/lib/requireRole';

export async function GET() {
  try {
    const auth = await requireRole([ROLES.SUPER_ADMIN, ROLES.CATALOG_STAFF]);
    if (auth.error) return auth.error;
    const { session } = auth;
    const db = getDB();
    const snap = await db.collection('variantTypes').orderBy('createdAt', 'asc').get();
    return NextResponse.json({ success: true, data: snapshotToArr(snap) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = await requireRole([ROLES.SUPER_ADMIN, ROLES.CATALOG_STAFF]);
    if (auth.error) return auth.error;
    const { session } = auth;
    const body = await request.json();
    const { name, displayAs, values } = body;
    if (!name) return NextResponse.json({ success: false, message: 'Name is required' }, { status: 400 });
    const db = getDB();
    const ref = db.collection('variantTypes').doc();
    const doc = {
      name,
      displayAs: displayAs || 'dropdown',
      values: values || [],
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
    const auth = await requireRole([ROLES.SUPER_ADMIN, ROLES.CATALOG_STAFF]);
    if (auth.error) return auth.error;
    const { session } = auth;
    const body = await request.json();
    const { id, ...rest } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    const ref = db.collection('variantTypes').doc(id);
    await ref.update({ ...rest, updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true, data: docToObj(await ref.get()) });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireRole([ROLES.SUPER_ADMIN, ROLES.CATALOG_STAFF]);
    if (auth.error) return auth.error;
    const { session } = auth;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });
    const db = getDB();
    await db.collection('variantTypes').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
