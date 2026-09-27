import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { publicTryOnModels } from '@/lib/tryOnModels';

/* GET /api/try-on/models — model portraits for AI Model Studio (public). */
export async function GET() {
  try {
    const data = await publicTryOnModels(getDB());
    return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' } });
  } catch (e) {
    console.error('[try-on/models]', e.message);
    return NextResponse.json({ success: true, data: [] });
  }
}
