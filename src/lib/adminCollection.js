/* Generic CRUD helper for simple admin collections */
import { NextResponse } from 'next/server';
import { getDB, snapshotToArr, docToObj } from '@/lib/firebase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

const DEV_BYPASS = process.env.NEXT_PUBLIC_ADMIN_BYPASS === 'true';

const MOCK_ADMIN_SESSION = {
  user: { id: 'dev-bypass', email: 'dev-bypass@test.com', name: 'Dev Admin', role: 'admin' },
};

/* Returns admin session. In DEV_BYPASS mode, always succeeds. */
export async function requireAdmin() {
  if (DEV_BYPASS) return MOCK_ADMIN_SESSION;
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') return null;
  return session;
}

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
