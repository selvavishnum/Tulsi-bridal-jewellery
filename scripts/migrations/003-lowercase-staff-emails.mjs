/* 003 — Lowercase existing staff login emails.
   Sign-in looks staff up by lowercased email, but staff were saved with the
   email exactly as typed, so anyone added as e.g. "Priya@TulsiJewels.in"
   has never been able to log in. New staff are now saved lowercased; this
   fixes the existing records. Refuses to touch an email whose lowercase
   form would collide with another staff record — resolve those by hand. */
import { db, APPLY, pages } from './_lib.mjs';

const firestore = db();
const all = [];
for await (const docs of pages(firestore, 'staff')) all.push(...docs);

const byLower = new Map();
for (const d of all) {
  const lower = String(d.data().email || '').trim().toLowerCase();
  if (!byLower.has(lower)) byLower.set(lower, []);
  byLower.get(lower).push(d);
}

let fixed = 0;
let skipped = 0;
for (const d of all) {
  const email = String(d.data().email || '');
  const lower = email.trim().toLowerCase();
  if (email === lower) continue;
  if (byLower.get(lower).length > 1) {
    console.log(`SKIP ${d.id}: "${email}" collides with another staff record for ${lower}`);
    skipped += 1;
    continue;
  }
  console.log(`${APPLY ? 'Fix' : 'Would fix'} ${d.id}: "${email}" → "${lower}"`);
  if (APPLY) await d.ref.update({ email: lower, updatedAt: new Date().toISOString() });
  fixed += 1;
}
console.log(`\n${APPLY ? 'Fixed' : 'Would fix'} ${fixed}, skipped ${skipped} of ${all.length} staff record(s).`);
if (!APPLY && fixed) console.log('Re-run with --apply to write.');
