/* 004 — Rewrite pre-4-tier staff roles to the new names.
     SuperAdmin                      → left unchanged, reported: before the
                                       4-tier model anyone could set it, so it
                                       grants nothing — re-grant on the Staff
                                       page if intended
     OrderManager, SalesStaff        → ORDER_FULFILLMENT_STAFF
     ProductManager, InventoryManager→ CATALOG_STAFF
     VendorAdmin (vendor logins)     → VENDOR
     BusinessManager                 → left unchanged, reported: it has no
                                       least-privilege tier below SUPER_ADMIN,
                                       so that person has no admin access until
                                       a Super Admin picks a role on the Staff page.
   The app already maps the old names at sign-in, so nothing breaks before
   this runs; this just makes the stored data match. Also lists everyone who
   will hold SUPER_ADMIN, for the owner to review. */
import { db, APPLY, pages } from './_lib.mjs';
import { normalizeStaffRole, ROLES } from '../../src/lib/access.js';
import { PLATFORM_VENDOR_ID } from '../../src/lib/data/scopedDb.js';

const firestore = db();
let changed = 0;
const unmapped = [];
const superAdmins = [];

for await (const docs of pages(firestore, 'staff')) {
  for (const d of docs) {
    const s = d.data();
    const isVendorLogin = s.vendorId && s.vendorId !== PLATFORM_VENDOR_ID;
    const target = isVendorLogin ? ROLES.VENDOR : normalizeStaffRole(s.role);
    if (!target || (!isVendorLogin && target === ROLES.VENDOR)) {
      unmapped.push(`${d.id} ${s.email} (role: ${s.role ?? 'none'})`);
      continue;
    }
    if (target === ROLES.SUPER_ADMIN && !s.roleGrantedBy) {
      unmapped.push(`${d.id} ${s.email} (role: SUPER_ADMIN, but not granted through the Staff page — not honoured)`);
      continue;
    }
    if (target === ROLES.SUPER_ADMIN && s.status === 'Active') superAdmins.push(`${s.email} (granted by ${s.roleGrantedBy})`);
    if (s.role === target) continue;
    console.log(`${APPLY ? 'Update' : 'Would update'} ${d.id} ${s.email}: ${s.role} → ${target}`);
    if (APPLY) await d.ref.update({ role: target, legacyRole: s.role ?? null, updatedAt: new Date().toISOString() });
    changed += 1;
  }
}

console.log(`\n${APPLY ? 'Updated' : 'Would update'} ${changed} staff record(s).`);
if (unmapped.length) {
  console.log(`\nNo tier — these people have NO admin access until a Super Admin assigns a role on the Staff page:`);
  unmapped.forEach((u) => console.log(`  ${u}`));
}
console.log(`\nActive staff records with SUPER_ADMIN (plus everyone in ADMIN_EMAILS) — review these:`);
(superAdmins.length ? superAdmins : ['(none)']).forEach((u) => console.log(`  ${u}`));
if (!APPLY && changed) console.log('\nRe-run with --apply to write.');
