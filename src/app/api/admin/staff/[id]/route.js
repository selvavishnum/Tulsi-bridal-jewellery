import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDB, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function PUT(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { name, role, phone, status, password } = await request.json();
    const db = getDB();
    const ref = db.collection('staff').doc(id);

    const updateData = {
      ...(name !== undefined && { name }),
      ...(role !== undefined && { role }),
      ...(phone !== undefined && { phone }),
      ...(status !== undefined && { status }),
      updatedAt: new Date().toISOString(),
    };

    if (password && password.trim() !== '') {
      updateData.password = await bcrypt.hash(password, 10);
    }

    await ref.update(updateData);
    const updated = docToObj(await ref.get());
    const { password: _p, ...safeDoc } = updated;
    return NextResponse.json({ success: true, data: safeDoc });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}

export async function DELETE(request, context) {
  try {
    const { id } = await context.params;
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    await db.collection('staff').doc(id).delete();
    return NextResponse.json({ success: true, message: 'Staff member deleted' });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}
