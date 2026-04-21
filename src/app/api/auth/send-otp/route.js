import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
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

    console.log(`[OTP] ${email} → ${code}`); // visible in Vercel → Functions → Logs
    return NextResponse.json({ success: true, message: `OTP sent! Check Vercel logs for the code (${email})` });
  } catch (error) {
    console.error('[send-otp error]', error.message);
    return NextResponse.json({ success: false, message: friendlyError(error) }, { status: 500 });
  }
}
