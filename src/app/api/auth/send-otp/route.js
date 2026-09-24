import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { sendOTPEmail } from '@/lib/email';
import { generateOtp, saveOtp, normalizeEmail, isValidEmail } from '@/lib/otp';
import { hitAll, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';

/* POST /api/auth/send-otp — emails a 6-digit sign-in code.
   Rate limited per address (3 per 15 min) and per IP (10 per hour): stops
   inbox bombing, and stops an attacker cycling fresh codes to widen a
   guessing attack (each code also dies after 5 wrong tries — see otp.js). */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    if (!isValidEmail(email)) {
      return NextResponse.json({ success: false, message: 'Enter a valid email address.' }, { status: 400 });
    }

    const db = getDB();
    const limited = await hitAll(db, [
      [`otp-send:email:${email}`, LIMITS.otpSendEmail],
      [`otp-send:ip:${clientIp(request.headers)}`, LIMITS.otpSendIp],
    ]);
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Too many codes requested. Please wait a few minutes and try again.');

    const code = generateOtp();
    await saveOtp(db, email, code);

    /* Deliver over email only. The code must never reach the logs — anyone with
       log access could otherwise sign in as any user, including an admin. */
    const sent = await sendOTPEmail(email, code).catch((e) => {
      console.error('[send-otp] delivery failed:', e.message);
      return false;
    });
    if (!sent) {
      return NextResponse.json({ success: false, message: 'Could not send the code right now. Please try again shortly.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, message: 'Code sent. It expires in 10 minutes.' });
  } catch (error) {
    /* Details go to the server log only — not to the browser. */
    console.error('[send-otp error]', error.message);
    return NextResponse.json({ success: false, message: 'Could not send the code right now. Please try again shortly.' }, { status: 500 });
  }
}
