/* /api/admin/category-showcase — the homepage "Shop by Category" cards.
     GET    the showcase as the admin manager sees it (all cards, in order)
     PATCH  { layout?, items?: [{ key, isActive?, isFeatured?, image?, focus? }], order? }
            changes only what is sent (optimistic toggles never clobber each
            other) and returns the updated showcase.
   Stored in settings/site.categoryShowcase (see src/lib/categoryShowcase.js);
   the storefront reads it through the public settings GET. */
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDB } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import { normalizeShowcase, applyShowcasePatch, toStored } from '@/lib/categoryShowcase';
import { ShowcasePatch } from '@/lib/categoryShowcaseSchema';

export const dynamic = 'force-dynamic';

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

export async function GET() {
  if (!(await requireAdmin())) return forbidden();
  try {
    const doc = await getDB().collection('settings').doc('site').get();
    return NextResponse.json({ success: true, data: normalizeShowcase(doc.exists ? doc.data() : {}) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[category-showcase] GET failed:', e);
    return NextResponse.json({ success: false, message: 'Could not load the category showcase.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  if (!(await requireAdmin())) return forbidden();
  let body;
  try { body = await request.json(); } catch { body = null; }
  const parsed = ShowcasePatch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: parsed.error.issues[0]?.message || 'Invalid change' }, { status: 400 });
  }
  try {
    const db = getDB();
    const ref = db.collection('settings').doc('site');
    /* Read-modify-write in one transaction: two admins (or two quick
       clicks) each change only their own fields. */
    const next = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const updated = applyShowcasePatch(normalizeShowcase(snap.exists ? snap.data() : {}), parsed.data);
      tx.set(ref, { categoryShowcase: toStored(updated), updatedAt: new Date().toISOString() }, { merge: true });
      return updated;
    });
    /* The homepage is rendered with this showcase in its HTML: drop that copy
       now, so the change shows on the next visit rather than within 5 minutes.
       revalidatePath throws outside a Next request (unit tests); the 5-minute
       refresh covers that case. */
    try { revalidatePath('/'); } catch { /* not in a request */ }
    return NextResponse.json({ success: true, data: next });
  } catch (e) {
    console.error('[category-showcase] PATCH failed:', e);
    return NextResponse.json({ success: false, message: 'Could not save. Please try again.' }, { status: 500 });
  }
}
