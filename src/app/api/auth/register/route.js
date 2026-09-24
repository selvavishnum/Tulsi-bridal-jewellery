import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDB } from '@/lib/firebase';
import bcrypt from 'bcryptjs';
import { normalizeEmail, isValidEmail } from '@/lib/otp';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'TBJ';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

const TAKEN = 'An account with this email already exists. Sign in, or use "Email code" to get in.';
const emailKey = (email) => crypto.createHash('sha256').update(email).digest('hex');

/* POST /api/auth/register — password account.
   The email is normalised once and claimed through `emailIndex/{hash}`
   inside a transaction, so " victim@x.com" and parallel requests can't
   create a second account for an address. The account starts
   emailVerified: false — it can't see guest orders placed with that
   email until the owner proves it (email code / Google), and that proof
   also wipes a password set by anyone who registered the address first. */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const phone = typeof body.phone === 'string' ? body.phone.replace(/[^\d+]/g, '').slice(0, 15) : '';
    if (!name || !email || !password) {
      return NextResponse.json({ success: false, message: 'Name, email and password are required' }, { status: 400 });
    }
    if (!isValidEmail(email)) return NextResponse.json({ success: false, message: 'Enter a valid email address.' }, { status: 400 });
    if (password.length < 8 || password.length > 128) {
      return NextResponse.json({ success: false, message: 'Password must be 8 to 128 characters' }, { status: 400 });
    }

    const db = getDB();
    const limited = await hit(db, `register:ip:${clientIp(request.headers)}`, LIMITS.register);
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Too many sign-ups from this network. Please try again later.');

    /* Open registration must not be usable for an address that carries
       more than customer access. Same answer as any taken address, so the
       form can't be used to discover staff emails. */
    const owners = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const [staffSnap, existing] = await Promise.all([
      db.collection('staff').where('email', '==', email).limit(1).get(),
      db.collection('users').where('email', '==', email).limit(1).get(),
    ]);
    if (owners.includes(email) || !staffSnap.empty || !existing.empty) {
      return NextResponse.json({ success: false, message: TAKEN }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const userRef = db.collection('users').doc();
    const userData = {
      name, email, password: hashed, phone,
      role: 'customer', isActive: true, emailVerified: false,
      createdAt: now, referralCode: generateReferralCode(),
      loyaltyPoints: 0, loginCount: 0, lastSeen: now,
    };
    const indexRef = db.collection('emailIndex').doc(emailKey(email));
    const created = await db.runTransaction(async (tx) => {
      if ((await tx.get(indexRef)).exists) return false;
      tx.set(indexRef, { userId: userRef.id, createdAt: now });
      tx.set(userRef, userData);
      return true;
    });
    if (!created) return NextResponse.json({ success: false, message: TAKEN }, { status: 409 });

    const { password: _, ...safeUser } = userData;
    return NextResponse.json({ success: true, message: 'Account created successfully', data: { id: userRef.id, ...safeUser } }, { status: 201 });
  } catch (error) {
    console.error('[register]', error.message);
    return NextResponse.json({ success: false, message: 'Could not create the account. Please try again.' }, { status: 500 });
  }
}
