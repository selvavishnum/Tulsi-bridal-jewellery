'use client';

/* ─────────────────────────────────────────────
   Check a coupon that is already on the order once more, through
   /api/coupons/validate — /checkout uses it for a first-order-only code
   that went on the cart while signed out (or under another account): for a
   visitor the check is only a preview, and a returning customer who then
   signs in must hear "first order only" before an order exists, not find
   the discount missing from the bill.

   Pass `code` (null = nothing to check). Each code is checked at most
   once per mount; onResult(result) gets validateCoupon's answer (plus
   result.orderAmount). A definite refusal also forgets the remembered
   welcome code if it is this one. Returns { checking } — the caller holds
   "Place order" meanwhile.
   ───────────────────────────────────────────── */
import { useEffect, useRef, useState } from 'react';
import { getPendingCoupon, clearPendingCoupon } from '@/lib/welcomeOffer';
import { validateCoupon } from './validateCoupon';

export default function useCouponRecheck({ code, orderAmount, onResult }) {
  const checked = useRef(null);
  const mounted = useRef(true);
  const [checking, setChecking] = useState(false);
  const latest = useRef(onResult);
  useEffect(() => { latest.current = onResult; });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!code || checked.current === code) return;
    checked.current = code;
    let settled = false;
    Promise.resolve().then(() => { if (mounted.current && !settled) setChecking(true); });
    validateCoupon(code, orderAmount).then((result) => {
      settled = true;
      if (result.refused && result.definite && getPendingCoupon() === result.code) clearPendingCoupon();
      if (!mounted.current) return;
      setChecking(false);
      latest.current?.({ ...result, orderAmount });
    });
  }, [code, orderAmount]);

  return { checking };
}
