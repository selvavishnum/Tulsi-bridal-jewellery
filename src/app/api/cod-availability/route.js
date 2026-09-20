import { NextResponse } from 'next/server';
import { getAvailableCouriers, isConfigured } from '@/lib/shiprocket';

/* Fails open — if Shiprocket isn't configured or the lookup errors, we don't
   have real serviceability data, so we don't use it to block a sale. The
   authoritative checks (this + value cap) are re-run server-side in
   POST /api/orders regardless of what this endpoint says. */
export async function GET(request) {
  const pincode = new URL(request.url).searchParams.get('pincode');
  if (!pincode || !/^\d{6}$/.test(pincode)) {
    return NextResponse.json({ success: false, message: 'Valid 6-digit pincode required' }, { status: 400 });
  }

  if (!isConfigured()) {
    return NextResponse.json({ success: true, data: { available: true, checked: false } });
  }

  try {
    const couriers = await getAvailableCouriers(pincode, true);
    return NextResponse.json({ success: true, data: { available: couriers.length > 0, checked: true } });
  } catch {
    return NextResponse.json({ success: true, data: { available: true, checked: false } });
  }
}
