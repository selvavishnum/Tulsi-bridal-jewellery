/* Generic CRUD helper for simple admin collections */
import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj } from '@/lib/firebase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { requireRole, ROLES } from '@/lib/requireRole';

/* NODE_ENV check is the safety net here: NEXT_PUBLIC_* vars are inlined into
   the client bundle, so a misconfigured Vercel/preview env that leaks this
   flag into production must not be able to disable admin auth — it only
   takes effect in a non-production build regardless of how the flag itself
   is set. */
const DEV_BYPASS = process.env.NEXT_PUBLIC_ADMIN_BYPASS === 'true' && process.env.NODE_ENV !== 'production';

const MOCK_ADMIN_SESSION = {
  user: { id: 'dev-bypass', email: 'dev-bypass@test.com', name: 'Dev Admin', role: 'admin' },
};

/* Deny by default: every admin route that still calls requireAdmin() is
   SUPER_ADMIN only. Routes that fulfilment or catalog staff need call
   requireRole([...]) explicitly with the tiers they allow — so a new route
   is never accidentally open to every staff member. Returns the session, or
   null (→ the caller responds 403). */
export async function requireAdmin() {
  const access = await requireRole([ROLES.SUPER_ADMIN]);
  return access.error ? null : access.session;
}

/* Money controls (payouts, vendor bank/UPI details, fee rates). Same gate:
   SUPER_ADMIN, which is only ever granted by ADMIN_EMAILS or by another
   SUPER_ADMIN — staff management itself is SUPER_ADMIN-only. */
export const requireOwner = requireAdmin;

/* For endpoints that behave differently for admin vs. customer.
   In DEV_BYPASS mode, always returns a mock admin session. */
export async function getEffectiveSession() {
  if (DEV_BYPASS) return MOCK_ADMIN_SESSION;
  return getServerSession(authOptions);
}

export async function listCollection(col) {
  const db = getDB();
  const snap = await db.collection(col).orderBy('createdAt', 'desc').get();
  return snapshotToArr(snap);
}

export async function createDoc(col, data) {
  const db = getDB();
  const ref = db.collection(col).doc();
  const doc = { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await ref.set(doc);
  return { id: ref.id, ...doc };
}

export async function updateDoc(col, id, data) {
  const db = getDB();
  const ref = db.collection(col).doc(id);
  await ref.update({ ...data, updatedAt: new Date().toISOString() });
  return docToObj(await ref.get());
}

export async function deleteDoc(col, id) {
  const db = getDB();
  await db.collection(col).doc(id).delete();
}
