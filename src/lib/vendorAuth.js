import { NextResponse } from 'next/server';
import { requireRole, ROLES } from '@/lib/requireRole';
import { getDB } from '@/lib/firebase';
import { scopedDb } from '@/lib/data/scopedDb';

/* Gate for /api/vendor/* — an outside vendor's own login only. The tier and
   vendorId are re-read from the staff record on every request (zero trust),
   and all vendor-owned data goes through scopedDb, which appends
   `vendorId == <this vendor>` to every query and treats other vendors'
   documents as missing. Returns { error } (401/403) or the context. */
export async function requireVendor() {
  const access = await requireRole([ROLES.VENDOR]);
  if (access.error) return access;
  const db = getDB();
  const actor = { role: 'vendor', vendorId: access.vendorId };
  return { ...access, db, actor, sdb: scopedDb(actor, db) };
}

/* Same, for writes: a suspended vendor can still read their orders and
   earnings, but can't change their catalogue or profile. Adds `vendor`
   (the vendors document) to the context. */
export async function requireActiveVendor() {
  const ctx = await requireVendor();
  if (ctx.error) return ctx;
  const snap = await ctx.db.collection('vendors').doc(ctx.vendorId).get();
  if (!snap.exists) return { error: NextResponse.json({ success: false, message: 'Vendor not found' }, { status: 404 }) };
  const vendor = snap.data();
  if (vendor.status === 'suspended') {
    return { error: NextResponse.json({ success: false, message: 'Your store is paused. Contact Tulsi to make changes.' }, { status: 403 }) };
  }
  return { ...ctx, vendor };
}

/* Vendor stock corrections are recorded for reconciliation, like staff ones. */
export async function logVendorStockChange(ctx, productId, from, to) {
  await ctx.db.collection('stockAdjustments').add({
    productId, from, to, vendorId: ctx.vendorId,
    by: ctx.session?.user?.email || null, tier: 'VENDOR',
    lotsReconciled: false, createdAt: new Date().toISOString(),
  });
}
