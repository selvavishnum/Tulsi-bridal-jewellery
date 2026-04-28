import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import bcrypt from 'bcryptjs';

export async function POST(request) {
  try {
    const { name, email, password, phone } = await request.json();
    if (!name || !email || !password) {
      return NextResponse.json({ success: false, message: 'Name, email and password are required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ success: false, message: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const db = getDB();
    const existing = await db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get();
    if (!existing.empty) {
      return NextResponse.json({ success: false, message: 'Email already registered' }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 12);
    const userRef = db.collection('users').doc();
    const userData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashed,
      phone: phone || '',
      role: 'customer',
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    await userRef.set(userData);

    const { password: _, ...safeUser } = userData;
    return NextResponse.json({ success: true, message: 'Account created successfully', data: { id: userRef.id, ...safeUser } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
