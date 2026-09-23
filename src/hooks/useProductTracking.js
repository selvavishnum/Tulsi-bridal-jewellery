'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

/* Fire-and-forget with 5s timeout so hanging mobile connections never freeze
   the page — same pattern as src/components/TrackingProvider.js. */
function trackFetch(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  }).catch(() => {}).finally(() => clearTimeout(timer));
}

function scrollPercent() {
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - doc.clientHeight;
  if (scrollable <= 0) return 100; // page doesn't scroll — fully "seen"
  return Math.min(100, Math.max(0, Math.round((window.scrollY / scrollable) * 100)));
}

/* Tracks dwell time, scroll depth, carousel navigation and zoom
   interactions for a single product-detail view, and flushes it exactly
   the way TrackingProvider flushes session time: on tab-hide and on
   unload via sendBeacon (never lost to a killed in-flight fetch), plus on
   unmount to cover an in-app navigation to a different product (no
   beforeunload fires for that, since it's a client-side route change).

   Returns two imperative recorders to wire into existing click handlers —
   this hook owns state and flushing, the caller just reports events. */
export function useProductTracking(product) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'vendor';
  const isBot = typeof navigator !== 'undefined' && navigator.webdriver === true;
  const skip = isAdmin || isBot;

  const startRef = useRef(null);
  const scrollDepthRef = useRef(0);
  const carouselClicksRef = useRef(0);
  const zoomInteractionsRef = useRef(0);
  const flushedRef = useRef(true);

  const productId = product?._id || product?.id;

  useEffect(() => {
    if (skip || !productId) return; // don't let internal testing or automation skew customer engagement metrics

    startRef.current = Date.now();
    scrollDepthRef.current = 0;
    carouselClicksRef.current = 0;
    zoomInteractionsRef.current = 0;
    flushedRef.current = false;

    let scrollTicking = false;
    function onScroll() {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollDepthRef.current = Math.max(scrollDepthRef.current, scrollPercent());
        scrollTicking = false;
      });
    }

    function flush() {
      if (flushedRef.current || startRef.current === null) return;
      flushedRef.current = true;
      const payload = {
        productId,
        name: product.name,
        slug: product.slug,
        image: product.images?.[0],
        price: product.discountPrice || product.price,
        category: product.category || null,
        dwellSeconds: Math.floor((Date.now() - startRef.current) / 1000),
        scrollDepthPercentage: scrollDepthRef.current,
        carouselClicks: carouselClicksRef.current,
        zoomInteractions: zoomInteractionsRef.current,
      };
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track/product', JSON.stringify(payload));
      } else {
        trackFetch('/api/track/product', payload);
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        flush();
      } else if (flushedRef.current) {
        // Back in the foreground after having flushed — this is a fresh
        // viewing window, same restart logic as TrackingProvider's session timer.
        startRef.current = Date.now();
        scrollDepthRef.current = 0;
        flushedRef.current = false;
      }
    }

    function onBeforeUnload() { flush(); }

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush(); // covers an in-app navigation away from this product (no beforeunload)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, productId]);

  return {
    recordCarouselClick: () => { carouselClicksRef.current += 1; },
    recordZoomInteraction: () => { zoomInteractionsRef.current += 1; },
  };
}
