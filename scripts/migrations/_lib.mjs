/* Shared setup for one-off Firestore migrations.
   Run from the repo root with the same env vars the app uses, e.g.:
     node --env-file=.env.local scripts/migrations/001-create-platform-vendor.mjs          (dry run)
     node --env-file=.env.local scripts/migrations/001-create-platform-vendor.mjs --apply  (writes)
   Every migration is a dry run unless --apply is passed, and is safe to re-run. */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';

export const APPLY = process.argv.includes('--apply');

export function db() {
  if (!getApps().length) {
    const { FIREBASE_PROJECT_ID: projectId, FIREBASE_CLIENT_EMAIL: clientEmail } = process.env;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — pass --env-file.');
      process.exit(1);
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    console.log(`Project: ${projectId}   Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);
  }
  return getFirestore();
}

/* Walks a whole collection in document-id order, one page at a time, so
   memory stays flat however large the collection gets. */
export async function* pages(firestore, col, pageSize = 400) {
  let last = null;
  for (;;) {
    let q = firestore.collection(col).orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    yield snap.docs;
    last = snap.docs[snap.docs.length - 1];
  }
}
