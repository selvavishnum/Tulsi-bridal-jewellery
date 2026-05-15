import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    let data = [];
    try {
      const snap = await db.collection('complaints').orderBy('createdAt', 'desc').get();
      data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      // Collection may not exist yet — return empty array gracefully
    }
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { id, status, adminNote } = await request.json();
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const db = getDB();
    const update = { updatedAt: new Date().toISOString() };
    if (status !== undefined) update.status = status;
    if (adminNote !== undefined) update.adminNote = adminNote;

    await db.collection('complaints').doc(id).update(update);
    return NextResponse.json({ success: true });
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
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const db = getDB();
    await db.collection('complaints').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
