'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

const WishlistContext = createContext(null);

function getId(product) {
  return product?.id || product?._id || null;
}

export function WishlistProvider({ children }) {
  const { data: session, status } = useSession();
  const [items, setItems] = useState([]);
  const [synced, setSynced] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tulsi-wishlist');
      if (saved) setItems(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  // When user logs in, merge localStorage wishlist with DB
  useEffect(() => {
    if (status !== 'authenticated' || synced) return;
    fetch('/api/wishlist')
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        const dbItems = d.data || [];
        setItems((prev) => {
          const dbIds = new Set(dbItems.map(getId));
          const localOnly = prev.filter((p) => !dbIds.has(getId(p)));
          // Push local-only items to DB
          localOnly.forEach((p) => {
            const pid = getId(p);
            if (pid) {
              fetch('/api/wishlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: pid }),
              }).catch(() => {});
            }
          });
          return [...dbItems, ...localOnly];
        });
        setSynced(true);
      })
      .catch(() => {});
  }, [status, synced]);

  // Save to localStorage whenever items change
  useEffect(() => {
    try {
      localStorage.setItem('tulsi-wishlist', JSON.stringify(items));
    } catch { /* ignore */ }
  }, [items]);

  const toggle = useCallback((product) => {
    const pid = getId(product);
    setItems((prev) => {
      const alreadyIn = prev.some((i) => getId(i) === pid);
      if (status === 'authenticated' && pid) {
        if (alreadyIn) {
          fetch(`/api/wishlist?productId=${pid}`, { method: 'DELETE' }).catch(() => {});
        } else {
          fetch('/api/wishlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: pid }),
          }).catch(() => {});
        }
      }
      return alreadyIn
        ? prev.filter((i) => getId(i) !== pid)
        : [...prev, { ...product, id: pid, _id: pid }];
    });
  }, [status]);

  const isWishlisted = useCallback((id) => {
    return items.some((i) => getId(i) === id);
  }, [items]);

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((i) => getId(i) !== id));
    if (status === 'authenticated' && id) {
      fetch(`/api/wishlist?productId=${id}`, { method: 'DELETE' }).catch(() => {});
    }
  }, [status]);

  return (
    <WishlistContext.Provider value={{ items, toggle, isWishlisted, remove }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}
