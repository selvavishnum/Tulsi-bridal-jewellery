/* ─────────────────────────────────────────────
   Email sign-in codes.

   One code per email, in `otp_codes/{sha256(email)}`. Stored as a keyed
   hash (never the code itself), valid 10 minutes, single use, and dead
   after MAX_OTP_ATTEMPTS wrong guesses — so the 1-in-a-million keyspace
   can't be brute-forced (5 guesses per code, and new codes are rate
   limited in send-otp). Verification is a transaction, so parallel
   guesses can't all read the same attempt count.

   Pure module (takes `db`), so `node --test` can exercise it.
   ───────────────────────────────────────────── */
import crypto from 'crypto';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/* One plain address: no spaces, commas or angle brackets (so a single
   request can't mail several people), a dot in the domain, ≤ 254 chars. */
const EMAIL = /^[^\s@,;<>"'()[\]\\]+@[^\s@,;<>"'()[\]\\]+\.[^\s@,;<>"'()[\]\\]{2,}$/;
export const isValidEmail = (email) => email.length <= 254 && EMAIL.test(email);

const docId = (email) => sha256(`otp:${email}`).slice(0, 40);
function codeHash(email, code) {
  const pepper = process.env.NEXTAUTH_SECRET || '';
  return crypto.createHmac('sha256', pepper).update(`${email}:${code}`).digest('hex');
}

export function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/** Stores a fresh code for `email` (replacing any earlier one). */
export async function saveOtp(db, email, code, now = Date.now()) {
  await db.collection('otp_codes').doc(docId(email)).set({
    codeHash: codeHash(email, code),
    attempts: 0,
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
    createdAt: new Date(now).toISOString(),
  });
}

/**
 * Checks a code. Returns true once for the right code within its window;
 * every wrong guess is counted and the code is deleted on the last one.
 */
export async function verifyOtp(db, email, code, now = Date.now()) {
  const guess = String(code || '').trim();
  if (!/^\d{6}$/.test(guess)) return false;
  const ref = db.collection('otp_codes').doc(docId(email));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const d = snap.data();
    if (new Date(d.expiresAt).getTime() < now || (d.attempts || 0) >= MAX_OTP_ATTEMPTS || !d.codeHash) {
      tx.delete(ref);
      return false;
    }
    const a = Buffer.from(codeHash(email, guess), 'hex');
    const b = Buffer.from(d.codeHash, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      tx.delete(ref); // single use
      return true;
    }
    const attempts = (d.attempts || 0) + 1;
    if (attempts >= MAX_OTP_ATTEMPTS) tx.delete(ref);
    else tx.update(ref, { attempts });
    return false;
  });
}
