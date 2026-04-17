import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request) {
  try {
    const { email } = await request.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ success: false, message: 'Valid email required' }, { status: 400 });
    }

    const db = getDB();
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    // Remove old OTPs for this email
    const old = await db.collection('otp_codes').where('email', '==', email.toLowerCase()).get();
    const batch = db.batch();
    old.docs.forEach((d) => batch.delete(d.ref));
    const newRef = db.collection('otp_codes').doc();
    batch.set(newRef, { email: email.toLowerCase(), code, expiresAt, createdAt: new Date().toISOString() });
    await batch.commit();

    /* ── Send OTP via email ──
       In production add Resend / SendGrid here.
       For now, code is returned in response for dev testing.
       Remove `code` from response before going live!        */
    console.log(`OTP for ${email}: ${code}`); // visible in Vercel logs
    return NextResponse.json({
      success: true,
      message: 'OTP sent to your email',
      // Remove the line below in production — only for testing!
      devCode: process.env.NODE_ENV === 'development' ? code : undefined,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
