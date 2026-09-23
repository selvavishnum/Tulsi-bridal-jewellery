import { NextResponse } from 'next/server';
import { getDB, FieldValue } from '@/lib/firebase';
import bcrypt from 'bcryptjs';

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'TBJ';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

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
    const lower = String(email).trim().toLowerCase();
    /* Open registration never verifies the email, so it must not be usable
       for an address that carries more than customer access — the owner's,
       or a staff member's or vendor's login. Those sign in with their staff
       password, email OTP or Google. */
    const owners = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const staffSnap = await db.collection('staff').where('email', '==', lower).limit(1).get();
    if (owners.includes(lower) || !staffSnap.empty) {
      return NextResponse.json({ success: false, message: 'This email belongs to a staff or vendor account — sign in from the staff login instead.' }, { status: 409 });
    }
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
      referralCode: generateReferralCode(),
      loyaltyPoints: 0,
      loginCount: 0,
      lastSeen: new Date().toISOString(),
    };
    await userRef.set(userData);

    const { password: _, ...safeUser } = userData;
    return NextResponse.json({ success: true, message: 'Account created successfully', data: { id: userRef.id, ...safeUser } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
