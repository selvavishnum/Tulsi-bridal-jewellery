/* 002 — Stamp vendorId on every existing vendor-owned document.
   Only touches documents that have no vendorId yet, so it's safe to re-run
   — and it MUST be re-run immediately before Phase 2 switches enforcement
   on, to catch anything the current (pre-tenancy) code created in between.
   Documents still missing vendorId after that are invisible to every
   vendor (scopedDb fails closed), not silently shared. */
import { db, APPLY, pages } from './_lib.mjs';
import { VENDOR_SCOPED, PLATFORM_VENDOR_ID } from '../../src/lib/data/scopedDb.js';

const firestore = db();

/* vendorOrders / vendorLedger / vendorPayouts are new collections, created already scoped. */
const COLLECTIONS = [...VENDOR_SCOPED].filter((c) => !['vendorOrders', 'vendorLedger', 'vendorPayouts'].includes(c));

const vendor = await firestore.collection('vendors').doc(PLATFORM_VENDOR_ID).get();
if (!vendor.exists) {
  console.error(`vendors/${PLATFORM_VENDOR_ID} does not exist — run 001 first.`);
  process.exit(1);
}

let grandTotal = 0;
for (const col of COLLECTIONS) {
  let scanned = 0;
  let needs = 0;
  for await (const docs of pages(firestore, col)) {
    scanned += docs.length;
    const missing = docs.filter((d) => !d.data().vendorId);
    needs += missing.length;
    if (APPLY && missing.length) {
      const batch = firestore.batch();
      for (const d of missing) batch.update(d.ref, { vendorId: PLATFORM_VENDOR_ID });
      await batch.commit();
    }
  }
  grandTotal += needs;
  console.log(`${col.padEnd(16)} scanned ${String(scanned).padStart(6)}   ${APPLY ? 'stamped' : 'would stamp'} ${needs}`);
}

console.log(`\n${APPLY ? 'Stamped' : 'Would stamp'} ${grandTotal} document(s) with vendorId="${PLATFORM_VENDOR_ID}".`);
if (!APPLY && grandTotal) console.log('Re-run with --apply to write.');
