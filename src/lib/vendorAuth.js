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
