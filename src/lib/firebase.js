/* ─────────────────────────────────────────────
   Firebase Admin SDK — singleton initializer
   Replaces src/lib/mongodb.js + Mongoose
   ───────────────────────────────────────────── */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function parsePrivateKey(raw) {
  if (!raw) return undefined;
  // Strip surrounding quotes Vercel sometimes adds
  let key = raw.replace(/^["']|["']$/g, '');
  // Replace literal \n text with real newlines (common Vercel copy-paste issue)
  key = key.replace(/\\n/g, '\n');
  return key;
}

function initFirebase() {
  if (getApps().length > 0) return getApps()[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is missing. Add it in Vercel → Settings → Environment Variables.');
  if (!clientEmail) throw new Error('FIREBASE_CLIENT_EMAIL is missing. Add it in Vercel → Settings → Environment Variables.');
  if (!privateKey) throw new Error('FIREBASE_PRIVATE_KEY is missing. Add it in Vercel → Settings → Environment Variables.');

  try {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  } catch (err) {
    throw new Error(`Firebase init failed: ${err.message}. Check FIREBASE_PRIVATE_KEY — paste the full key including -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY-----`);
  }
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
