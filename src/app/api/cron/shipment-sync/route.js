import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDB } from '@/lib/firebase';
import { trackShiprocketAWB, isConfigured } from '@/lib/shiprocket';
import { applyTrackingEvent } from '@/lib/shipmentSync';
import { parseShiprocketTime } from '@/lib/shipmentStatus';

export const maxDuration = 60;

const STALE_MS = 6 * 60 * 60 * 1000; // re-check parcels not updated for 6 hours
const MAX_PARCELS = 60;

/* GET /api/cron/shipment-sync — daily catch-up (vercel.json cron): asks
   Shiprocket for the latest status of every parcel still on its way whose
   status hasn't been updated recently, in case a webhook was missed.
   Vercel calls it with "Authorization: Bearer <CRON_SECRET>". */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const got = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (!secret || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  if (!isConfigured()) return NextResponse.json({ success: true, skipped: 'Shiprocket not configured' });

  const db = getDB();
  const snaps = await Promise.all(['processing', 'shipped'].map((s) => db.collection('orders').where('status', '==', s).get()));
  const now = Date.now();
  const parcels = [];
  for (const snap of snaps) {
    for (const d of snap.docs) {
      for (const p of Object.values(d.data().shipments || {})) {
        if (p?.awb && (!p.tracking?.at || now - new Date(p.tracking.at).getTime() > STALE_MS)) parcels.push(p.awb);
      }
    }
  }

  const results = [];
  for (const awb of parcels.slice(0, MAX_PARCELS)) {
    try {
      const t = await trackShiprocketAWB(awb);
      if (!t.success) { results.push({ awb, ok: false, reason: t.message }); continue; }
      const latest = t.activities?.[0];
      const r = await applyTrackingEvent(db, {
        awb, status: typeof t.status === 'string' ? t.status : latest?.activity, statusId: typeof t.status === 'number' ? t.status : undefined,
        at: parseShiprocketTime(latest?.date) || new Date().toISOString(), etd: t.etd, scans: [...(t.activities || [])].reverse(), source: 'daily_sync',
      });
      results.push({ awb, ...r });
    } catch (e) {
      results.push({ awb, ok: false, reason: e.message });
    }
  }
  return NextResponse.json({ success: true, checked: results.length, pending: Math.max(0, parcels.length - MAX_PARCELS), results });
}
