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
  /* An admin logged in and browsing the storefront as themselves (testing
     a feature, checking a product page) must not be counted as customer
     traffic — every effect below is gated on this in addition to the
     existing /admin path check, which only ever covered the admin UI
     routes, not an admin's ordinary storefront browsing.
     navigator.webdriver is set to true by default in every mainstream
     automation tool (Selenium, Playwright, Puppeteer) unless the script
     explicitly patches it away — cheap, standard first line of defense
     against test/scraper traffic inflating session and pageview counts.
     (Not reactive — a session's automation status can't change mid-visit,
     so a plain const is fine here, no state/effect needed to track it.) */
  const isAdminUser = session?.user?.role === 'admin' || session?.user?.role === 'vendor';
  const isBot = typeof navigator !== 'undefined' && navigator.webdriver === true;
  const skipTracking = isAdminUser || isBot;

  useEffect(() => {
    if (!userId || skipTracking) return;

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
  }, [userId, skipTracking]);

  // Page view tracking (logged-in customers — feeds the per-customer interest data)
  useEffect(() => {
    if (!userId || skipTracking || !pathname || pathname.startsWith('/admin')) return;
    trackFetch('/api/track/pageview', { path: pathname, category: extractCategory(pathname) });
  }, [userId, skipTracking, pathname]);

  // Site-wide visit tracking — every visitor, logged in or not. This is what
  // answers "how many people visit the website"; the effect above only ever
  // counted customers who were signed in.
  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin') || skipTracking) return; // don't count your own admin usage, whether from an admin URL or an admin's own storefront browsing
    let visitorId;
    try {
      visitorId = localStorage.getItem('tulsi_visitor_id');
      if (!visitorId) {
        visitorId = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        localStorage.setItem('tulsi_visitor_id', visitorId);
      }
    } catch {
      return; // storage unavailable (private mode, etc.) — skip rather than double count
    }
    trackFetch('/api/track/visit', { visitorId });
  }, [pathname, skipTracking]);

  // Cart sync — debounced 2 seconds
  useEffect(() => {
    if (!userId || skipTracking || !items || items.length === 0) return;

    clearTimeout(cartDebounceRef.current);
    cartDebounceRef.current = setTimeout(() => {
      trackFetch('/api/track/cart', { items });
    }, 2000);

    return () => clearTimeout(cartDebounceRef.current);
  }, [userId, skipTracking, items]);

  return children;
}
