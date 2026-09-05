import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDB } from '@/lib/firebase';
import { sendOTPEmail } from '@/lib/email';

/* Must be a CSPRNG — this code is a full authentication factor.
   Math.random() is predictable and would let an observer derive live codes. */
function generateOTP() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function friendlyError(err) {
  const msg = err?.message || '';
  if (msg.includes('NOT_FOUND') || msg.includes('5 ')) {
    return 'Firebase database not found. Please create a Firestore database in Firebase Console → Build → Firestore Database → Create database.';
  }
  if (msg.includes('PERMISSION_DENIED') || msg.includes('7 ')) {
    return 'Firebase permission denied. Check your FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Vercel settings.';
  }
  if (msg.includes('credential') || msg.includes('private key')) {
    return 'Firebase credentials error. Re-paste FIREBASE_PRIVATE_KEY in Vercel — include the full key with \\n characters.';
  }
  return msg || 'Server error. Check Vercel logs.';
}

export async function POST(request) {
  try {
    const { email } = await request.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ success: false, message: 'Valid email required' }, { status: 400 });
    }

    const db = getDB();
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const old = await db.collection('otp_codes').where('email', '==', email.toLowerCase()).get();
    const batch = db.batch();
    old.docs.forEach((d) => batch.delete(d.ref));
    const newRef = db.collection('otp_codes').doc();
    batch.set(newRef, { email: email.toLowerCase(), code, expiresAt, createdAt: new Date().toISOString() });
    await batch.commit();

    /* Deliver over email only. The code must never reach the logs — anyone with
       log access could otherwise sign in as any user, including an admin. */
    const sent = await sendOTPEmail(email, code).catch((e) => {
      console.error('[send-otp] delivery failed:', e.message);
      return false;
    });
    if (!sent) {
      return NextResponse.json(
        { success: false, message: 'Could not send the code right now. Please try again shortly.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, message: `OTP sent to ${email}. It expires in 10 minutes.` });
  } catch (error) {
    console.error('[send-otp error]', error.message);
    return NextResponse.json({ success: false, message: friendlyError(error) }, { status: 500 });
  }
}
