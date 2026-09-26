import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, ROLES } from '@/lib/requireRole';
import { parseChargesInput, normalizeCharges } from '@/lib/storeCharges';
import { getStoreCharges } from '@/lib/storeChargesServer';

/* Shipping & COD charges — Super Admin only (they change what every
   customer pays). */
export async function GET() {
  const auth = await requireRole([ROLES.SUPER_ADMIN]);
  if (auth.error) return auth.error;
  return NextResponse.json({ success: true, data: await getStoreCharges(getDB()) });
}

export async function PUT(request) {
  try {
    const auth = await requireRole([ROLES.SUPER_ADMIN]);
    if (auth.error) return auth.error;
    const parsed = parseChargesInput(await request.json().catch(() => null));
    if (parsed.error) return NextResponse.json({ success: false, message: parsed.error }, { status: 400 });
    const db = getDB();
    const ref = db.collection('settings').doc('store_settings');
    await ref.set({ ...parsed.data, updatedAt: new Date().toISOString(), updatedBy: auth.session.user.email || null }, { merge: true });
    const saved = normalizeCharges((await ref.get()).data());
    return NextResponse.json({ success: true, data: saved });
  } catch (e) {
    console.error('[admin/store-charges]', e.message);
    return NextResponse.json({ success: false, message: 'Could not save the charges' }, { status: 500 });
  }
}
