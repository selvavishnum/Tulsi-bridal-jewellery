import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { listConversations } from '@/lib/chatStore';
import { chatError } from '@/lib/chatRoutes';

/* GET /api/vendor/messages — this vendor's customer conversations. */
export async function GET() {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const data = await listConversations(ctx.db, 'vendor', ctx.vendorId);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return chatError(e);
  }
}
