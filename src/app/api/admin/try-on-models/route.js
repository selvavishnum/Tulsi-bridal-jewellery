import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { TONE_IDS, parseAnchors } from '@/lib/tryOn';
import { readTryOnDoc, saveTone, removeTone, isOurImage } from '@/lib/tryOnModels';

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

/* GET /api/admin/try-on-models — every tone's portrait, anchors and source. */
export async function GET() {
  try {
    const auth = await requireRole(CAN.editCatalog);
    if (auth.error) return auth.error;
    const doc = await readTryOnDoc(getDB());
    return NextResponse.json({ success: true, data: { tones: doc.tones || {}, aiConfigured: !!process.env.REPLICATE_API_TOKEN } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

/* PUT /api/admin/try-on-models { tone, portrait, anchors, source } | { tone, remove: true } */
export async function PUT(request) {
  try {
    const auth = await requireRole(CAN.editCatalog);
    if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    if (!TONE_IDS.includes(body.tone)) return fail('Unknown skin tone.');
    const db = getDB();
    if (body.remove === true) {
      await removeTone(db, body.tone);
      return NextResponse.json({ success: true });
    }
    if (!isOurImage(body.portrait)) return fail('Upload the portrait to the store first.');
    const anchors = parseAnchors(body.anchors);
    if (!anchors) return fail('Face position is missing — run “Detect face” again.');
    await saveTone(db, body.tone, { portrait: body.portrait, anchors, source: body.source === 'ai' ? 'ai' : 'upload' }, auth.session?.user?.email);
    return NextResponse.json({ success: true, data: { anchors } });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
