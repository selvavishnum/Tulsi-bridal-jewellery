/* GET /api/admin/analytics/export?range=today|yesterday|7d|30d&type=sessions|events
   Raw visitor data as a CSV download. IPs are already masked at
   collection; customers appear by id only. */
import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { exportCsv, RANGES } from '@/lib/analytics/report';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const auth = await requireRole(CAN.viewReports);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(request.url);
    const range = Object.hasOwn(RANGES, searchParams.get('range')) ? searchParams.get('range') : 'today';
    const type = searchParams.get('type') === 'events' ? 'events' : 'sessions';
    const out = await exportCsv(getDB(), { range, type });
    return new Response(out.csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${out.filename}"`,
        'cache-control': 'no-store',
        'x-export-rows': String(out.rows),
        'x-export-truncated': out.truncated ? '1' : '0',
      },
    });
  } catch (e) {
    console.error('[admin/analytics/export] failed:', e);
    return NextResponse.json({ success: false, message: 'Could not export. Please try again.' }, { status: 500 });
  }
}
