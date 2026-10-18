'use client';

/* Back from sign-in with ?buynow=<qty> (the Buy Now drawer's sign-in link,
   see buyNowSignInUrl): once the product has loaded, reopen Buy Now for that
   quantity — bounded by the real stock — and drop the parameter with
   router.replace, so it adds no history entry and a refresh doesn't reopen
   it. Runs once per page load. */
import { useEffect, useRef } from 'react';
import { clampQty, maxOrderQty } from '@/components/checkout/checkoutRules';

/**
 * @param {{ product: object|null, ready: boolean, router: object,
 *           onOpen: (qty: number) => void, onSoldOut?: () => void }} o
 */
export default function useBuyNowReturn({ product, ready, router, onOpen, onSoldOut }) {
  const handled = useRef(false);
  useEffect(() => {
    if (!ready || !product || handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('buynow')) return;
    const requested = params.get('buynow');
    params.delete('buynow');
    const qs = params.toString();
    router.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`, { scroll: false });
    const max = maxOrderQty(product);
    if (max >= 1) onOpen(clampQty(requested, max));
    else onSoldOut?.();
  }, [ready, product, router, onOpen, onSoldOut]);
}
