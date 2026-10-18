/* ─────────────────────────────────────────────
   Checkout fixes from the CRO review — the shopper's side
   (src/components/checkout/**, CartContext, /cart, /checkout):

   • A  a coupon checked while signed out is re-checked at /checkout; the
        order sends the discount shown and handles 409 COUPON_CHANGED
   • B / BN-3  closing Razorpay and retrying pays the SAME order; anything
        changed → the unpaid order is cancelled first (or, if it turned out
        paid, the confirmation page)
   • BN-1  after an order is placed, Place order stays locked
   • C / BN-2  the coupon discount follows the current subtotal (minimum,
        cap) — 0 below the minimum, with a note
   • D  a kept code isn't re-checked on every open (same basket, 10 min)
   • E  tapping the welcome code on an open page applies it
   • F  /cart: an applied coupon can be removed (forgetting the
        remembered code) or replaced
   • G  Place order is held while the auto-apply check is in flight; a late
        answer never writes into an emptied cart

   Same harness as tests/buy-now-checkout.test.mjs: files transpiled with
   sucrase, a tiny hook runner, stubbed fetch / router / session / toasts.
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  couponDiscountFor, shownCouponDiscount, couponShortfall, minimumFromMessage, checkoutAmounts,
} from '../src/components/checkout/checkoutRules.js';
import { couponDiscountFor as libCouponDiscountFor } from '../src/lib/coupons.js';
import { DEFAULT_CHARGES } from '../src/lib/storeCharges.js';

const require = createRequire(import.meta.url);
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the checkout hooks/components cannot be transpiled for node --test';

const SRC = path.resolve('src');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const REAL = new Set(['react', 'react/jsx-runtime', 'react-dom/server']);
function makeLoader(stubs) {
  const cache = new Map();
  const aliasOf = (file) => `@/${path.relative(SRC, file).replace(/\\/g, '/').replace(/\.(jsx?|mjs)$/, '')}`;
  function resolveLocal(from, id) {
    let base;
    if (id.startsWith('@/')) base = path.join(SRC, id.slice(2));
    else if (id.startsWith('.')) base = path.resolve(path.dirname(from), id);
    else return null;
    const hit = [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')].find(isFile);
    if (!hit) throw new Error(`cannot resolve ${id} from ${from}`);
    return hit;
  }
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const { code } = sucrase.transform(readFileSync(file, 'utf8'), {
      transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file,
    });
    const mod = { exports: {} };
    cache.set(file, mod);
    const req = (id) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      const local = resolveLocal(file, id);
      if (local) return Object.hasOwn(stubs, aliasOf(local)) ? stubs[aliasOf(local)] : load(local);
      if (REAL.has(id)) return require(id);
      throw new Error(`${path.relative(SRC, file)} imports ${id}: add a stub for it in this test`);
    };
    vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, req, mod);
    return mod.exports;
  }
  return (rel) => load(path.join(SRC, rel));
}
const esm = (value) => ({ __esModule: true, default: value });

/* ── Browser-ish stubs: storage, and window events (the offer bar's tap) ── */
const local = new Map();
const tab = new Map();
const listeners = new Map();
const storage = (m) => ({
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => { m.set(k, String(v)); },
  removeItem: (k) => { m.delete(k); },
});
globalThis.window = {
  localStorage: storage(local),
  sessionStorage: storage(tab),
  addEventListener: (t, f) => { (listeners.get(t) || listeners.set(t, new Set()).get(t)).add(f); },
  removeEventListener: (t, f) => { listeners.get(t)?.delete(f); },
};
const tapWelcomeCode = (code) => {
  local.set('tj-pending-coupon', JSON.stringify({ code, at: Date.now() }));
  for (const f of listeners.get('tj:pending-coupon') || []) f({ type: 'tj:pending-coupon', detail: { code } });
};
const remember = (code) => local.set('tj-pending-coupon', JSON.stringify({ code, at: Date.now() }));
const pending = () => { try { return JSON.parse(local.get('tj-pending-coupon')).code; } catch { return null; } };
const ATTEMPT_KEY = 'tj-pending-coupon-attempt';

const sessionState = { data: null, status: 'loading' };
const router = { push: mock.fn(), replace: mock.fn() };
const cart = { charges: { ...DEFAULT_CHARGES }, refreshCharges: mock.fn(async () => null) };
const toast = Object.assign(mock.fn(), { error: mock.fn(), success: mock.fn() });
const loadRazorpayScript = mock.fn(async () => {});

/* fetch answering by METHOD + path: keys are 'GET /api/x' or '/api/x'
   (any method); the longest matching key wins. */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url).split('?')[0];
    const method = init.method || 'GET';
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : undefined });
    const key = Object.keys(routes)
      .filter((k) => { const [m, p] = k.includes(' ') ? k.split(' ') : [null, k]; return (!m || m === method) && (u === p || u.startsWith(`${p}/`)); })
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`unexpected fetch ${method} ${u}`);
    let r = routes[key];
    if (typeof r === 'function') r = await r(u, init);
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, json: async () => { if (r.json === undefined) throw new SyntaxError('Unexpected token <'); return r.json; } };
  };
  return calls;
}
const tick = async (n = 15) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

/* ── Tiny hook runner ── */
let currentHook = null;
const fakeReact = {
  useState: (init) => currentHook.useState(init),
  useRef: (init) => currentHook.useRef(init),
  useEffect: (fn, deps) => currentHook.useEffect(fn, deps),
  useId: () => ':t:',
};
function renderHook(hookFn, initialProps) {
  const slots = [];
  const effects = [];
  let cursor = 0; let eCursor = 0; let queued = []; let rendering = false; let dirty = false; let scheduled = false;
  const h = { props: initialProps, result: undefined };
  const self = {
    useState(init) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = { value: typeof init === 'function' ? init() : init };
        slot.set = (v) => {
          const next = typeof v === 'function' ? v(slot.value) : v;
          if (Object.is(next, slot.value)) return;
          slot.value = next;
          if (rendering) dirty = true; else schedule();
        };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(init) { const i = cursor++; if (!slots[i]) slots[i] = { ref: { current: init } }; return slots[i].ref; },
    useEffect(fn, deps) {
      const i = eCursor++;
      const prev = effects[i];
      if (prev && deps && prev.deps && deps.length === prev.deps.length && deps.every((d, k) => Object.is(d, prev.deps[k]))) return;
      queued.push(() => { prev?.cleanup?.(); const c = fn(); effects[i] = { deps, cleanup: typeof c === 'function' ? c : null }; });
    },
  };
  function render() {
    let passes = 0;
    do {
      dirty = false; cursor = 0; eCursor = 0; queued = [];
      rendering = true; currentHook = self;
      try { h.result = hookFn(h.props); } finally { rendering = false; currentHook = null; }
      if (++passes > 25) throw new Error('Too many re-renders');
    } while (dirty);
    const run = queued; queued = [];
    for (const f of run) f();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; render(); });
  }
  h.rerender = (props) => { if (props) h.props = { ...h.props, ...props }; render(); };
  h.unmount = () => { for (const e of effects) e?.cleanup?.(); };
  render();
  return h;
}

