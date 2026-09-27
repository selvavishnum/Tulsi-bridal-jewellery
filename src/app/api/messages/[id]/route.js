import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { readThread, sendInConversation } from '@/lib/chatStore';
import { requireCustomer, chatRateLimit, chatError, notifyVendor } from '@/lib/chatRoutes';

/* GET /api/messages/:id — a conversation's messages (marks them read). */
export async function GET(request, { params }) {
  try {
    const auth = await requireCustomer();
    if (auth.error) return auth.error;
    const { id } = await params;
    const data = await readThread(getDB(), id, 'customer', auth.customer.id);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return chatError(e);
  }
}

/* POST /api/messages/:id { text } — reply to the seller. */
export async function POST(request, { params }) {
  try {
    const auth = await requireCustomer();
    if (auth.error) return auth.error;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const db = getDB();
    const limited = await chatRateLimit(db, `c:${auth.customer.id}`);
    if (limited) return limited;
    const r = await sendInConversation(db, id, 'customer', auth.customer.id, body.text);
    if (r.notify) {
      const v = await db.collection('vendors').doc(r.conversation.vendorId).get();
      await notifyVendor(db, r.conversation.vendorId, v.data(), { fromName: auth.customer.name || 'A customer', text: r.message.text });
    }
    return NextResponse.json({ success: true, data: { masked: r.message.masked } }, { status: 201 });
  } catch (e) {
    return chatError(e);
  }
}
