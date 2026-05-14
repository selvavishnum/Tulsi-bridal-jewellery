'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useCart } from '@/context/CartContext';

function extractCategory(path) {
  if (!path) return null;
  const parts = path.split('/').filter(Boolean);
  // /shop/necklace → necklace
  // /products/... → products
  if (parts.length >= 2 && parts[0] === 'shop') return parts[1];
  if (parts.length >= 1 && parts[0] === 'products') return 'products';
  return null;
}

export function TrackingProvider({ children }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { items } = useCart();

  const sessionStartRef = useRef(null);
  const cartDebounceRef = useRef(null);
  const userId = session?.user?.id;

  // Session tracking — start on mount when user is logged in
  useEffect(() => {
    if (!userId) return;

    // Mark session start
    sessionStartRef.current = Date.now();
    fetch('/api/track/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    }).catch(() => {});

    function sendSessionEnd() {
      if (sessionStartRef.current === null) return;
      const durationSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      navigator.sendBeacon(
        '/api/track/session',
        JSON.stringify({ action: 'end', durationSeconds })
      );
      sessionStartRef.current = null;
    }

    function handleBeforeUnload() {
      sendSessionEnd();
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        sendSessionEnd();
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId]);

  // Page view tracking — on every pathname change
  useEffect(() => {
    if (!userId || !pathname) return;

    fetch('/api/track/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathname, category: extractCategory(pathname) }),
    }).catch(() => {});
  }, [userId, pathname]);

  // Cart sync — debounced 2 seconds when cart changes
  useEffect(() => {
    if (!userId || !items || items.length === 0) return;

    if (cartDebounceRef.current) {
      clearTimeout(cartDebounceRef.current);
    }

    cartDebounceRef.current = setTimeout(() => {
      fetch('/api/track/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      }).catch(() => {});
    }, 2000);

    return () => {
      if (cartDebounceRef.current) {
        clearTimeout(cartDebounceRef.current);
      }
    };
  }, [userId, items]);

  return children;
}
