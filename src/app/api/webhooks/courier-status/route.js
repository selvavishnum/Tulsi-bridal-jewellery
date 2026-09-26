import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDB } from '@/lib/firebase';
import { applyTrackingEvent } from '@/lib/shipmentSync';
import { parseShiprocketTime } from '@/lib/shipmentStatus';

/* POST /api/webhooks/courier-status — Shiprocket tracking webhook.
   (Shiprocket refuses webhook URLs containing "shiprocket", hence the
   neutral path.) Set it up in Shiprocket → Settings → API → Webhooks:
     URL:   https://tulsijewels.in/api/webhooks/courier-status
     Token: the value of SHIPROCKET_WEBHOOK_TOKEN
   Shiprocket sends the token in the x-api-key header; anything without the
   right token is refused, so no one can fake a "Delivered". */

const same = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

export async function POST(request) {
  const token = process.env.SHIPROCKET_WEBHOOK_TOKEN;
  if (!token || !same(request.headers.get('x-api-key'), token)) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ success: true, ignored: 'not json' }); }
  const awb = body?.awb || body?.awb_code;
  /* Shiprocket's "test webhook" and events without an AWB: acknowledge. */
  if (!awb) return NextResponse.json({ success: true, ignored: 'no awb' });

  try {
    const result = await applyTrackingEvent(getDB(), {
      awb: String(awb),
      status: body.current_status || body.shipment_status,
      statusId: body.current_status_id ?? body.shipment_status_id,
      at: parseShiprocketTime(body.current_timestamp) || new Date().toISOString(),
      etd: body.etd || null,
      scans: body.scans,
      source: 'webhook',
    });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('[courier-status webhook]', e.message);
    /* 500 → Shiprocket retries later. */
    return NextResponse.json({ success: false, message: 'Could not apply the update' }, { status: 500 });
  }
}
