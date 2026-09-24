import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAccess } from '@/lib/adminCollection';
import { CAN } from '@/lib/access';
import { sendContactNotification } from '@/lib/email';
import { sendContactWhatsApp } from '@/lib/whatsapp';
import { normalizeEmail, isValidEmail } from '@/lib/otp';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    /* Plain bounded strings only — each message emails and WhatsApps staff. */
    const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const name = str(body.name, 80);
    const email = normalizeEmail(body.email);
    const phone = str(body.phone, 15);
    const subject = str(body.subject, 150);
    const message = str(body.message, 3000);
    if (!name || !message || !isValidEmail(email)) {
      return NextResponse.json({ success: false, message: 'Name, a valid email and a message are required' }, { status: 400 });
    }
    const db = getDB();
    const limited = await hit(db, `contact:ip:${clientIp(request.headers)}`, LIMITS.contact);
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Too many messages. Please try again later, or call us.');
    const ref = db.collection('contact_messages').doc();
    const msgData = { name, email, phone, subject, message, read: false, createdAt: new Date().toISOString() };
    await ref.set(msgData);

    /* Notify admin + staff — email + WhatsApp */
    await Promise.all([
      sendContactNotification(msgData).catch((e) => console.error('[Email] Contact notification failed:', e.message)),
      sendContactWhatsApp(msgData).catch((e) => console.error('[WhatsApp] Contact alert failed:', e.message)),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[contact]', error.message);
    return NextResponse.json({ success: false, message: 'Could not send your message. Please try again.' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await requireAccess(CAN.manageOperations);
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const snap = await db.collection('contact_messages').orderBy('createdAt', 'desc').get();
    return NextResponse.json({ success: true, data: snapshotToArr(snap) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
