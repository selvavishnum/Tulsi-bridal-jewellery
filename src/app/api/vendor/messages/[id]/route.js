import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { readThread, sendInConversation } from '@/lib/chatStore';
import { chatRateLimit, chatError, notifyCustomer } from '@/lib/chatRoutes';

/* GET /api/vendor/messages/:id — one conversation (marks it read). */
export async function GET(request, { params }) {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { id } = await params;
    const data = await readThread(ctx.db, id, 'vendor', ctx.vendorId);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return chatError(e);
  }
}

/* POST /api/vendor/messages/:id { text } — reply to the customer. */
export async function POST(request, { params }) {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const limited = await chatRateLimit(ctx.db, `v:${ctx.vendorId}`);
    if (limited) return limited;
    const r = await sendInConversation(ctx.db, id, 'vendor', ctx.vendorId, body.text);
    if (r.notify) await notifyCustomer(r.conversation, r.message.text);
    return NextResponse.json({ success: true, data: { masked: r.message.masked } }, { status: 201 });
  } catch (e) {
    return chatError(e);
  }
}
