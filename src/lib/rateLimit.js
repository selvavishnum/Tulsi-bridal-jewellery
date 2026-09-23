/* ─────────────────────────────────────────────
   Fixed-window rate limiter backed by Firestore (no Redis on this stack).

   One document per key in `rateLimits`, updated in a transaction, so
   parallel requests on different serverless instances share one count.
   Document ids are a hash of the key: raw emails / IPs never become ids.
   `expireAt` lets a Firestore TTL policy clean old windows up (Firestore
   console → TTL → collection rateLimits, field expireAt).

   Good for per-email / per-IP limits at this site's traffic. A single hot
   key sustains ~1 write/s, which is exactly the point for an attacker's
   key, and irrelevant for everyone else's.

   Pure module (takes `db`), so `node --test` can exercise it.
   ───────────────────────────────────────────── */
import crypto from 'crypto';

export const LIMITS = Object.freeze({
  /* Password login: per email and per IP. */
  loginEmail: { limit: 5, windowMs: 60_000 },
  loginIp: { limit: 20, windowMs: 60_000 },
  /* Email-code login: wrong guesses per email (the code itself also dies
     after MAX_OTP_ATTEMPTS). */
  otpVerifyEmail: { limit: 5, windowMs: 60_000 },
  otpVerifyIp: { limit: 20, windowMs: 60_000 },
  /* Sending codes: stops email bombing and code-refresh brute force. */
  otpSendEmail: { limit: 3, windowMs: 15 * 60_000 },
  otpSendIp: { limit: 10, windowMs: 60 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  contact: { limit: 5, windowMs: 60 * 60_000 },
  couponCheck: { limit: 20, windowMs: 60 * 60_000 },
  review: { limit: 10, windowMs: 60 * 60_000 },
  trackOrder: { limit: 20, windowMs: 60 * 60_000 },
});

const idFor = (key) => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 40);

/**
 * Counts one hit against `key`.
 * @returns {Promise<{ allowed: boolean, retryAfterSec: number }>}
 */
export async function hit(db, key, { limit, windowMs }, now = Date.now()) {
  const ref = db.collection('rateLimits').doc(idFor(key));
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? snap.data() : null;
      if (!cur || now - cur.windowStart >= windowMs) {
        tx.set(ref, { count: 1, windowStart: now, expireAt: new Date(now + windowMs) });
        return { allowed: true, retryAfterSec: 0 };
      }
      const retryAfterSec = Math.max(1, Math.ceil((cur.windowStart + windowMs - now) / 1000));
      if (cur.count >= limit) return { allowed: false, retryAfterSec };
      tx.update(ref, { count: cur.count + 1 });
      return { allowed: true, retryAfterSec: 0 };
    });
  } catch (err) {
    /* Fail open: a limiter outage must not lock every customer out. The
       attempt counters on the OTP document itself still apply. */
    console.error('[rateLimit] check failed:', err.message);
    return { allowed: true, retryAfterSec: 0 };
  }
}

/** Checks several limits; stops at the first that is exceeded. */
export async function hitAll(db, checks, now = Date.now()) {
  for (const [key, rule] of checks) {
    const r = await hit(db, key, rule, now);
    if (!r.allowed) return r;
  }
  return { allowed: true, retryAfterSec: 0 };
}

/* The caller's IP. On Vercel the first x-forwarded-for entry is the client
   (Vercel overwrites the header); works with a Headers object or NextAuth's
   plain `req.headers` record. */
export function clientIp(headers) {
  const get = (h) => (typeof headers?.get === 'function' ? headers.get(h) : headers?.[h]);
  const fwd = get('x-forwarded-for');
  return (fwd ? String(fwd).split(',')[0].trim() : '') || get('x-real-ip') || 'unknown';
}

export function tooManyRequests(retryAfterSec, message = 'Too many attempts. Please wait a minute and try again.') {
  return new Response(JSON.stringify({ success: false, message }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': String(retryAfterSec || 60) },
  });
}
