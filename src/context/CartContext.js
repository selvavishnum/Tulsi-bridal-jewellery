'use client';

import { createContext, useContext, useReducer, useEffect, useState, useCallback } from 'react';
import { DEFAULT_CHARGES, computeCharges } from '@/lib/storeCharges';

/* How often an open page re-reads the shipping/COD settings, so an admin
   change reaches checkouts already in progress (the server recalculates
   every order regardless). Also refreshed when the tab regains focus. */
const CHARGES_REFRESH_MS = 60_000;

const CartContext = createContext(null);

const initialState = { items: [], coupon: null, discount: 0 };

function cartReducer(state, action) {
  switch (action.type) {
    case 'ADD_ITEM': {
      const pid = action.payload._id || action.payload.id;
      const existing = state.items.find((i) => (i._id || i.id) === pid);
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            (i._id || i.id) === pid ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      // Normalize: always set _id so downstream code (cart page, checkout) works reliably
      return { ...state, items: [...state.items, { ...action.payload, _id: pid, quantity: 1 }] };
    }
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter((i) => (i._id || i.id) !== action.payload) };
    case 'UPDATE_QUANTITY':
      return {
        ...state,
        items: state.items.map((i) =>
          (i._id || i.id) === action.payload.id ? { ...i, quantity: action.payload.quantity } : i
        ),
      };
    case 'APPLY_COUPON':
      return { ...state, coupon: action.payload.coupon, discount: action.payload.discount };
    case 'REMOVE_COUPON':
      return { ...state, coupon: null, discount: 0 };
    case 'CLEAR_CART':
      return initialState;
    case 'HYDRATE': {
      const items = (action.payload.items || []).map((i) => {
        const pid = i._id || i.id;
        return { ...i, _id: pid };
      });
      return { ...action.payload, items };
    }
    default:
      return state;
  }
}

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(cartReducer, initialState);

  useEffect(() => {
    const saved = localStorage.getItem('tulsi-cart');
    if (saved) {
      try {
        dispatch({ type: 'HYDRATE', payload: JSON.parse(saved) });
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('tulsi-cart', JSON.stringify(state));
  }, [state]);

  /* Shipping & COD settings from the admin panel (settings/store_settings). */
  const [charges, setCharges] = useState(DEFAULT_CHARGES);
  const refreshCharges = useCallback(async () => {
    try {
      const res = await fetch('/api/store-charges', { cache: 'no-store' });
      const d = await res.json();
      if (d.success) setCharges(d.data);
      return d.success ? d.data : null;
    } catch {
      return null; // keep the last known charges; the server decides anyway
    }
  }, []);
  useEffect(() => {
    refreshCharges();
    const tick = setInterval(() => { if (document.visibilityState === 'visible') refreshCharges(); }, CHARGES_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshCharges(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [refreshCharges]);

  const subtotal = state.items.reduce((sum, i) => sum + (i.discountPrice || i.price) * i.quantity, 0);
  const { shipping: shippingCost } = computeCharges({ subtotal, paymentMethod: null, charges });
  const total = subtotal - state.discount + shippingCost;
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ ...state, dispatch, subtotal, shippingCost, total, itemCount, charges, refreshCharges }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
