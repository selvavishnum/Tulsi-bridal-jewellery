/* ─────────────────────────────────────────────
   Welcome offer bar + "tap the code to apply it".

   The bar's text and code come from the public site settings
   (settings/site.announcement), so the owner can change or switch it off
   without a deploy. Tapping the code remembers it in this browser; the
   cart, checkout and Buy Now drawer apply it automatically (the server
   still decides whether it's valid — e.g. first order only).

   Pure helpers + guarded localStorage access (safe during SSR).
   ───────────────────────────────────────────── */

export const DEFAULT_ANNOUNCEMENT = Object.freeze({
  enabled: true,
  message: 'Welcome Offer: Flat 10% OFF on your first jewellery order',
  code: 'TULSI10',
});

const CODE_RE = /^[A-Z0-9_-]{3,30}$/;

/** The bar as configured (defaults when the owner hasn't set it). */
export function normalizeAnnouncement(settings = {}) {
  const a = settings && typeof settings.announcement === 'object' && settings.announcement ? settings.announcement : {};
  const code = typeof a.code === 'string' ? a.code.trim().toUpperCase() : DEFAULT_ANNOUNCEMENT.code;
  const message = typeof a.message === 'string' ? a.message.replace(/[<>]/g, '').trim().slice(0, 140) : DEFAULT_ANNOUNCEMENT.message;
  return {
    enabled: typeof a.enabled === 'boolean' ? a.enabled : DEFAULT_ANNOUNCEMENT.enabled,
    message: message || DEFAULT_ANNOUNCEMENT.message,
    code: code === '' || CODE_RE.test(code) ? code : '',
  };
}

/* Dismissal is per message+code: a new offer shows again. */
export const DISMISS_KEY = 'tj-announce-dismissed';
export const dismissToken = (a) => `${a.code}|${a.message}`.slice(0, 200);

export const PENDING_COUPON_KEY = 'tj-pending-coupon';

function store() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

/** Remember a code to apply at checkout (expires after 30 days).
 *  @returns {boolean} whether it was actually saved (false without storage). */
export function setPendingCoupon(code) {
  const c = String(code || '').trim().toUpperCase();
  const s = store();
  if (!CODE_RE.test(c) || !s) return false;
  try { s.setItem(PENDING_COUPON_KEY, JSON.stringify({ code: c, at: Date.now() })); return true; } catch { return false; }
}

/** The remembered code, or null. */
export function getPendingCoupon() {
  try {
    const raw = store()?.getItem(PENDING_COUPON_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw);
    if (!CODE_RE.test(code || '') || !(Date.now() - Number(at) < 30 * 86_400_000)) return null;
    return code;
  } catch { return null; }
}

/** Forget it (applied, or the server said it can't be used). */
export function clearPendingCoupon() {
  try { store()?.removeItem(PENDING_COUPON_KEY); } catch { /* private mode */ }
}
