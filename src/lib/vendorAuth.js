import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getDB } from '@/lib/firebase';
import { resolveActor, can } from '@/lib/rbac';
import { scopedDb, PLATFORM_VENDOR_ID } from '@/lib/data/scopedDb';

function adminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/* Gate for /api/vendor/* — an outside vendor's own login only. The actor
   (and its vendorId) is re-read from the staff record on every request
   rather than trusted from the session token, and all data access goes
   through scopedDb, which can only ever see that vendor's documents. */
export async function requireVendor(permission) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'vendor') return null;
  const db = getDB();
  const actor = await resolveActor(session, db, adminEmails());
  if (!actor || actor.role === 'super_admin' || !actor.vendorId || actor.vendorId === PLATFORM_VENDOR_ID) return null;
  if (permission && !can(actor, permission)) return null;
  return { actor, db, sdb: scopedDb(actor, db) };
}
