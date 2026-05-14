'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useCart } from '@/context/CartContext';

function extractCategory(path) {
  if (!path) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'shop') return parts[1];
  if (parts.length >= 1 && parts[0] === 'products') return 'products';
  return null;
}

// Fire-and-forget with 5s timeout so hanging mobile connections never freeze the page
function trackFetch(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

export function TrackingProvider({ children }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { items } = useCart();

  const sessionStartRef = useRef(null);
  const cartDebounceRef = useRef(null);
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return;

    sessionStartRef.current = Date.now();
    trackFetch('/api/track/session', { action: 'start' });

    function sendSessionEnd() {
      if (sessionStartRef.current === null) return;
      const durationSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      navigator.sendBeacon('/api/track/session', JSON.stringify({ action: 'end', durationSeconds }));
      sessionStartRef.current = null;
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        sendSessionEnd();
      } else {
        // App returned to foreground — restart session timer (fixes 10-min mobile freeze)
        sessionStartRef.current = Date.now();
        trackFetch('/api/track/session', { action: 'start' });
      }
    }

    window.addEventListener('beforeunload', sendSessionEnd);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', sendSessionEnd);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId]);

  // Page view tracking
  useEffect(() => {
    if (!userId || !pathname) return;
    trackFetch('/api/track/pageview', { path: pathname, category: extractCategory(pathname) });
  }, [userId, pathname]);

  // Cart sync — debounced 2 seconds
  useEffect(() => {
    if (!userId || !items || items.length === 0) return;

    clearTimeout(cartDebounceRef.current);
    cartDebounceRef.current = setTimeout(() => {
      trackFetch('/api/track/cart', { items });
    }, 2000);

    return () => clearTimeout(cartDebounceRef.current);
  }, [userId, items]);

  return children;
}
