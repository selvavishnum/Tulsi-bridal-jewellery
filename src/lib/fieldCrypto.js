/* ─────────────────────────────────────────────
   Field-level encryption for sensitive values stored in Firestore (bank
   account numbers on vendor applications). AES-256-GCM, random IV, auth
   tag — tampering is detected on decrypt.

   Key: VENDOR_DATA_KEY (32 bytes, base64 or hex). If it isn't set, a key
   is derived from NEXTAUTH_SECRET so encryption still happens — set a
   dedicated key in production so rotating the session secret doesn't
   make stored bank details unreadable.
   Pure module (node crypto only).
   ───────────────────────────────────────────── */
import crypto from 'crypto';

function key() {
  const raw = process.env.VENDOR_DATA_KEY;
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    throw new Error('VENDOR_DATA_KEY must be 32 bytes (64 hex chars or base64)');
  }
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Set VENDOR_DATA_KEY (or NEXTAUTH_SECRET) to store bank details');
  return crypto.scryptSync(secret, 'tulsi-field-crypto-v1', 32);
}

/** → "v1:<iv>:<tag>:<ciphertext>" (base64 parts) */
export function encryptField(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptField(value) {
  const [v, iv, tag, data] = String(value || '').split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Not an encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