const hookStubs = {
  react: fakeReact,
  'next/navigation': { useRouter: () => router },
  'next-auth/react': { useSession: () => sessionState },
  'react-hot-toast': esm(toast),
  '@/context/CartContext': { useCart: () => cart },
  '@/lib/loadRazorpay': { loadRazorpayScript },
};
const loadHooks = sucrase ? makeLoader(hookStubs) : null;
const useCheckoutFlow = sucrase ? loadHooks('components/checkout/useCheckoutFlow.js').default : null;
const autoApplyModule = sucrase ? loadHooks('components/checkout/useAutoApplyPendingCoupon.js') : null;
const useAutoApplyPendingCoupon = autoApplyModule?.default;
const useCouponRecheck = sucrase ? loadHooks('components/checkout/useCouponRecheck.js').default : null;
/* The reducer, with React's hooks stubbed out (it is a pure function). */
const cartReducer = sucrase ? makeLoader({
  react: { createContext: () => ({}), useContext() {}, useReducer() {}, useEffect() {}, useState() {}, useCallback() {}, useRef() {} },
  '@/lib/analytics/tracker': { track() {} },
})('context/CartContext.js').cartReducer : null;

const ASHA = { user: { id: 'u1', name: 'Asha', email: 'asha@example.com' } };
const SITE = { json: { success: true, data: { onlinePaymentEnabled: true, loyaltyEnabled: false } } };
function resetStubs() {
  local.clear(); tab.clear(); listeners.clear();
  sessionState.data = ASHA; sessionState.status = 'authenticated';
  router.push.mock.resetCalls(); router.replace.mock.resetCalls();
  cart.charges = { ...DEFAULT_CHARGES };
  cart.refreshCharges.mock.resetCalls();
  toast.mock.resetCalls(); toast.error.mock.resetCalls(); toast.success.mock.resetCalls();
  delete globalThis.window.Razorpay;
}
function flowFor(props = {}, routes = {}) {
  const calls = stubFetch({ '/api/admin/settings': SITE, '/api/user/address': { json: { success: true, data: [] } }, ...routes });
  const notify = mock.fn();
  const onOrderPlaced = mock.fn();
  const onCouponChanged = mock.fn();
  const h = renderHook((p) => useCheckoutFlow(p), {
    lines: [{ product: 'p1', quantity: 1 }], subtotal: 1500, discount: 0, notify, onOrderPlaced, onCouponChanged, ...props,
  });
  return { h, calls, notify, onOrderPlaced, onCouponChanged };
}
async function fillValid(h) {
  h.result.updateForm('phone', '9876543210');
  h.result.updateForm('street', '12 Temple St');
  h.result.updateForm('city', 'Nagercoil');
  h.result.updateForm('state', 'Tamil Nadu');
  h.result.updateForm('pincode', '629001');
  await tick();
}
const posts = (calls) => calls.filter((c) => c.url === '/api/orders' && c.method === 'POST');
const placed = (data) => ({ status: 201, json: { success: true, data } });
function stubRazorpay() {
  const seen = { options: null, opened: 0, all: [] };
  globalThis.window.Razorpay = class {
    constructor(options) { seen.options = options; seen.all.push(options); }
    on() {}
    open() { seen.opened += 1; }
  };
  return seen;
}
const RZP = (id = 'order_rzp1') => ({ json: { success: true, data: { id, amount: 144900, currency: 'INR' } } });

/* ═════════════ C / BN-2: the discount follows the subtotal ═════════════ */

describe('coupon discount on the current subtotal', () => {
  const PCT = { code: 'TULSI10', type: 'percentage', value: 10, minOrderAmount: 0 };
  const BIG = { code: 'BIGFIRST', type: 'fixed', value: 500, minOrderAmount: 5000 };

  test('checkoutRules uses THE formula from src/lib/coupons.js (minimum, cap)', () => {
    assert.equal(couponDiscountFor, libCouponDiscountFor);
    assert.equal(couponDiscountFor(BIG, 6000), 500);
    assert.equal(couponDiscountFor(BIG, 4500), 0, 'below the minimum: nothing');
    assert.equal(couponDiscountFor({ ...PCT, maxDiscount: 500 }, 150000), 500, 'capped');
  });

  test('a figure the server gave holds only for its own subtotal', () => {
    assert.equal(shownCouponDiscount(PCT, 4500, { subtotal: 4500, discount: 400 }), 400);
    assert.equal(shownCouponDiscount(PCT, 1500, { subtotal: 4500, discount: 400 }), 150, 'quantity changed → the formula');
    assert.equal(shownCouponDiscount(PCT, 1500, null), 150);
    assert.equal(shownCouponDiscount(null, 1500, { subtotal: 1500, discount: 150 }), 0);
    assert.equal(shownCouponDiscount(PCT, 1500, { subtotal: 1500, discount: 9999 }), 1500, 'never more than the order');
  });

  test('shortfall below the minimum; the minimum read from the server message', () => {
    assert.equal(couponShortfall(BIG, 4500), 500);
    assert.equal(couponShortfall(BIG, 5000), 0);
    assert.equal(couponShortfall(null, 10), 0);
    assert.equal(minimumFromMessage('Minimum order amount is ₹5000'), 5000);
    assert.equal(minimumFromMessage('Minimum order amount is ₹1,999'), 1999);
    assert.equal(minimumFromMessage('Coupon has expired'), 0);
  });
});

