'use client';

/* ─────────────────────────────────────────────
   "Tap the code to apply it": the welcome-offer bar remembers a code
   (setPendingCoupon in src/lib/welcomeOffer.js); the cart, checkout and
   Buy Now drawer call this, when there is something to buy and no coupon
   yet, to apply it through /api/coupons/validate.

   • accepted        → onApplied(result) — the caller stores the coupon
                       (result.orderAmount = the subtotal it was checked at)
   • refused 400/404 → onRejected(result) with the server's reason; the
                       code is forgotten unless the refusal was only this
                       basket's minimum order amount
   • offline / 429 / 5xx → kept for next time, onUnavailable(result)

   At most one automatic check per mount. A code that was kept (minimum
   not met, offline, rate-limited) is not checked again on the next open
   for the same basket: the attempt is remembered for this tab (subtotal,
   time) and retried only once the subtotal changes — for a minimum, once
   it reaches the minimum — or after 10 minutes. onKept(code) then lets
   the caller show the code in its coupon box without a request.

   Tapping the code in the offer bar while this page is open (window event
   'tj:pending-coupon') checks it right away.

   Returns { checking }: true while a check is in flight — the caller holds
   "Place order" meanwhile. An answer that arrives after the order was
   placed or the basket emptied (enabled went false), after a coupon was
   applied by hand, or after unmount is ignored.
   ───────────────────────────────────────────── */
import { useEffect, useRef, useState } from 'react';
import { getPendingCoupon, clearPendingCoupon } from '@/lib/welcomeOffer';
import { validateCoupon } from './validateCoupon';
import { minimumFromMessage } from './checkoutRules';

/* Dispatched by the offer bar (src/components/layout/WelcomeBar.jsx). */
export const PENDING_COUPON_EVENT = 'tj:pending-coupon';
const ATTEMPT_KEY = 'tj-pending-coupon-attempt';
export const KEPT_RETRY_MS = 10 * 60_000;

function tabStore() {
  try { return typeof window !== 'undefined' ? window.sessionStorage || null : null; } catch { return null; }
}
function readAttempt() {
  try {
    const raw = tabStore()?.getItem(ATTEMPT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeAttempt(attempt) {
  try {
    const s = tabStore();
    if (!s) return;
    if (attempt) s.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
    else s.removeItem(ATTEMPT_KEY);
  } catch { /* private mode / full: just checks again next time */ }
}

/**
 * Should an automatic check of `code` at this subtotal be skipped, given the
 * last kept attempt { code, orderAmount, minOrder, at }?
 */
export function keptAttemptStillHolds(attempt, code, orderAmount, now = Date.now()) {
  if (!attempt || attempt.code !== code) return false;
  if (!(now - Number(attempt.at) < KEPT_RETRY_MS)) return false;
  const amount = Number(orderAmount) || 0;
  if (amount === Number(attempt.orderAmount)) return true;
  const min = Number(attempt.minOrder) || 0;
  return min > 0 && amount < min;
}

export default function useAutoApplyPendingCoupon({ enabled, hasCoupon, orderAmount, onApplied, onRejected, onUnavailable, onKept }) {
  const attempted = useRef(false);
  const keptShown = useRef(false);
  /* A code just tapped in the offer bar: checked now, whatever was tried before. */
  const tapped = useRef(null);
  const inFlight = useRef(0);
  const mounted = useRef(true);
  const [checking, setChecking] = useState(false);
  const [taps, setTaps] = useState(0);

  const latest = useRef({ enabled, hasCoupon, onApplied, onRejected, onUnavailable, onKept });
  useEffect(() => {
    latest.current = { enabled, hasCoupon, onApplied, onRejected, onUnavailable, onKept };
  });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
    const onTap = (e) => {
      const code = String(e?.detail?.code || '').trim().toUpperCase() || getPendingCoupon();
      if (!code) return;
      tapped.current = code;
      attempted.current = false;
      setTaps((n) => n + 1);
    };
    window.addEventListener(PENDING_COUPON_EVENT, onTap);
    return () => window.removeEventListener(PENDING_COUPON_EVENT, onTap);
  }, []);

  useEffect(() => {
    if (!enabled || hasCoupon || attempted.current) return;
    const tap = tapped.current;
    const code = tap || getPendingCoupon();
    if (!code) return;

    if (!tap && keptAttemptStillHolds(readAttempt(), code, orderAmount)) {
      /* Same basket as the last kept attempt: no request (and no repeat
         toast). Not counted as this mount's attempt — a bigger basket
         checks it. */
      if (!keptShown.current) {
        keptShown.current = true;
        Promise.resolve().then(() => { if (mounted.current) latest.current.onKept?.(code); });
      }
      return;
    }

    attempted.current = true;
    tapped.current = null;
    inFlight.current += 1;
    Promise.resolve().then(() => { if (mounted.current && inFlight.current > 0) setChecking(true); });

    validateCoupon(code, orderAmount).then((result) => {
      inFlight.current -= 1;
      if (!mounted.current) return;
      setChecking(inFlight.current > 0);

      /* Bookkeeping about the code itself holds whatever happened meanwhile. */
      if (result.ok) writeAttempt(null);
      else if (result.refused && result.definite) { clearPendingCoupon(); writeAttempt(null); }
      else writeAttempt({ code, orderAmount: Number(orderAmount) || 0, minOrder: result.refused ? minimumFromMessage(result.message) : 0, at: Date.now() });

      const cb = latest.current;
      /* The order was placed / the basket emptied, or a coupon went on by
         hand: this answer is about a basket that's gone. */
      if (!cb.enabled || cb.hasCoupon) return;
      if (result.ok) cb.onApplied?.({ ...result, orderAmount });
      else if (result.refused) cb.onRejected?.(result);
      else cb.onUnavailable?.(result);
    });
  }, [enabled, hasCoupon, orderAmount, taps]);

  return { checking };
}
