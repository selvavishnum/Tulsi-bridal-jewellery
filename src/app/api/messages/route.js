import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { customerSendAboutProduct, listConversations } from '@/lib/chatStore';
import { requireCustomer, chatRateLimit, chatError, notifyVendor } from '@/lib/chatRoutes';

/* GET /api/messages — the signed-in customer's conversations with sellers. */
export async function GET() {
  try {
    const auth = await requireCustomer();
    if (auth.error) return auth.error;
    const data = await listConversations(getDB(), 'customer', auth.customer.id);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return chatError(e);
  }
}

/* POST /api/messages { productId, text, orderNumber? } — message the seller of a product. */
export async function POST(request) {
  try {
    const auth = await requireCustomer();
    if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    const db = getDB();
    const limited = await chatRateLimit(db, `c:${auth.customer.id}`);
    if (limited) return limited;
    const r = await customerSendAboutProduct(db, auth.customer, body);
    if (r.notify) await notifyVendor(db, r.vendor.id, r.vendor, { fromName: auth.customer.name || 'A customer', text: r.message.text, productName: r.message.product?.name });
    return NextResponse.json({ success: true, data: { conversationId: r.conversationId, masked: r.message.masked } }, { status: 201 });
  } catch (e) {
    return chatError(e);
  }
}