describe('cart reducer', { skip }, () => {
  const PIECE = { _id: 'p1', price: 2000, discountPrice: 1500 };
  const withItems = (qty) => ({ items: [{ ...PIECE, quantity: qty }], coupon: null, discount: 0, discountAt: null });
  const TULSI10 = { id: 'c1', code: 'TULSI10', type: 'percentage', value: 10, minOrderAmount: 0, firstOrderOnly: true };
  const subtotal = (s) => s.items.reduce((t, i) => t + (i.discountPrice || i.price) * i.quantity, 0);
  const shown = (s) => shownCouponDiscount(s.coupon, subtotal(s), s.discountAt === null ? null : { subtotal: s.discountAt, discount: s.discount });

  test('the discount is recomputed after a quantity change (finding C: 3 → 1 piece)', () => {
    let s = cartReducer(withItems(3), { type: 'APPLY_COUPON', payload: { coupon: TULSI10, discount: 450 } });
    assert.equal(shown(s), 450);
    s = cartReducer(s, { type: 'UPDATE_QUANTITY', payload: { id: 'p1', quantity: 1 } });
    assert.equal(shown(s), 150, 'not the ₹450 frozen at 3 pieces');
    const amounts = checkoutAmounts({ subtotal: subtotal(s), discount: shown(s), paymentMethod: 'cod', charges: DEFAULT_CHARGES });
    assert.equal(amounts.payableTotal, 1500 - 150 + amounts.shippingCost + amounts.codFee);
  });

  test('below a minimum: ₹0 (finding C2 / BN-2)', () => {
    const WELCOME5K = { ...TULSI10, code: 'WELCOME5K', minOrderAmount: 5000 };
    let s = cartReducer(withItems(4), { type: 'APPLY_COUPON', payload: { coupon: WELCOME5K, discount: 600 } });
    s = cartReducer(s, { type: 'UPDATE_QUANTITY', payload: { id: 'p1', quantity: 2 } });
    assert.equal(shown(s), 0);
    assert.equal(couponShortfall(s.coupon, subtotal(s)), 2000);
  });

  test('never into an empty cart; an emptied cart drops its coupon', () => {
    const empty = { items: [], coupon: null, discount: 0, discountAt: null };
    assert.equal(cartReducer(empty, { type: 'APPLY_COUPON', payload: { coupon: TULSI10, discount: 150 } }), empty);
    let s = cartReducer(withItems(1), { type: 'APPLY_COUPON', payload: { coupon: TULSI10, discount: 150 } });
    s = cartReducer(s, { type: 'REMOVE_ITEM', payload: 'p1' });
    assert.equal(s.coupon, null);
    const hydrated = cartReducer(empty, { type: 'HYDRATE', payload: { items: [], coupon: TULSI10, discount: 150 } });
    assert.equal(hydrated.coupon, null, 'a saved phantom coupon on an empty cart is dropped');
    const old = cartReducer(empty, { type: 'HYDRATE', payload: { items: [{ ...PIECE, quantity: 2 }], coupon: TULSI10, discount: 450 } });
    assert.equal(shown(old), 300, 'a cart saved before this change: recomputed, not the stored ₹450');
  });
});

/* ═════════════ useCheckoutFlow ═════════════ */

