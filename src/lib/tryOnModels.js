/* ─────────────────────────────────────────────
   AI Model Studio portraits — settings/tryon_models:
     tones.<toneId> = { portrait, anchors, source: 'upload'|'ai', updatedAt, updatedBy }
     generated.<toneId> = { promptHash, url, at }   (Option B cache)
   Takes `db`.
   ───────────────────────────────────────────── */
import crypto from 'crypto';
import { SKIN_TONES, parseAnchors } from './tryOn.js';

export const TRYON_DOC = ['settings', 'tryon_models'];
const ref = (db) => db.collection(TRYON_DOC[0]).doc(TRYON_DOC[1]);

export async function readTryOnDoc(db) {
  const snap = await ref(db).get();
  return snap.exists ? snap.data() : {};
}

/** What the storefront gets: tones that have a portrait with valid anchors, in swatch order. */
export async function publicTryOnModels(db) {
  const doc = await readTryOnDoc(db);
  return SKIN_TONES
    .map((t) => {
      const m = doc.tones?.[t.id];
      const anchors = parseAnchors(m?.anchors);
      return m?.portrait && anchors ? { id: t.id, label: t.label, hex: t.hex, portrait: m.portrait, anchors } : null;
    })
    .filter(Boolean);
}

export const isOurImage = (url) => typeof url === 'string' && /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url);

export async function saveTone(db, toneId, { portrait, anchors, source }, by) {
  await ref(db).set({
    tones: { [toneId]: { portrait, anchors, source, updatedAt: new Date().toISOString(), updatedBy: by || null } },
  }, { merge: true });
}

export async function removeTone(db, toneId) {
  const doc = await readTryOnDoc(db);
  const tones = { ...(doc.tones || {}) };
  delete tones[toneId];
  await ref(db).set({ ...doc, tones });
}

export const promptHash = (prompt) => crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);

export async function cachedGeneration(db, toneId, hash) {
  const doc = await readTryOnDoc(db);
  const g = doc.generated?.[toneId];
  return g && g.promptHash === hash ? g.url : null;
}

export async function rememberGeneration(db, toneId, hash, url) {
  await ref(db).set({ generated: { [toneId]: { promptHash: hash, url, at: new Date().toISOString() } } }, { merge: true });
}
