/* Shared bits of the chat API routes (customer and vendor sides). */
import { NextResponse } from 'next/server';
import { getEffectiveSession } from '@/lib/adminCollection';
import { ChatError } from '@/lib/chatStore';
import { hit, LIMITS, tooManyRequests } from '@/lib/rateLimit';
import { sendChatNotification } from '@/lib/email';

/* Signed-in shopper (not staff or vendor), or { error }. */
export async function requireCustomer() {
  const session = await getEffectiveSession();
  if (!session?.user?.id) return { error: NextResponse.json({ success: false, message: 'Please sign in to chat with the seller.' }, { status: 401 }) };
  if (session.user.role && session.user.role !== 'customer') {
    return { error: NextResponse.json({ success: false, message: 'Chat is for customer accounts.' }, { status: 403 }) };
  }
  return { session, customer: { id: session.user.id, name: session.user.name, email: session.user.email } };
}

export async function chatRateLimit(db, sender) {
  const r = await hit(db, `chat:${sender}`, LIMITS.chatSend);
  return r.allowed ? null : tooManyRequests(r.retryAfterSec, 'You’re sending messages too fast. Please wait a few minutes.');
}

export function chatError(e) {
  if (e instanceof ChatError) return NextResponse.json({ success: false, message: e.message }, { status: e.status });
  console.error('[chat]', e.message);
  return NextResponse.json({ success: false, message: 'Something went wrong. Please try again.' }, { status: 500 });
}

/* Email the vendor about a customer's message (first unread only). */
export async function notifyVendor(db, vendorId, vendor, { fromName, text, productName }) {
  let to = vendor?.contactEmail;
  if (!to) {
    const login = await db.collection('staff').where('vendorId', '==', vendorId).limit(1).get();
    to = login.empty ? null : login.docs[0].data().email;
  }
  return sendChatNotification({ to, fromName, text, productName, link: '/vendor/messages' }).catch(() => false);
}

export function notifyCustomer(conversation, text) {
  return sendChatNotification({ to: conversation.customerEmail, fromName: conversation.vendorName || 'Seller', text, link: '/account/messages' }).catch(() => false);
}