describe('useCheckoutFlow: what is charged is what was shown', { skip }, () => {
  beforeEach(resetStubs);

  test('BN-1: after a COD order the flow stays placed — a second tap sends nothing', async () => {
    const { h, calls } = flowFor({}, { '/api/orders': placed({ id: 'o1', orderNumber: 'TBJ1', total: 1648 }) });
    await tick();
    await fillValid(h);
    h.result.setPaymentMethod('cod');
    await tick();
    await h.result.placeOrder();
    await tick();
    assert.equal(h.result.placed, true);
    await h.result.placeOrder();
    await tick();
    assert.equal(posts(calls).length, 1);
    assert.equal(router.push.mock.callCount(), 1);
  });

  test('BN-1: two submits in the same tick send one order', async () => {
    const { h, calls } = flowFor({}, { '/api/orders': async () => { await new Promise((r) => setTimeout(r, 10)); return placed({ id: 'o1', orderNumber: 'TBJ1' }); } });
    await tick();
    await fillValid(h);
    h.result.setPaymentMethod('cod');
    await tick();
    const place = h.result.placeOrder;
    await Promise.all([place(), place()]);
    assert.equal(posts(calls).length, 1);
  });

  test('A: the coupon discount shown is sent; without a coupon nothing extra', async () => {
    const withCoupon = flowFor({ couponCode: 'TULSI10', discount: 150 }, { '/api/orders': placed({ id: 'o1', orderNumber: 'TBJ1' }) });
    await tick();
    await fillValid(withCoupon.h);
    withCoupon.h.result.setPaymentMethod('cod');
    await tick();
    await withCoupon.h.result.placeOrder();
    assert.equal(posts(withCoupon.calls)[0].body.couponDiscount, 150);

    resetStubs();
    const none = flowFor({}, { '/api/orders': placed({ id: 'o1', orderNumber: 'TBJ1' }) });
    await tick();
    await fillValid(none.h);
    none.h.result.setPaymentMethod('cod');
    await tick();
    await none.h.result.placeOrder();
    assert.equal('couponDiscount' in posts(none.calls)[0].body, false);
  });

  test('A: 409 COUPON_CHANGED (refused) → coupon removed by the caller, code forgotten, customer told, nothing placed', async () => {
    remember('TULSI10');
    const message = 'TULSI10 is for your first order only, so it has been removed. Your total is now ₹1,648 — please place the order again.';
    const { h, notify, onOrderPlaced, onCouponChanged } = flowFor({ couponCode: 'TULSI10', discount: 150 }, {
      '/api/orders': { status: 409, json: { success: false, code: 'COUPON_CHANGED', couponApplied: false, discount: 0, reason: 'first_order_only', message } },
    });
    await tick();
    await fillValid(h);
    h.result.setPaymentMethod('cod');
    await tick();
    await h.result.placeOrder();
    await tick();
    assert.deepEqual(onCouponChanged.mock.calls.map((c) => c.arguments[0]), [{ code: 'TULSI10', couponApplied: false, discount: 0, reason: 'first_order_only' }]);
    assert.deepEqual(notify.mock.calls.map((c) => c.arguments), [['info', message, { icon: 'ℹ️', duration: 10000 }]]);
    assert.equal(pending(), null);
    assert.equal(onOrderPlaced.mock.callCount(), 0);
    assert.equal(router.push.mock.callCount(), 0);
    assert.equal(h.result.loading, false);
    assert.equal(h.result.placed, false, 'free to confirm the new total');
  });

  test('A: 409 COUPON_CHANGED below the minimum keeps the remembered code; a new figure is passed on', async () => {
    remember('WELCOME5K');
    const min = flowFor({ couponCode: 'WELCOME5K', discount: 500 }, {
      '/api/orders': { status: 409, json: { success: false, code: 'COUPON_CHANGED', couponApplied: false, discount: 0, reason: 'min_order', message: 'Minimum order not met' } },
    });
    await tick();
    await fillValid(min.h);
    await min.h.result.placeOrder();
    assert.equal(pending(), 'WELCOME5K');

    resetStubs();
    const capped = flowFor({ couponCode: 'TULSI10', discount: 15000 }, {
      '/api/orders': { status: 409, json: { success: false, code: 'COUPON_CHANGED', couponApplied: true, discount: 500, reason: 'max_discount' } },
    });
    await tick();
    await fillValid(capped.h);
    await capped.h.result.placeOrder();
    assert.equal(capped.onCouponChanged.mock.calls[0].arguments[0].discount, 500);
    assert.match(capped.notify.mock.calls[0].arguments[1], /now saves ₹500/);
  });

  test('B/BN-3: Razorpay closed, Place order again → the same order is paid (no second order)', async () => {
    const rzp = stubRazorpay();
    let n = 0;
    const { h, calls } = flowFor({ couponCode: 'TULSI10', discount: 150 }, {
      '/api/orders': () => { n += 1; return placed({ id: `o${n}`, orderNumber: `TBJ${n}`, total: 1449 }); },
      '/api/payments/create-order': () => RZP(`order_rzp${calls.length}`),
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    rzp.options.modal.ondismiss();
    await tick();
    assert.equal(h.result.loading, false);
    await h.result.placeOrder();
    await tick();
    assert.equal(posts(calls).length, 1, 'one order');
    assert.deepEqual(calls.filter((c) => c.url === '/api/payments/create-order').map((c) => c.body), [{ orderId: 'o1' }, { orderId: 'o1' }]);
    assert.equal(rzp.opened, 2);
    assert.equal(calls.some((c) => c.method === 'PUT'), false, 'nothing cancelled');
  });

  test('B: switching to COD after closing Razorpay cancels the unpaid order first, then places the new one', async () => {
    const rzp = stubRazorpay();
    let n = 0;
    const { h, calls, onOrderPlaced } = flowFor({ couponCode: 'TULSI10', discount: 150 }, {
      'POST /api/orders': () => { n += 1; return placed({ id: `o${n}`, orderNumber: `TBJ${n}`, total: 1449 }); },
      'GET /api/orders': { json: { success: true, data: { id: 'o1', status: 'pending', payment: { method: 'razorpay', status: 'pending' } } } },
      'PUT /api/orders': { json: { success: true, data: { id: 'o1', status: 'cancelled' } } },
      '/api/payments/create-order': RZP(),
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    rzp.options.modal.ondismiss();
    h.result.setPaymentMethod('cod');
    await tick();
    await h.result.placeOrder();
    await tick();
    const seq = calls.filter((c) => c.url.startsWith('/api/orders')).map((c) => `${c.method} ${c.url}`);
    assert.deepEqual(seq, ['POST /api/orders', 'GET /api/orders/o1', 'PUT /api/orders/o1', 'POST /api/orders']);
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { status: 'cancelled' });
    assert.equal(posts(calls)[1].body.payment.method, 'cod');
    assert.equal(posts(calls)[1].body.couponCode, 'TULSI10', 'the coupon the cancel gave back is used again');
    assert.equal(onOrderPlaced.mock.callCount(), 1);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ2&email=asha%40example.com']);
  });

  test('B: changing the address (or the amount) also replaces the unpaid order', async () => {
    const rzp = stubRazorpay();
    let n = 0;
    const { h, calls } = flowFor({}, {
      'POST /api/orders': () => { n += 1; return placed({ id: `o${n}`, orderNumber: `TBJ${n}`, total: 1599 }); },
      'GET /api/orders': { json: { success: true, data: { status: 'pending', payment: { status: 'pending' } } } },
      'PUT /api/orders': { json: { success: true, data: {} } },
      '/api/payments/create-order': RZP(),
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    rzp.options.modal.ondismiss();
    h.result.updateForm('street', '14 Temple St');
    await tick();
    await h.result.placeOrder();
    await tick();
    assert.equal(posts(calls).length, 2);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 1);

    /* The charges changed under the same order: the old total no longer matches the button. */
    rzp.all[1].modal.ondismiss();
    cart.charges = { ...DEFAULT_CHARGES, shipping_fee_amount: 149 };
    h.rerender();
    await tick();
    await h.result.placeOrder();
    await tick();
    assert.equal(posts(calls).length, 3);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 2);
  });

  test('B: the earlier attempt turned out paid (late UPI) → never cancelled, its confirmation page instead', async () => {
    remember('TULSI10');
    const rzp = stubRazorpay();
    const { h, calls, onOrderPlaced } = flowFor({ couponCode: 'TULSI10', discount: 150 }, {
      'POST /api/orders': placed({ id: 'o1', orderNumber: 'TBJ1', total: 1449 }),
      'GET /api/orders': { json: { success: true, data: { status: 'confirmed', payment: { method: 'razorpay', status: 'paid' } } } },
      'PUT /api/orders': () => assert.fail('a paid order is never cancelled'),
      '/api/payments/create-order': RZP(),
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    rzp.options.modal.ondismiss();
    h.result.setPaymentMethod('cod');
    await tick();
    await h.result.placeOrder();
    await tick();
    assert.equal(posts(calls).length, 1);
    assert.equal(onOrderPlaced.mock.callCount(), 1);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ1&email=asha%40example.com']);
    assert.equal(pending(), null, 'the paid order used the code');
    assert.equal(h.result.placed, true);
  });

  test('B: the cancel is refused because it was paid in between → confirmation page; can’t tell → nothing new is placed', async () => {
    const rzp = stubRazorpay();
    let reads = 0;
    const { h, calls } = flowFor({}, {
      'POST /api/orders': placed({ id: 'o1', orderNumber: 'TBJ1', total: 1599 }),
      'GET /api/orders': () => { reads += 1; return { json: { success: true, data: { status: reads === 1 ? 'pending' : 'confirmed', payment: { status: reads === 1 ? 'pending' : 'paid' } } } }; },
      'PUT /api/orders': { status: 400, json: { success: false, message: 'Order cannot be cancelled — it is already confirmed' } },
      '/api/payments/create-order': RZP(),
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    rzp.options.modal.ondismiss();
    h.result.setPaymentMethod('cod');
    await tick();
    await h.result.placeOrder();
    await tick();
    assert.equal(posts(calls).length, 1);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ1&email=asha%40example.com']);

    resetStubs();
    const rzp2 = stubRazorpay();
    const offline = flowFor({}, {
      'POST /api/orders': placed({ id: 'o1', orderNumber: 'TBJ1', total: 1599 }),
      'GET /api/orders': new TypeError('Failed to fetch'),
      'PUT /api/orders': new TypeError('Failed to fetch'),
      '/api/payments/create-order': RZP(),
    });
    await tick();
    await fillValid(offline.h);
    await offline.h.result.placeOrder();
    rzp2.options.modal.ondismiss();
    offline.h.result.setPaymentMethod('cod');
    await tick();
    await offline.h.result.placeOrder();
    await tick();
    assert.equal(posts(offline.calls).length, 1, 'no second order while the first may still hold the coupon');
    assert.match(offline.notify.mock.calls.at(-1).arguments[1], /earlier payment attempt/);
    assert.equal(offline.h.result.loading, false);
  });

  test('B: retrying an order that was paid meanwhile (create-order refuses) → its confirmation page', async () => {
    const rzp = stubRazorpay();
    let pays = 0;
    const { h, calls } = flowFor({}, {
      'POST /api/orders': placed({ id: 'o1', orderNumber: 'TBJ1', total: 1599 }),
      'GET /api/orders': { json: { success: true, data: { status: 'confirmed', payment: { status: 'paid' } } } },
      '/api/payments/create-order': () => { pays += 1; return pays === 1 ? RZP() : { status: 400, json: { success: false, message: 'Order is already paid' } }; },
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    rzp.options.modal.ondismiss();
    await h.result.placeOrder();
    await tick();
    assert.equal(posts(calls).length, 1);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ1&email=asha%40example.com']);
  });

  test('B: the cancel answers ALREADY_PAID (Razorpay has the money, the webhook hasn’t landed) → confirmation page', async () => {
    const rzp = stubRazorpay();
    const { h, calls } = flowFor({}, {
      'POST /api/orders': placed({ id: 'o1', orderNumber: 'TBJ1', total: 1599 }),
      'GET /api/orders': { json: { success: true, data: { status: 'pending', payment: { status: 'pending' } } } },
      'PUT /api/orders': { status: 409, json: { success: false, code: 'ALREADY_PAID', message: 'Your payment for this order has just come through.' } },
      '/api/payments/create-order': RZP(),
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    rzp.options.modal.ondismiss();
    h.result.setPaymentMethod('cod');
    await tick();
    await h.result.placeOrder();
    await tick();
    assert.equal(posts(calls).length, 1);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ1&email=asha%40example.com']);
  });

  test('B: create-order answers ALREADY_PAID on the retry → confirmation page, no new window', async () => {
    const rzp = stubRazorpay();
    let pays = 0;
    const { h, calls } = flowFor({}, {
      'POST /api/orders': placed({ id: 'o1', orderNumber: 'TBJ1', total: 1599 }),
      '/api/payments/create-order': () => { pays += 1; return pays === 1 ? RZP() : { status: 409, json: { success: false, code: 'ALREADY_PAID', message: 'We have received the payment for this order.' } }; },
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    rzp.options.modal.ondismiss();
    await h.result.placeOrder();
    await tick();
    assert.equal(rzp.opened, 1);
    assert.equal(posts(calls).length, 1);
    assert.equal(h.result.placed, true);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ1&email=asha%40example.com']);
  });

  test('A: COUPON_CHANGED "couldn’t check it just now" leaves the coupon on and the remembered code kept', async () => {
    remember('TULSI10');
    const { h, notify, onCouponChanged } = flowFor({ couponCode: 'TULSI10', discount: 150 }, {
      '/api/orders': { status: 409, json: { success: false, code: 'COUPON_CHANGED', couponApplied: false, discount: 0, reason: 'check_failed', message: 'We couldn’t check TULSI10 just now. Please try again.' } },
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    assert.equal(onCouponChanged.mock.callCount(), 0);
    assert.equal(pending(), 'TULSI10');
    assert.match(notify.mock.calls[0].arguments[1], /try again/);
  });

  test('B: a paid order clears the kept attempt; the closed window never cancels anything', async () => {
    const rzp = stubRazorpay();
    const { h, calls } = flowFor({}, {
      'POST /api/orders': placed({ id: 'o1', orderNumber: 'TBJ1', total: 1599 }),
      '/api/payments/create-order': RZP(),
      '/api/payments/verify': { json: { success: true } },
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    rzp.options.modal.ondismiss();
    await tick();
    assert.equal(calls.some((c) => c.method === 'PUT' || (c.method === 'GET' && c.url.startsWith('/api/orders'))), false);
    await h.result.placeOrder();
    await rzp.options.handler({ razorpay_order_id: 'order_rzp1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    await tick();
    assert.equal(h.result.placed, true);
    assert.equal(posts(calls).length, 1);
    assert.equal(router.push.mock.callCount(), 1);
  });
});

/* ═════════════ useAutoApplyPendingCoupon ═════════════ */

describe('useAutoApplyPendingCoupon: G, E, D', { skip }, () => {
  beforeEach(resetStubs);
  const OK = { json: { success: true, data: { coupon: { id: 'c1', code: 'TULSI10', type: 'percentage', value: 10, minOrderAmount: 0, firstOrderOnly: true }, discount: 150 } } };
  const MIN = { status: 400, json: { success: false, message: 'Minimum order amount is ₹5000' } };
  function auto(props, route) {
    const calls = stubFetch({ '/api/coupons/validate': route });
    const cbs = { onApplied: mock.fn(), onRejected: mock.fn(), onUnavailable: mock.fn(), onKept: mock.fn() };
    const h = renderHook((p) => useAutoApplyPendingCoupon(p), { enabled: true, hasCoupon: false, orderAmount: 1500, ...cbs, ...props });
    return { h, calls, ...cbs };
  }

  test('G: `checking` while the check is in flight; a late answer after the order was placed is ignored', async () => {
    remember('TULSI10');
    let release;
    const { h, onApplied } = auto({}, () => new Promise((r) => { release = () => r(OK); }));
    await tick();
    assert.equal(h.result.checking, true);
    h.rerender({ enabled: false }); // the order was placed / the cart emptied
    release();
    await tick();
    assert.equal(h.result.checking, false);
    assert.equal(onApplied.mock.callCount(), 0);
  });

  test('G: an answer after unmount is ignored', async () => {
    remember('TULSI10');
    let release;
    const { h, onApplied } = auto({}, () => new Promise((r) => { release = () => r(OK); }));
    await tick();
    h.unmount();
    release();
    await tick();
    assert.equal(onApplied.mock.callCount(), 0);
  });

  test('accepted: onApplied gets the subtotal it was checked at', async () => {
    remember('TULSI10');
    const { onApplied } = auto({}, OK);
    await tick();
    assert.equal(onApplied.mock.calls[0].arguments[0].orderAmount, 1500);
  });

  test('E: tapping the welcome code while the page is open applies it', async () => {
    const { h, calls, onApplied } = auto({}, OK);
    await tick();
    assert.equal(calls.length, 0, 'nothing remembered yet');
    tapWelcomeCode('TULSI10');
    await tick();
    assert.deepEqual(calls.map((c) => c.body), [{ code: 'TULSI10', orderAmount: 1500 }]);
    assert.equal(onApplied.mock.callCount(), 1);
    h.unmount();
    assert.equal(listeners.get('tj:pending-coupon')?.size || 0, 0, 'listener removed on unmount');
  });

  test('D: a code kept below its minimum is not re-checked on the next open for the same basket', async () => {
    remember('WELCOME5K');
    const first = auto({}, MIN);
    await tick();
    assert.equal(first.calls.length, 1);
    assert.equal(first.onRejected.mock.callCount(), 1);
    assert.equal(pending(), 'WELCOME5K');

    const again = auto({}, MIN); // /checkout after /cart, or the drawer
    await tick();
    assert.equal(again.calls.length, 0, 'no request');
    assert.equal(again.onRejected.mock.callCount(), 0, 'no repeat toast');
    assert.deepEqual(again.onKept.mock.calls.map((c) => c.arguments), [['WELCOME5K']]);

    again.h.rerender({ orderAmount: 3000 }); // still below ₹5,000
    await tick();
    assert.equal(again.calls.length, 0);
    stubFetch({ '/api/coupons/validate': OK });
    again.h.rerender({ orderAmount: 6000 }); // reaches the minimum
    await tick();
    assert.equal(again.onApplied.mock.callCount(), 1);
  });

  test('D: offline / rate-limited: retried only for a new subtotal, or after 10 minutes; at most once per mount', async () => {
    remember('TULSI10');
    const offline = auto({}, new TypeError('Failed to fetch'));
    await tick();
    assert.equal(offline.onUnavailable.mock.callCount(), 1);
    offline.h.rerender({ orderAmount: 1600 });
    await tick();
    assert.equal(offline.calls.length, 1, 'once per mount');

    const same = auto({}, OK);
    await tick();
    assert.equal(same.calls.length, 0);

    const bigger = auto({ orderAmount: 2000 }, OK);
    await tick();
    assert.equal(bigger.calls.length, 1);

    /* Ten minutes later, same basket. */
    tab.set(ATTEMPT_KEY, JSON.stringify({ code: 'TULSI10', orderAmount: 1500, minOrder: 0, at: Date.now() - 11 * 60_000 }));
    const later = auto({}, OK);
    await tick();
    assert.equal(later.calls.length, 1);
  });

  test('D: a tap on the offer bar checks right away, whatever was tried before', async () => {
    remember('WELCOME5K');
    tab.set(ATTEMPT_KEY, JSON.stringify({ code: 'WELCOME5K', orderAmount: 1500, minOrder: 5000, at: Date.now() }));
    const { calls } = auto({}, MIN);
    await tick();
    assert.equal(calls.length, 0);
    tapWelcomeCode('WELCOME5K');
    await tick();
    assert.equal(calls.length, 1);
  });

  test('the attempt memory never breaks the hook (keptAttemptStillHolds)', () => {
    const { keptAttemptStillHolds, KEPT_RETRY_MS } = autoApplyModule;
    const now = 1_000_000_000;
    const a = { code: 'X10', orderAmount: 1500, minOrder: 0, at: now };
    assert.equal(keptAttemptStillHolds(a, 'X10', 1500, now + 1000), true);
    assert.equal(keptAttemptStillHolds(a, 'X10', 1501, now + 1000), false);
    assert.equal(keptAttemptStillHolds(a, 'Y10', 1500, now), false);
    assert.equal(keptAttemptStillHolds(a, 'X10', 1500, now + KEPT_RETRY_MS), false);
    assert.equal(keptAttemptStillHolds({ ...a, minOrder: 5000 }, 'X10', 4999, now), true);
    assert.equal(keptAttemptStillHolds({ ...a, minOrder: 5000 }, 'X10', 5000, now), false);
    assert.equal(keptAttemptStillHolds(null, 'X10', 1500, now), false);
  });
});

describe('useCouponRecheck (A)', { skip }, () => {
  beforeEach(resetStubs);

  test('checks the code once, holds meanwhile, and a definite refusal forgets the remembered code', async () => {
    remember('TULSI10');
    let release;
    const calls = stubFetch({ '/api/coupons/validate': () => new Promise((r) => { release = () => r({ status: 400, json: { success: false, code: 'FIRST_ORDER_ONLY', message: 'This code is for your first order only.' } }); }) });
    const onResult = mock.fn();
    const h = renderHook((p) => useCouponRecheck(p), { code: 'TULSI10', orderAmount: 1500, onResult });
    await tick();
    assert.equal(h.result.checking, true);
    release();
    await tick();
    assert.equal(h.result.checking, false);
    assert.equal(onResult.mock.calls[0].arguments[0].definite, true);
    assert.equal(pending(), null);
    h.rerender({ orderAmount: 3000 });
    await tick();
    assert.equal(calls.length, 1, 'once per code');
    h.rerender({ code: null });
    await tick();
    assert.equal(calls.length, 1);
  });
});

/* ═════════════ The pages, composed as they are wired ═════════════ */

describe('/checkout composition (G + A)', { skip }, () => {
  beforeEach(resetStubs);

  test('G: Place order is held while the welcome code is checked; the late answer never lands in the emptied cart', async () => {
    remember('TULSI10');
    let release;
    const calls = stubFetch({
      '/api/admin/settings': SITE,
      '/api/loyalty': { json: { success: true, data: { points: 0 } } },
      '/api/user/address': { json: { success: true, data: [{ fullName: 'Asha', phone: '9876543210', street: '1 St', city: 'C', state: 'TN', pincode: '629001' }] } },
      '/api/coupons/validate': () => new Promise((r) => { release = () => r({ json: { success: true, data: { coupon: { id: 'c', code: 'TULSI10', type: 'percentage', value: 10 }, discount: 150 } } }); }),
      '/api/orders': placed({ id: 'o1', orderNumber: 'TBJ1' }),
    });
    let state = { items: [{ _id: 'p1', price: 1500, quantity: 1 }], coupon: null, discount: 0, discountAt: null };
    const dispatch = (a) => { state = cartReducer(state, a); };
    const page = renderHook(() => {
      const flow = useCheckoutFlow({
        lines: state.items.map((i) => ({ product: i._id, quantity: i.quantity })), subtotal: 1500, discount: 0, couponCode: state.coupon?.code,
        withLoyalty: true, onOrderPlaced: () => dispatch({ type: 'CLEAR_CART' }),
      });
      const autoApply = useAutoApplyPendingCoupon({
        enabled: flow.status === 'authenticated' && state.items.length > 0 && !flow.placed,
        hasCoupon: !!state.coupon, orderAmount: 1500,
        onApplied: (r) => dispatch({ type: 'APPLY_COUPON', payload: { coupon: r.coupon, discount: r.discount } }),
      });
      return { flow, checking: autoApply.checking };
    }, {});
    await tick();
    page.rerender();
    page.result.flow.setPaymentMethod('cod');
    await tick();
    assert.equal(page.result.checking, true, 'the button is disabled (and the submit held) meanwhile');

    /* Even if an order goes through anyway (the hook alone, no hold): */
    await page.result.flow.placeOrder();
    await tick();
    assert.equal(state.items.length, 0);
    release();
    await tick();
    assert.equal(state.coupon, null, 'no phantom coupon in the emptied cart');
    assert.equal(toast.success.mock.callCount(), 0);
    assert.equal(calls.filter((c) => c.url === '/api/orders').length, 1);
  });
});

describe('/checkout page, driven as a hook (A)', { skip }, () => {
  beforeEach(resetStubs);
  let state;
  const dispatch = mock.fn((a) => { state = cartReducer(state, a); });
  const useCart = () => {
    const subtotal = state.items.reduce((t, i) => t + (i.discountPrice || i.price) * i.quantity, 0);
    const pin = state.discountAt === null || state.discountAt === undefined ? null : { subtotal: state.discountAt, discount: state.discount };
    return {
      ...state, subtotal, dispatch, charges: cart.charges, refreshCharges: cart.refreshCharges,
      discount: shownCouponDiscount(state.coupon, subtotal, pin), couponShortfall: couponShortfall(state.coupon, subtotal),
    };
  };
  const loadPage = sucrase ? makeLoader({ ...hookStubs, '@/context/CartContext': { useCart }, '@/lib/analytics/tracker': { track() {} } }) : null;
  const CheckoutPage = sucrase ? loadPage('app/checkout/page.js').default : null;
  /* The page's one submit button, from the element tree it returned. */
  function submitButton(el) {
    if (!el || typeof el !== 'object') return null;
    if (Array.isArray(el)) { for (const c of el) { const b = submitButton(c); if (b) return b; } return null; }
    if (el.type === 'button' && el.props?.type === 'submit') return el;
    return submitButton(el.props?.children);
  }
  const label = (el) => (typeof el === 'string' ? el : Array.isArray(el) ? el.map(label).join('') : el?.props ? label(el.props.children) : '').trim();
  const FIRST = { id: 'c1', code: 'TULSI10', type: 'percentage', value: 10, minOrderAmount: 0, firstOrderOnly: true };

  test('a first-order code applied while signed out is re-checked once signed in; refused → removed before any order, Place order held meanwhile', async () => {
    remember('TULSI10');
    state = { items: [{ _id: 'p1', name: 'Jhumka', price: 2000, discountPrice: 1500, quantity: 1 }], coupon: { ...FIRST, checkedFor: null }, discount: 150, discountAt: 1500 };
    let release;
    const calls = stubFetch({
      '/api/admin/settings': SITE, '/api/loyalty': { json: { success: true, data: { points: 0 } } }, '/api/user/address': { json: { success: true, data: [] } },
      '/api/coupons/validate': () => new Promise((r) => { release = () => r({ status: 400, json: { success: false, code: 'FIRST_ORDER_ONLY', message: 'This code is for your first order only.' } }); }),
    });
    const page = renderHook(() => CheckoutPage(), {});
    await tick();
    page.rerender();
    let btn = submitButton(page.result);
    assert.equal(btn.props.disabled, true, 'held while the code is checked');
    assert.match(label(btn), /Checking your coupon/);
    assert.deepEqual(calls.filter((c) => c.url === '/api/coupons/validate').map((c) => c.body), [{ code: 'TULSI10', orderAmount: 1500 }]);

    release();
    await tick();
    page.rerender();
    await tick();
    assert.equal(state.coupon, null);
    assert.deepEqual(toast.error.mock.calls.map((c) => c.arguments[0]), ['TULSI10: This code is for your first order only.']);
    assert.equal(pending(), null);
    btn = submitButton(page.result);
    assert.equal(btn.props.disabled, false);
    assert.equal(label(btn), 'Place Order · ₹1,599', 'the full price, before any order exists');
    assert.equal(calls.some((c) => c.url === '/api/orders'), false);
  });

  test('accepted for this customer → kept (marked as checked for them); one already checked for them → no request', async () => {
    state = { items: [{ _id: 'p1', name: 'Jhumka', price: 2000, discountPrice: 1500, quantity: 1 }], coupon: { ...FIRST, checkedFor: null }, discount: 150, discountAt: 1500 };
    const calls = stubFetch({
      '/api/admin/settings': SITE, '/api/loyalty': { json: { success: true, data: { points: 0 } } }, '/api/user/address': { json: { success: true, data: [] } },
      '/api/coupons/validate': { json: { success: true, data: { coupon: FIRST, discount: 150, firstOrderOnly: true } } },
    });
    const page = renderHook(() => CheckoutPage(), {});
    await tick();
    page.rerender();
    await tick();
    assert.equal(state.coupon.checkedFor, 'u1');
    assert.equal(label(submitButton(page.result)), 'Place Order · ₹1,449');
    page.rerender();
    await tick();
    assert.equal(calls.filter((c) => c.url === '/api/coupons/validate').length, 1);
  });

  test('409 COUPON_CHANGED at Place order: the page takes the coupon off and shows the new total', async () => {
    remember('TULSI10');
    state = { items: [{ _id: 'p1', name: 'Jhumka', price: 2000, discountPrice: 1500, quantity: 1 }], coupon: { ...FIRST, checkedFor: 'u1' }, discount: 150, discountAt: 1500 };
    const calls = stubFetch({
      '/api/admin/settings': SITE, '/api/loyalty': { json: { success: true, data: { points: 0 } } },
      '/api/user/address': { json: { success: true, data: [{ fullName: 'Asha', phone: '9876543210', street: '1 St', city: 'C', state: 'TN', pincode: '629001' }] } },
      '/api/orders': { status: 409, json: { success: false, code: 'COUPON_CHANGED', couponApplied: false, discount: 0, reason: 'first_order_only', message: 'This code is for your first order only. Please check your total and place the order again.' } },
    });
    const page = renderHook(() => CheckoutPage(), {});
    await tick();
    page.rerender();
    assert.equal(label(submitButton(page.result)), 'Place Order · ₹1,449');
    const form = (function find(el) { if (!el || typeof el !== 'object') return null; if (Array.isArray(el)) { for (const c of el) { const f = find(c); if (f) return f; } return null; } if (el.type === 'form') return el; return find(el.props?.children); })(page.result);
    await form.props.onSubmit({ preventDefault() {} });
    await tick();
    page.rerender();
    assert.equal(calls.filter((c) => c.url === '/api/orders')[0].body.couponDiscount, 150);
    assert.equal(state.coupon, null);
    assert.equal(pending(), null);
    assert.equal(label(submitButton(page.result)), 'Place Order · ₹1,599');
    assert.equal(router.push.mock.callCount(), 0);
  });
});

describe('rendered pages', { skip }, () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const icon = (name) => {
    const Icon = (props) => React.createElement('svg', { 'data-icon': name, 'aria-hidden': props['aria-hidden'], className: props.className });
    Icon.displayName = name;
    return Icon;
  };
  const icons = new Proxy({}, { get: (_, name) => (typeof name === 'string' && /^Fi/.test(name) ? icon(name) : undefined), has: () => true });
  const Img = ({ src, alt, fill: _f, unoptimized: _u, sizes, priority: _p, ...rest }) => React.createElement('img', { src, alt, sizes, ...rest });
  const Link = ({ href, children, prefetch: _prefetch, ...rest }) => React.createElement('a', { href, ...rest }, children);
  const cartState = {};
  const load = sucrase ? makeLoader({
    'next/navigation': { useRouter: () => router },
    'next-auth/react': { useSession: () => sessionState },
    'react-hot-toast': esm(toast),
    'next/image': esm(Img),
    'next/link': esm(Link),
    'react-icons/fi': icons,
    '@/context/CartContext': { useCart: () => cartState },
    '@/lib/loadRazorpay': { loadRazorpayScript },
    '@/lib/analytics/tracker': { track: () => {} },
  }) : null;
  const CartPage = sucrase ? load('app/cart/page.js').default : null;
  const CheckoutPage = sucrase ? load('app/checkout/page.js').default : null;
  const BuyNowDrawer = sucrase ? load('components/checkout/BuyNowDrawer.jsx').default : null;
  const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
  function render(el) {
    const warnings = [];
    const orig = console.error;
    console.error = (...args) => { warnings.push(args.map(String).join(' ')); };
    let html;
    try { html = renderToStaticMarkup(el); } finally { console.error = orig; }
    assert.deepEqual(warnings, [], 'React warned while rendering');
    return html;
  }
  const ITEM = { _id: 'p1', name: 'Lakshmi Temple Choker', price: 1200, discountPrice: 950, quantity: 2 };
  const setCart = (over) => {
    for (const k of Object.keys(cartState)) delete cartState[k];
    Object.assign(cartState, {
      charges: { ...DEFAULT_CHARGES }, refreshCharges: async () => null, dispatch: () => {},
      items: [ITEM], subtotal: 1900, shippingCost: 99, coupon: null, discount: 0, couponShortfall: 0, total: 1999, ...over,
    });
  };
  beforeEach(() => { resetStubs(); setCart(); });

  test('F: /cart shows an applied coupon with Remove, and the code box stays usable to replace it', () => {
    setCart({ coupon: { code: 'TULSI10', type: 'percentage', value: 10 }, discount: 190, total: 1809 });
    const html = render(React.createElement(CartPage));
    const t = text(html);
    assert.match(t, /✓ Coupon “TULSI10” applied — saving ₹190/);
    assert.match(t, /Remove/);
    assert.match(html, /placeholder="Have another code\?"/);
    assert.match(t, /Total ₹1,809/);
  });

  test('C: /cart, /checkout and the drawer say what a coupon needs below its minimum', () => {
    setCart({ coupon: { code: 'WELCOME5K', type: 'percentage', value: 10, minOrderAmount: 5000 }, discount: 0, couponShortfall: 3100 });
    assert.match(text(render(React.createElement(CartPage))), /Add ₹3,100 more to use “WELCOME5K”/);
    const checkout = text(render(React.createElement(CheckoutPage)));
    assert.match(checkout, /Add ₹3,100 more to use WELCOME5K/);
    assert.doesNotMatch(checkout, /Discount/);
    assert.match(checkout, /Place Order · ₹1,999/);
  });

  test('/checkout shows the discount from the cart (its current subtotal) and the matching total', () => {
    setCart({ coupon: { code: 'TULSI10', type: 'percentage', value: 10 }, discount: 190 });
    const t = text(render(React.createElement(CheckoutPage)));
    assert.match(t, /Discount \(TULSI10\) -₹190/);
    assert.match(t, /Place Order · ₹1,809/);
  });

  test('the drawer still renders its one Place order button', () => {
    const PIECE = { id: 'p1', _id: 'p1', name: 'Lakshmi Temple Choker', price: 1200, discountPrice: 950, stock: 3, images: [] };
    const t = text(render(React.createElement(BuyNowDrawer, { open: true, onClose: () => {}, product: PIECE, qty: 1 })));
    assert.match(t, /Place order · ₹1,049/);
  });
});
