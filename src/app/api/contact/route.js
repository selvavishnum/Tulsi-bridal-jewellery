import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import { sendContactNotification } from '@/lib/email';
import { sendContactWhatsApp } from '@/lib/whatsapp';

export async function POST(request) {
  try {
    const { name, email, phone, subject, message } = await request.json();
    if (!name || !email || !message) {
      return NextResponse.json({ success: false, message: 'Name, email and message are required' }, { status: 400 });
    }
    const db = getDB();
    const ref = db.collection('contact_messages').doc();
    const msgData = { name, email, phone: phone || '', subject: subject || '', message, read: false, createdAt: new Date().toISOString() };
    await ref.set(msgData);

    /* Notify admin + staff — email + WhatsApp */
    await Promise.all([
      sendContactNotification(msgData).catch((e) => console.error('[Email] Contact notification failed:', e.message)),
      sendContactWhatsApp(msgData).catch((e) => console.error('[WhatsApp] Contact alert failed:', e.message)),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const snap = await db.collection('contact_messages').orderBy('createdAt', 'desc').get();
    return NextResponse.json({ success: true, data: snapshotToArr(snap) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
