import { NextResponse } from 'next/server';
import { requireActiveVendor } from '@/lib/vendorAuth';
import { vendorFulfils } from '@/lib/vendorOrders';
import { sendStatusUpdateEmail, sendOrderConfirmation } from '@/lib/email';
import { toCustomerOrder } from '@/lib/settlement';
import { hit } from '@/lib/rateLimit';

/* POST /api/vendor/orders/:id/resend-email — re-sends the customer the
   email for the order's current status. Only for orders the vendor
   fulfils, at most 3 an hour per order (it goes out from Tulsi's address). */
export async function POST(request, context) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    const { id } = await context.params;
    const doc = await ctx.db.collection('orders').doc(String(id)).get();
    const order = doc.exists ? { id: doc.id, _id: doc.id, ...doc.data() } : null;
    if (!order || !Array.isArray(order.vendorIds) || !order.vendorIds.includes(ctx.vendorId) || !vendorFulfils(order, ctx.vendorId, ctx.vendor)) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    const limited = await hit(ctx.db, `vendor-resend:${order.id}`, { limit: 3, windowMs: 60 * 60_000 });
    if (!limited.allowed) return NextResponse.json({ success: false, message: 'Already sent 3 times this hour. Try again later.' }, { status: 429 });
    /* A pending order hasn't had a status change yet: resend the order confirmation. */
    if (order.status === 'pending') await sendOrderConfirmation(toCustomerOrder(order));
    else await sendStatusUpdateEmail(order, order.status);
    return NextResponse.json({ success: true, message: 'Email sent to the customer.' });
  } catch (e) {
    console.error('[vendor resend-email]', e.message);
    return NextResponse.json({ success: false, message: 'Could not send the email' }, { status: 500 });
  }
}
