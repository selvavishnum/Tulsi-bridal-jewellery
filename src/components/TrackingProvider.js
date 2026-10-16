'use client';

/* Starts visitor analytics for every visitor — guests and signed-in
   customers alike (src/lib/analytics/tracker.js). Staff and sellers browsing
   the shop, and automated browsers, are not counted; the server checks the
   same thing again. */
import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { start, setMode, trackPageView } from '@/lib/analytics/tracker';

export function TrackingProvider({ children }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { items } = useCart();
  const itemsRef = useRef(items);
  const role = session?.user?.role;

  /* Each batch carries the current cart, for live cart abandonment. */
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => { start({ cart: () => itemsRef.current }); }, []);

  /* Events queue while the session loads, then send — or are dropped for
     staff and sellers. */
  useEffect(() => {
    if (status === 'loading') return;
    setMode(role && role !== 'customer' ? 'off' : 'on');
  }, [status, role]);

  useEffect(() => {
    if (pathname) trackPageView(pathname);
  }, [pathname]);

  return children;
}
