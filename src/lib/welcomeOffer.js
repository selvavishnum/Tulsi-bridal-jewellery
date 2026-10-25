/* ─────────────────────────────────────────────
   Welcome offer bar + "tap the code to apply it".

   The bar's text and code come from the public site settings
   (settings/site.announcement), so the owner can change or switch it off
   without a deploy. Tapping the code remembers it in this browser; the
   cart, checkout and Buy Now drawer apply it automatically (the server
   still decides whether it's valid — e.g. first order only).

   Pure helpers + guarded browser access — localStorage, the clipboard (safe
   during SSR).
   ───────────────────────────────────────────── */
import { deliveryFreeForAll, FREE_DELIVERY_LINE, freeDeliveryClaim } from './storeCharges.js';

export { deliveryFreeForAll, FREE_DELIVERY_LINE };

/* What the strip shows until the owner saves their own (Admin → Settings →
   Welcome Offer Bar). Saved settings override this on the live site, and the
   code is only ever shown while it is a live coupon — scripts/setup-welcome-offer.mjs
   creates TULSI100 and saves this offer. */
export const DEFAULT_ANNOUNCEMENT = Object.freeze({
  enabled: true,
  message: 'Welcome Offer: Flat ₹100 OFF on your first order',
  code: 'TULSI100',
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

/* The strip's delivery clause. "Free Delivery across India" is a promise, so
   it is shown only when the shipping settings really make every order free
   (computeCharges is the authority — the same rule the cart and the order
   endpoint use). Otherwise there is no clause at all: "free above ₹N" is a
   condition, not something to advertise (storeCharges.freeDeliveryClaim). */
export function deliveryLine(charges) {
  return freeDeliveryClaim(charges);
}

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

/**
 * Copy text to the clipboard — from a tap, as browsers require.
 * @returns {Promise<boolean>} whether it was copied (false without the
 *   Clipboard API — http pages, in-app browsers — when the browser refuses,
 *   or when it doesn't answer within `timeoutMs`).
 */
export async function copyToClipboard(text, timeoutMs = 2000) {
  let timer;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return false;
    const copied = navigator.clipboard.writeText(String(text)).then(() => true);
    const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    return await Promise.race([copied, gaveUp]);
  } catch { return false; } finally { clearTimeout(timer); }
}

/**
 * The toast after the code is tapped, from what actually worked:
 * `copied` (on the clipboard) and `saved` (remembered for checkout, which
 * applies it by itself). Never claims either when it didn't happen.
 * @returns {{ kind: 'success'|'info', message: string }}
 */
export function codeTapToast(code, { copied, saved }) {
  if (copied && saved) return { kind: 'success', message: `${code} copied — applied at checkout on your first order` };
  if (copied) return { kind: 'success', message: `${code} copied — paste it at checkout` };
  if (saved) return { kind: 'success', message: `${code} will be applied at checkout` };
  return { kind: 'info', message: `Use code ${code} at checkout` };
}
