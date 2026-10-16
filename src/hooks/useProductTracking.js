'use client';

import { useEffect, useRef } from 'react';
import { track } from '@/lib/analytics/tracker';

function scrollPercent() {
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - doc.clientHeight;
  if (scrollable <= 0) return 100; // page doesn't scroll — fully "seen"
  return Math.min(100, Math.max(0, Math.round((window.scrollY / scrollable) * 100)));
}

/* One product-detail view: a product_view event on open, and a
   product_engagement event (dwell, scroll depth, carousel and zoom use)
   when the shopper leaves — tab hidden, page closed, or an in-app
   navigation to another page. Both go through the visitor-analytics
   tracker, so guests count too; staff, sellers and automation are
   filtered there.

   Returns two recorders to wire into existing click handlers. */
export function useProductTracking(product) {
  const startRef = useRef(null);
  const scrollDepthRef = useRef(0);
  const carouselClicksRef = useRef(0);
  const zoomInteractionsRef = useRef(0);
  const flushedRef = useRef(true);

  const productId = product?._id || product?.id;

  useEffect(() => {
    if (!productId) return;
    const id = String(productId);
    track('product_view', { productId: id });

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
      track('product_engagement', {
        productId: id,
        dwell: Math.min(14_400, Math.floor((Date.now() - startRef.current) / 1000)),
        scroll: scrollDepthRef.current,
        carousel: Math.min(1000, carouselClicksRef.current),
        zoom: Math.min(1000, zoomInteractionsRef.current),
      });
    }

    /* Registered before the tracker's own hide handler runs its flush,
       so this event leaves with the same beacon. */
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        flush();
      } else if (flushedRef.current) {
        /* Back in the foreground: a fresh viewing window. */
        startRef.current = Date.now();
        scrollDepthRef.current = 0;
        flushedRef.current = false;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange, { capture: true });
    window.addEventListener('pagehide', flush, { capture: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange, { capture: true });
      window.removeEventListener('pagehide', flush, { capture: true });
      flush(); // an in-app navigation away from this product
    };
  }, [productId]);

  return {
    recordCarouselClick: () => { carouselClicksRef.current += 1; },
    recordZoomInteraction: () => { zoomInteractionsRef.current += 1; },
  };
}
