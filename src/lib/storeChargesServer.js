import { normalizeCharges } from '@/lib/storeCharges';

/* Read fresh on every call — no cache — so a change in the admin panel
   applies to the very next order and every checkout that refreshes. */
export async function getStoreCharges(db) {
  const snap = await db.collection('settings').doc('store_settings').get();
  return normalizeCharges(snap.exists ? snap.data() : null);
}
