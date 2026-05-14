import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const snap = await db.collection('staff').orderBy('createdAt', 'desc').get();
    const data = snapshotToArr(snap).map(({ password, ...rest }) => rest);
    return NextResponse.json({ success: true, data });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const { name, email, password, role, phone, status } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json({ success: false, message: 'Name, email and password are required' }, { status: 400 });
    }

    const db = getDB();

    // Check for duplicate email
    const existing = await db.collection('staff').where('email', '==', email).limit(1).get();
    if (!existing.empty) {
      return NextResponse.json({ success: false, message: 'A staff member with this email already exists' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const ref = db.collection('staff').doc();
    const doc = { name, email, password: hashedPassword, role: role || 'SalesStaff', phone: phone || '', status: status || 'Active', createdAt: now, updatedAt: now };
    await ref.set(doc);

    const { password: _p, ...safeDoc } = doc;
    return NextResponse.json({ success: true, data: { id: ref.id, ...safeDoc } }, { status: 201 });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}
