'use client';

import { createContext, useContext, useReducer, useEffect, useState, useCallback, useRef } from 'react';
import { DEFAULT_CHARGES, computeCharges } from '@/lib/storeCharges';
import { track } from '@/lib/analytics/tracker';
import { shownCouponDiscount, couponShortfall } from '@/components/checkout/checkoutRules';

/* How often an open page re-reads the shipping/COD settings, so an admin
   change reaches checkouts already in progress (the server recalculates
   every order regardless). Also refreshed when the tab regains focus. */
const CHARGES_REFRESH_MS = 60_000;

const CartContext = createContext(null);

/* coupon — what /api/coupons/validate returned ({ id, code, type, value,
   minOrderAmount, maxDiscount, firstOrderOnly }, plus checkedFor: the
   account it was checked for, null when signed out). The discount shown is
   always recomputed from it and the CURRENT subtotal (couponDiscountFor);
   `discount`/`discountAt` only keep the server's own figure for the
   subtotal it was given at (the coupon check, or a 409 COUPON_CHANGED). */
const initialState = { items: [], coupon: null, discount: 0, discountAt: null };
const NO_COUPON = { coupon: null, discount: 0, discountAt: null };

const subtotalOf = (items) => (items || []).reduce((sum, i) => sum + (i.discountPrice || i.price) * i.quantity, 0);

/* ADD_ITEM may carry `qty` (the product page's quantity picker); default 1.
   No upper cap here — the picker is bounded by stock and the order API
   checks it; only the analytics event is capped (its schema allows 99). */
const addQty = (action) => Math.max(1, Math.round(Number(action.qty) || 1));

function cartReducer(state, action) {
  switch (action.type) {
    case 'ADD_ITEM': {
      const pid = action.payload._id || action.payload.id;
      const add = addQty(action);
      const existing = state.items.find((i) => (i._id || i.id) === pid);
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            (i._id || i.id) === pid ? { ...i, quantity: i.quantity + add } : i
          ),
        };
      }
      // Normalize: always set _id so downstream code (cart page, checkout) works reliably
      return { ...state, items: [...state.items, { ...action.payload, _id: pid, quantity: add }] };
    }
    case 'REMOVE_ITEM': {
      const items = state.items.filter((i) => (i._id || i.id) !== action.payload);
      /* An empty bag keeps no coupon. */
      return items.length ? { ...state, items } : { ...state, items, ...NO_COUPON };
    }
    case 'UPDATE_QUANTITY':
      return {
        ...state,
        items: state.items.map((i) =>
          (i._id || i.id) === action.payload.id ? { ...i, quantity: action.payload.quantity } : i
        ),
      };
    case 'APPLY_COUPON': {
      /* Never into an empty bag — e.g. a coupon check answering after the
         order was placed and the cart cleared. */
      if (!state.items.length || !action.payload?.coupon) return state;
      const d = Number(action.payload.discount);
      const pinned = action.payload.discount !== undefined && action.payload.discount !== null && Number.isFinite(d);
      return { ...state, coupon: action.payload.coupon, discount: pinned ? d : 0, discountAt: pinned ? subtotalOf(state.items) : null };
    }
    case 'REMOVE_COUPON':
      return { ...state, ...NO_COUPON };
    case 'CLEAR_CART':
      return initialState;
    case 'HYDRATE': {
      const items = (action.payload.items || []).map((i) => {
        const pid = i._id || i.id;
        return { ...i, _id: pid };
      });
      const restored = { ...initialState, ...action.payload, items };
      return items.length ? restored : { ...restored, ...NO_COUPON };
    }
    default:
      return state;
  }
}

/* Cart actions → visitor-analytics events (add to cart / remove). */
function trackCartAction(action, items) {
  const idOf = (i) => String(i?._id || i?.id || '');
  if (action.type === 'ADD_ITEM') {
    track('add_to_cart', { productId: idOf(action.payload), qty: Math.min(99, addQty(action)) });
  } else if (action.type === 'REMOVE_ITEM') {
    track('remove_from_cart', { productId: String(action.payload || '') });
  } else if (action.type === 'UPDATE_QUANTITY') {
    const cur = items.find((i) => idOf(i) === action.payload?.id);
    const diff = Math.round(Number(action.payload?.quantity) || 0) - (cur?.quantity || 0);
    if (diff > 0) track('add_to_cart', { productId: String(action.payload.id), qty: Math.min(99, diff) });
    else if (diff < 0) track('remove_from_cart', { productId: String(action.payload.id), qty: Math.min(99, -diff) });
  }
}

export function CartProvider({ children }) {
  const [state, rawDispatch] = useReducer(cartReducer, initialState);
  const itemsRef = useRef(state.items);
  useEffect(() => { itemsRef.current = state.items; }, [state.items]);
  const dispatch = useCallback((action) => {
    try { trackCartAction(action, itemsRef.current); } catch { /* analytics never blocks the cart */ }
    rawDispatch(action);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('tulsi-cart');
    if (saved) {
      try {
        rawDispatch({ type: 'HYDRATE', payload: JSON.parse(saved) });
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

  const subtotal = subtotalOf(state.items);
  /* From the coupon and today's subtotal — never a figure frozen at the
     quantity it was applied at. 0 below the coupon's minimum. */
  const discount = shownCouponDiscount(state.coupon, subtotal, state.discountAt === null || state.discountAt === undefined ? null : { subtotal: state.discountAt, discount: state.discount });
  const couponShort = couponShortfall(state.coupon, subtotal);
  const { shipping: shippingCost } = computeCharges({ subtotal, paymentMethod: null, charges });
  const total = subtotal - discount + shippingCost;
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ ...state, discount, couponShortfall: couponShort, dispatch, subtotal, shippingCost, total, itemCount, charges, refreshCharges }}>
      {children}
    </CartContext.Provider>
  );
}

/* For tests. */
export { cartReducer };

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
