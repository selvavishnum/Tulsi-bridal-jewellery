/* ─────────────────────────────────────────────
   Creating a vendor and its dashboard login — shared by the Super Admin
   "Add vendor" form and "Approve" on a seller application.

   Takes `db` and plain values; the caller authorises and validates.
   ───────────────────────────────────────────── */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export class ProvisionError extends Error {}

/* Readable temporary password: no 0/O/1/l/I look-alikes. */
export function tempPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * @param {object} db
 * @param {{ vendor: object, login: { email: string, password: string, name: string, phone?: string }, ownerEmails?: string[] }} input
 *   `vendor` is written as-is plus status/timestamps.
 * @returns {Promise<{ vendorId: string, staffId: string }>}
 * @throws ProvisionError when the login email is already taken
 */
export async function createVendorAccount(db, { vendor, login, ownerEmails = [] }) {
  const email = String(login.email || '').trim().toLowerCase();
  if (ownerEmails.includes(email)) throw new ProvisionError('That email belongs to a store owner.');
  const dup = await db.collection('staff').where('email', '==', email).limit(1).get();
  if (!dup.empty) throw new ProvisionError('That email is already used by a staff or vendor login.');

  const now = new Date().toISOString();
  const vendorRef = db.collection('vendors').doc();
  const staffRef = db.collection('staff').doc();
  const batch = db.batch();
  batch.set(vendorRef, { status: 'active', ...vendor, createdAt: now, updatedAt: now });
  batch.set(staffRef, {
    name: login.name,
    email,
    password: await bcrypt.hash(String(login.password), 10),
    role: 'VENDOR',
    vendorId: vendorRef.id,
    phone: login.phone || '',
    status: 'Active',
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();
  return { vendorId: vendorRef.id, staffId: staffRef.id };
}
