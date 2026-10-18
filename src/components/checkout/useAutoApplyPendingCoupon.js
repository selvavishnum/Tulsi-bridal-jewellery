'use client';

/* ─────────────────────────────────────────────
   "Tap the code to apply it": the welcome-offer bar remembers a code
   (setPendingCoupon in src/lib/welcomeOffer.js); the cart, checkout and
   Buy Now drawer call this once, when there is something to buy and no
   coupon yet, to apply it through /api/coupons/validate.

   • accepted        → onApplied(result) — the caller stores the coupon
   • refused 400/404 → onRejected(result) with the server's reason; the
                       code is forgotten unless the refusal was only this
                       basket's minimum order amount
   • offline / 429 / 5xx → kept for next time, onUnavailable(result)

   One attempt per mount. If a coupon gets applied by hand while the check
   is in flight, the late answer is ignored.
   ───────────────────────────────────────────── */
import { useEffect, useRef } from 'react';
import { getPendingCoupon, clearPendingCoupon } from '@/lib/welcomeOffer';
import { validateCoupon } from './validateCoupon';

export default function useAutoApplyPendingCoupon({ enabled, hasCoupon, orderAmount, onApplied, onRejected, onUnavailable }) {
  const attempted = useRef(false);
  const latest = useRef({ hasCoupon, onApplied, onRejected, onUnavailable });
  useEffect(() => {
    latest.current = { hasCoupon, onApplied, onRejected, onUnavailable };
  });

  useEffect(() => {
    if (!enabled || hasCoupon || attempted.current) return;
    const code = getPendingCoupon();
    if (!code) return;
    attempted.current = true;
    validateCoupon(code, orderAmount).then((result) => {
      const cb = latest.current;
      if (result.ok) {
        if (!cb.hasCoupon) cb.onApplied?.(result);
      } else if (result.refused) {
        if (result.definite) clearPendingCoupon();
        cb.onRejected?.(result);
      } else {
        cb.onUnavailable?.(result);
      }
    });
  }, [enabled, hasCoupon, orderAmount]);
}
