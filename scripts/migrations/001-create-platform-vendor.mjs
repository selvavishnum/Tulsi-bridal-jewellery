/* 001 — Register Tulsi Bridal Jewellery as vendor #1.
   Every existing product, warehouse, stock lot etc. gets assigned to this
   vendor by migration 002. Idempotent: does nothing if it already exists. */
import { db, APPLY } from './_lib.mjs';
import { PLATFORM_VENDOR_ID } from '../../src/lib/data/scopedDb.js';

const firestore = db();
const ref = firestore.collection('vendors').doc(PLATFORM_VENDOR_ID);
const existing = await ref.get();

if (existing.exists) {
  console.log(`vendors/${PLATFORM_VENDOR_ID} already exists — nothing to do.`);
} else {
  const now = new Date().toISOString();
  const doc = {
    name: 'Tulsi Bridal Jewellery',
    status: 'active',
    isPlatformOwner: true,
    commissionBps: 0, // the platform doesn't take commission from its own store
    createdAt: now,
    updatedAt: now,
  };
  console.log(`Would create vendors/${PLATFORM_VENDOR_ID}:`, doc);
  if (APPLY) {
    await ref.set(doc);
    console.log('Created.');
  }
}
