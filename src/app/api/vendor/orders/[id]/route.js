import { NextResponse } from 'next/server';
import { requireVendor } from '@/lib/vendorAuth';
import { toVendorOrderView } from '@/lib/settlement';

/* GET /api/vendor/orders/:id — one order, by direct id. IDOR guard: an
   order is returned only if it contains this vendor's items; anything else
   — another vendor's order, the platform's own, or an id that doesn't
   exist — is the same 403, so ids can't be probed for existence. */
export async function GET(request, context) {
  try {
    const ctx = await requireVendor();
    if (ctx.error) return ctx.error;
    const { db, vendorId } = ctx;
    const { id } = await context.params;

    const doc = await db.collection('orders').doc(String(id)).get();
    const order = doc.exists ? { id: doc.id, ...doc.data() } : null;
    const view = order && Array.isArray(order.vendorIds) && order.vendorIds.includes(vendorId)
      ? toVendorOrderView(order, vendorId)
      : null;
    if (!view) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    return NextResponse.json({ success: true, data: view });
  } catch (e) {
    console.error('[vendor/orders/:id]', e.message);
    return NextResponse.json({ success: false, message: 'Could not load the order' }, { status: 500 });
  }
}
