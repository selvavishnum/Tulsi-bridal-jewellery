/* ─────────────────────────────────────────────
   Firebase Admin SDK — singleton initializer
   Replaces src/lib/mongodb.js + Mongoose
   ───────────────────────────────────────────── */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function initFirebase() {
  if (getApps().length > 0) return getApps()[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env.local');
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    storageBucket,
  });
}

export function getDB() {
  initFirebase();
  return getFirestore();
}

export function getBucket() {
  initFirebase();
  return getStorage().bucket();
}

export { FieldValue, Timestamp };

/* ─── Helpers ─── */

/** Convert Firestore doc snapshot → plain JS object with `id` field */
export function docToObj(doc) {
  if (!doc.exists) return null;
  const data = doc.data();
  // Convert Timestamps to ISO strings
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Timestamp) {
      clean[k] = v.toDate().toISOString();
    } else {
      clean[k] = v;
    }
  }
  return { id: doc.id, ...clean };
}

/** Convert QuerySnapshot → array of plain objects */
export function snapshotToArr(snap) {
  return snap.docs.map(docToObj);
}

/** Pagination helper — returns { data, total, page, pages } */
export async function paginate(query, page = 1, limit = 12) {
  const countSnap = await query.count().get();
  const total = countSnap.data().count;
  const snap = await query.offset((page - 1) * limit).limit(limit).get();
  return {
    data: snapshotToArr(snap),
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

/** Generate auto IDs similar to MongoDB ObjectIds */
export function newId() {
  return getDB().collection('_').doc().id;
}
