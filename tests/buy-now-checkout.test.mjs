/* ─────────────────────────────────────────────
   Buy Now drawer + the checkout flow it shares with /checkout
   (src/components/checkout/*).

   • checkoutRules / validateCoupon — plain imports.
   • useCheckoutFlow / useAutoApplyPendingCoupon — run for real with a
     tiny hook runner (useState/useEffect/useRef, render-phase updates,
     effects after each render) and stubbed fetch, router, session, cart,
     Razorpay and toasts: every request, message and redirect of the order
     flow is checked.
   • BuyNowDrawer and the /checkout page — rendered to static HTML with the
     real React + react-dom/server.

   The hooks and components are transpiled with sucrase (already in
   node_modules via tailwindcss) and loaded with their imports wired by
   hand. If sucrase is ever missing those tests are skipped (with that
   reason), never silently green.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  COD_MAX_ORDER_VALUE, PHONE_RE, checkoutAmounts, correctedPaymentMethod, fillFromAddress, unitPriceOf,
  maxOrderQty, clampQty, couponDiscountFor, isDefiniteCouponRejection, orderSuccessPath, buyNowSignInUrl,
  normalizeMobileInput,
} from '../src/components/checkout/checkoutRules.js';
import { validateCoupon } from '../src/components/checkout/validateCoupon.js';
import { DEFAULT_CHARGES, computeCharges } from '../src/lib/storeCharges.js';
import { safeLocalPath } from '../src/lib/postLoginRedirect.js';

const require = createRequire(import.meta.url);
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the checkout hooks/components cannot be transpiled for node --test';

const SRC = path.resolve('src');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/* ── Loader: transpile src files on demand, imports from `stubs` first ── */
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

/* ── Shared browser-ish stubs ── */
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  },
};
const PENDING_KEY = 'tj-pending-coupon';
const remember = (code) => store.set(PENDING_KEY, JSON.stringify({ code, at: Date.now() }));
const pending = () => { try { return JSON.parse(store.get(PENDING_KEY)).code; } catch { return null; } };

const sessionState = { data: null, status: 'loading' };
const router = { push: mock.fn(), replace: mock.fn() };
const cart = { charges: { ...DEFAULT_CHARGES }, refreshCharges: mock.fn(async () => null) };
const toast = Object.assign(mock.fn(), { error: mock.fn(), success: mock.fn() });
const loadRazorpayScript = mock.fn(async () => {});

/* A fetch that answers by path (query ignored). A route is
   { status?, json } | Error (network failure) | (url, init) => either. */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    const key = Object.keys(routes).find((k) => u === k || u.split('?')[0] === k || u.startsWith(k));
    if (!key) throw new Error(`unexpected fetch ${u}`);
    let r = routes[key];
    if (typeof r === 'function') r = await r(u, init);
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, json: async () => { if (r.json === undefined) throw new SyntaxError('Unexpected token <'); return r.json; } };
  };
  return calls;
}
const tick = async (n = 12) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

/* ── A tiny hook runner (no DOM) ── */
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
  let cursor = 0;
  let eCursor = 0;
  let queued = [];
  let rendering = false;
  let dirty = false;
  let scheduled = false;
  const h = { props: initialProps, result: undefined, renders: 0 };
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
    useRef(init) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { ref: { current: init } };
      return slots[i].ref;
    },
    useEffect(fn, deps) {
      const i = eCursor++;
      const prev = effects[i];
      if (prev && deps && prev.deps && deps.length === prev.deps.length && deps.every((d, k) => Object.is(d, prev.deps[k]))) return;
      queued.push(() => {
        prev?.cleanup?.();
        const c = fn();
        effects[i] = { deps, cleanup: typeof c === 'function' ? c : null };
      });
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
    h.renders += 1;
    const run = queued; queued = [];
    for (const f of run) f();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; render(); });
  }
  h.rerender = (props) => { if (props) h.props = { ...h.props, ...props }; render(); };
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
const useAutoApplyPendingCoupon = sucrase ? loadHooks('components/checkout/useAutoApplyPendingCoupon.js').default : null;

const ASHA = { user: { id: 'u1', name: 'Asha', email: 'asha@example.com' } };
const ADDR = [
  { id: 'a1', fullName: 'Asha K', phone: '9876543210', street: '12 Temple St', city: 'Nagercoil', state: 'Tamil Nadu', pincode: '629001' },
  { id: 'a2', fullName: 'Asha (work)', phone: '9123456780', street: '5 Beach Rd', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
];
const SITE = (over = {}) => ({ json: { success: true, data: { onlinePaymentEnabled: true, loyaltyEnabled: false, ...over } } });

function resetStubs() {
  store.clear();
  sessionState.data = ASHA; sessionState.status = 'authenticated';
  router.push.mock.resetCalls(); router.replace.mock.resetCalls();
  cart.charges = { ...DEFAULT_CHARGES };
  cart.refreshCharges.mock.resetCalls();
  toast.mock.resetCalls(); toast.error.mock.resetCalls(); toast.success.mock.resetCalls();
  loadRazorpayScript.mock.resetCalls();
  delete globalThis.window.Razorpay;
}

/* The flow for a one-piece order, with saved addresses off unless given. */
function flowFor(props = {}, routes = {}) {
  const calls = stubFetch({ '/api/admin/settings': SITE(), '/api/user/address': { json: { success: true, data: [] } }, ...routes });
  const notify = mock.fn();
  const onOrderPlaced = mock.fn();
  const h = renderHook((p) => useCheckoutFlow(p), {
    lines: [{ product: 'p1', quantity: 1 }], subtotal: 1500, discount: 0, notify, onOrderPlaced, ...props,
  });
  return { h, calls, notify, onOrderPlaced };
}
async function fillValid(h) {
  h.result.updateForm('phone', '9876543210');
  h.result.updateForm('street', '12 Temple St');
  h.result.updateForm('city', 'Nagercoil');
  h.result.updateForm('state', 'Tamil Nadu');
  h.result.updateForm('pincode', '629001');
  await tick();
}
const ordersCalls = (calls) => calls.filter((c) => c.url === '/api/orders');
const placed = (status, data) => ({ status, json: { success: true, data } });

/* Razorpay double: records options, lets a test fire its callbacks. */
function stubRazorpay() {
  const seen = { options: null, opened: 0, failed: null };
  globalThis.window.Razorpay = class {
    constructor(options) { seen.options = options; }
    on(event, cb) { if (event === 'payment.failed') seen.failed = cb; }
    open() { seen.opened += 1; }
  };
  return seen;
}

/* ═════════════ Pure rules ═════════════ */

test('amounts: same totals, COD fee and COD limit as the checkout page always showed', () => {
  const c = { ...DEFAULT_CHARGES }; // ₹99 shipping under ₹2000; ₹49 COD fee under ₹500
  const small = checkoutAmounts({ subtotal: 400, discount: 0, paymentMethod: 'cod', charges: c });
  assert.deepEqual(small, { shippingCost: 99, total: 499, codFee: 49, codFeeIfSelected: 49, codBlockedByValue: false, codBlocked: false, payableTotal: 548 });
  const online = checkoutAmounts({ subtotal: 400, paymentMethod: 'razorpay', charges: c });
  assert.equal(online.codFee, 0);
  assert.equal(online.codFeeIfSelected, 49, 'the COD option still says what COD would cost');
  assert.equal(online.payableTotal, 499);
  const big = checkoutAmounts({ subtotal: 2500, discount: 250, paymentMethod: 'razorpay', charges: c });
  assert.equal(big.shippingCost, 0, 'free above the threshold');
  assert.equal(big.total, 2250);
  /* The server's rule (round 4): (subtotal − coupon + shipping + COD fee)
     over ₹20,000 blocks COD — points don't count. */
  assert.equal(checkoutAmounts({ subtotal: 20500, discount: 0, paymentMethod: 'cod', charges: c }).codBlockedByValue, true);
  assert.equal(checkoutAmounts({ subtotal: 20500, discount: 0, loyaltyDiscount: 600, paymentMethod: 'cod', charges: c }).codBlockedByValue, true, 'points don’t lift the limit');
  assert.equal(checkoutAmounts({ subtotal: 20500, discount: 600, paymentMethod: 'cod', charges: c }).codBlockedByValue, false);
  assert.equal(checkoutAmounts({ subtotal: 1000, paymentMethod: 'cod', charges: c, codAvailable: false }).codBlocked, true);
  assert.equal(COD_MAX_ORDER_VALUE, 20000);
  /* Matches the shared server rule exactly. */
  for (const subtotal of [0, 1, 499, 500, 1999, 2000, 5000]) {
    for (const m of ['cod', 'razorpay']) {
      const a = checkoutAmounts({ subtotal, paymentMethod: m, charges: c });
      const s = computeCharges({ subtotal, paymentMethod: m, charges: c });
      assert.equal(a.shippingCost, s.shipping);
      assert.equal(a.codFee, s.codFee);
    }
  }
});

test('payment method: a disabled option never stays selected', () => {
  assert.equal(correctedPaymentMethod('cod', { codBlocked: true, onlinePaymentEnabled: true }), 'razorpay');
  assert.equal(correctedPaymentMethod('cod', { codBlocked: true, onlinePaymentEnabled: false }), 'cod', 'nothing better to switch to');
  assert.equal(correctedPaymentMethod('razorpay', { codBlocked: false, onlinePaymentEnabled: false }), 'cod');
  assert.equal(correctedPaymentMethod('razorpay', { codBlocked: true, onlinePaymentEnabled: true }), 'razorpay');
  assert.equal(correctedPaymentMethod('cod', { codBlocked: false, onlinePaymentEnabled: true }), 'cod');
});

test('phone: 10-digit Indian mobile; autofilled +91 / 0 prefixes dropped, typing never cut', () => {
  assert.ok(PHONE_RE.test('9876543210'));
  assert.ok(!PHONE_RE.test('5876543210'));
  assert.ok(!PHONE_RE.test('987654321'));
  assert.equal(normalizeMobileInput('98765 43210'), '9876543210');
  assert.equal(normalizeMobileInput('+91 98765 43210'), '9876543210');
  assert.equal(normalizeMobileInput('+91-98765-43210'), '9876543210');
  assert.equal(normalizeMobileInput('098765 43210'), '9876543210');
  assert.equal(normalizeMobileInput('0091 98765 43210'), '9876543210');
  assert.equal(normalizeMobileInput('91987'), '91987', 'a number starting 91 being typed is left alone');
  assert.equal(normalizeMobileInput('9198765432'), '9198765432');
  assert.equal(normalizeMobileInput('91987654321'), '9198765432', 'an 11th digit typed is dropped, as maxLength=10 did');
  assert.equal(normalizeMobileInput(''), '');
  assert.equal(normalizeMobileInput(undefined), '');
});

test('product: price, how many can be ordered, quantity bounds', () => {
  assert.equal(unitPriceOf({ price: 5000, discountPrice: 4200 }), 4200);
  assert.equal(unitPriceOf({ price: 5000, discountPrice: 0 }), 5000);
  assert.equal(unitPriceOf({ price: '3500' }), 3500);
  assert.equal(maxOrderQty({ stock: 3 }), 3);
  assert.equal(maxOrderQty({ stock: 0 }), 0);
  assert.equal(maxOrderQty({}), 0, 'no stock figure = not orderable (the server agrees)');
  assert.equal(maxOrderQty({ stock: 5000 }), 999);
  assert.equal(clampQty(5, 2), 2);
  assert.equal(clampQty(0, 2), 1);
  assert.equal(clampQty('3', 9), 3);
  assert.equal(clampQty(undefined, 9), 1);
  assert.equal(clampQty(4, 0), 1);
});

test('coupon discount: same formula as /api/coupons/validate and /api/orders', () => {
  assert.equal(couponDiscountFor({ type: 'percentage', value: 10 }, 4995), 500);
  assert.equal(couponDiscountFor({ type: 'percentage', value: 10 }, 4994), 499);
  assert.equal(couponDiscountFor({ type: 'fixed', value: 300 }, 1000), 300);
  assert.equal(couponDiscountFor({ type: 'fixed', value: 3000 }, 1000), 1000, 'never more than the order');
  assert.equal(couponDiscountFor(null, 1000), 0);
});

test('a refused coupon is forgotten only when the refusal is about the code', () => {
  assert.equal(isDefiniteCouponRejection(400, 'Coupon has expired'), true);
  assert.equal(isDefiniteCouponRejection(400, 'This code is for your first order only.'), true);
  assert.equal(isDefiniteCouponRejection(404, 'Invalid coupon code'), true);
  assert.equal(isDefiniteCouponRejection(400, 'Minimum order amount is ₹1999'), false, 'a bigger order can still use it');
  for (const s of [0, 401, 429, 500, 502]) assert.equal(isDefiniteCouponRejection(s, 'x'), false);
});

test('links: order confirmation, and sign-in that comes back to the drawer', () => {
  assert.equal(orderSuccessPath('TBJ1', 'a+b@x.in'), '/order-success?orderNumber=TBJ1&email=a%2Bb%40x.in');
  const url = buyNowSignInUrl('p1', 2);
  assert.equal(url, '/login?callbackUrl=%2Fproduct%2Fp1%3Fbuynow%3D2');
  /* What the login page does with it: read the param, keep it if local. */
  const back = new URL(url, 'https://tulsijewels.in').searchParams.get('callbackUrl');
  assert.equal(safeLocalPath(back, null, 'https://tulsijewels.in'), '/product/p1?buynow=2');
  assert.equal(buyNowSignInUrl('p1', 0), '/login?callbackUrl=%2Fproduct%2Fp1%3Fbuynow%3D1');
});

test('saved address fills the address fields, keeping name/phone when the address has none', () => {
  const prev = { fullName: 'Asha', phone: '9000000000', email: 'a@x.in', street: '', city: '', state: '', pincode: '' };
  assert.deepEqual(fillFromAddress(prev, ADDR[0]), { ...prev, fullName: 'Asha K', phone: '9876543210', street: '12 Temple St', city: 'Nagercoil', state: 'Tamil Nadu', pincode: '629001' });
  assert.equal(fillFromAddress(prev, { ...ADDR[0], fullName: '', phone: '' }).phone, '9000000000');
});

/* ═════════════ validateCoupon ═════════════ */

describe('validateCoupon', () => {
  const answer = (status, json) => async () => ({ status, json: async () => { if (json === undefined) throw new SyntaxError('html'); return json; } });

  test('accepted: coupon, discount and the first-order flag', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push([url, JSON.parse(init.body)]); return answer(200, { success: true, data: { coupon: { id: 'c1', code: 'TULSI10', type: 'percentage', value: 10, firstOrderOnly: true }, discount: 420, firstOrderOnly: true } })(); };
    const r = await validateCoupon(' tulsi10 ', 4200, { fetchImpl });
    assert.deepEqual(seen, [['/api/coupons/validate', { code: 'TULSI10', orderAmount: 4200 }]]);
    assert.deepEqual(r, { ok: true, code: 'TULSI10', coupon: { id: 'c1', code: 'TULSI10', type: 'percentage', value: 10, firstOrderOnly: true }, discount: 420, firstOrderOnly: true });
  });

  test('refused: the server’s reason; definite unless it is the minimum', async () => {
    const first = await validateCoupon('TULSI10', 4200, { fetchImpl: answer(400, { success: false, code: 'FIRST_ORDER_ONLY', message: 'This code is for your first order only.' }) });
    assert.deepEqual(first, { ok: false, code: 'TULSI10', refused: true, definite: true, status: 400, message: 'This code is for your first order only.' });
    const unknown = await validateCoupon('NOPE', 4200, { fetchImpl: answer(404, { success: false, message: 'Invalid coupon code' }) });
    assert.equal(unknown.definite, true);
    const min = await validateCoupon('TULSI10', 900, { fetchImpl: answer(400, { success: false, message: 'Minimum order amount is ₹1000' }) });
    assert.equal(min.refused, true);
    assert.equal(min.definite, false);
    assert.equal(min.message, 'Minimum order amount is ₹1000');
  });

  test('offline, rate-limited, server error, not JSON: never definite', async () => {
    const offline = await validateCoupon('TULSI10', 1, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    assert.equal(offline.ok, false); assert.equal(offline.refused, false); assert.equal(offline.definite, false);
    assert.match(offline.message, /connection/);
    const limited = await validateCoupon('TULSI10', 1, { fetchImpl: answer(429, { success: false, message: 'Too many coupon attempts. Please try again later.' }) });
    assert.equal(limited.definite, false); assert.equal(limited.refused, false);
    assert.equal(limited.message, 'Too many coupon attempts. Please try again later.');
    const html = await validateCoupon('TULSI10', 1, { fetchImpl: answer(502) });
    assert.equal(html.definite, false);
    assert.match(html.message, /try again/i);
    const empty = await validateCoupon('  ', 1, { fetchImpl: () => assert.fail('no request for an empty code') });
    assert.equal(empty.ok, false);
  });
});

/* ═════════════ useCheckoutFlow ═════════════ */

describe('useCheckoutFlow', { skip }, () => {
  beforeEach(resetStubs);

  test('signed in: name/email from the account, then the first saved address; switching addresses', async () => {
    const { h, calls } = flowFor({}, { '/api/user/address': { json: { success: true, data: ADDR } } });
    assert.equal(h.result.form.fullName, 'Asha');
    assert.equal(h.result.form.email, 'asha@example.com');
    await tick();
    assert.deepEqual(calls.map((c) => c.url).sort(), ['/api/admin/settings', '/api/user/address'], 'no loyalty call unless asked');
    assert.equal(h.result.addrChoice, 'saved-0');
    assert.equal(h.result.form.street, '12 Temple St');
    assert.equal(h.result.form.fullName, 'Asha K');
    assert.equal(loadRazorpayScript.mock.callCount(), 1, 'payment script preloaded');

    h.result.chooseAddress('saved-1');
    await tick();
    assert.equal(h.result.addrChoice, 'saved-1');
    assert.equal(h.result.form.city, 'Chennai');
    assert.equal(h.result.form.phone, '9123456780');

    h.result.chooseAddress('new');
    await tick();
    assert.equal(h.result.addrChoice, 'new');
    assert.deepEqual(
      { street: h.result.form.street, city: h.result.form.city, state: h.result.form.state, pincode: h.result.form.pincode, phone: h.result.form.phone },
      { street: '', city: '', state: '', pincode: '', phone: '' },
    );
    assert.equal(h.result.form.fullName, 'Asha (work)', 'name kept');
  });

  test('a session that arrives after the first render still fills name and email, never over typing', async () => {
    sessionState.data = null; sessionState.status = 'loading';
    const { h, calls } = flowFor();
    assert.equal(h.result.form.email, '');
    h.result.updateForm('fullName', 'Asha Kumari');
    await tick();
    sessionState.data = ASHA; sessionState.status = 'authenticated';
    h.rerender();
    await tick();
    assert.equal(h.result.form.fullName, 'Asha Kumari');
    assert.equal(h.result.form.email, 'asha@example.com');
    assert.ok(calls.some((c) => c.url === '/api/admin/settings'), 'settings loaded once signed in');
  });

  test('guest (not signed in): nothing account-specific is fetched', async () => {
    sessionState.data = null; sessionState.status = 'unauthenticated';
    const { calls } = flowFor();
    await tick();
    assert.deepEqual(calls, []);
  });

  test('preloadPayment: false skips loading Razorpay', async () => {
    flowFor({ preloadPayment: false });
    await tick();
    assert.equal(loadRazorpayScript.mock.callCount(), 0);
  });

  test('online payment switched off → Cash on Delivery is selected, and sent', async () => {
    const { h, calls } = flowFor({}, {
      '/api/admin/settings': SITE({ onlinePaymentEnabled: false }),
      '/api/orders': placed(201, { id: 'o1', orderNumber: 'TBJ1700000000000123' }),
    });
    assert.equal(h.result.paymentMethod, 'razorpay');
    await tick();
    assert.equal(h.result.onlinePaymentEnabled, false);
    assert.equal(h.result.paymentMethod, 'cod');
    await fillValid(h);
    await h.result.placeOrder();
    assert.deepEqual(ordersCalls(calls)[0].body.payment, { method: 'cod' });
  });

  test('COD over ₹20,000 can’t stay selected; the COD fee shows only for COD', async () => {
    const { h } = flowFor({ subtotal: 25000 });
    await tick();
    h.result.setPaymentMethod('cod');
    await tick();
    assert.equal(h.result.codBlockedByValue, true);
    assert.equal(h.result.paymentMethod, 'razorpay');

    const small = flowFor({ subtotal: 400 }).h;
    await tick();
    assert.equal(small.result.codFee, 0);
    assert.equal(small.result.codFeeIfSelected, 49);
    small.result.setPaymentMethod('cod');
    await tick();
    assert.equal(small.result.codFee, 49);
    assert.equal(small.result.payableTotal, 400 + 99 + 49);
  });

  test('pincode: city/state looked up, COD availability checked, a new pincode resets to available', async () => {
    const { h } = flowFor({}, {
      'https://api.postalpincode.in/pincode/': { json: [{ Status: 'Success', PostOffice: [{ District: 'Kanniyakumari', State: 'Tamil Nadu' }] }] },
      '/api/cod-availability': { json: { success: true, data: { available: false, checked: true } } },
    });
    await tick();
    h.result.setPaymentMethod('cod');
    await tick();
    await h.result.handlePincodeChange('629001');
    await tick();
    assert.equal(h.result.form.pincode, '629001');
    assert.equal(h.result.form.city, 'Kanniyakumari');
    assert.equal(h.result.form.state, 'Tamil Nadu');
    assert.equal(h.result.codAvailable, false);
    assert.equal(h.result.codBlocked, true);
    assert.equal(h.result.paymentMethod, 'razorpay', 'moved off COD');
    await h.result.handlePincodeChange('62900');
    await tick();
    assert.equal(h.result.codAvailable, true, 'optimistic until the new pincode is checked');
    assert.equal(h.result.paymentMethod, 'razorpay', 'the switch away from COD sticks (as on the page), it does not flip back');
  });

  test('nothing to order, or a bad phone: a message, no request', async () => {
    const empty = flowFor({ lines: [], emptyMessage: 'This piece is out of stock right now.' });
    await tick();
    await empty.h.result.placeOrder({ preventDefault() {} });
    assert.deepEqual(empty.notify.mock.calls.map((c) => c.arguments), [['error', 'This piece is out of stock right now.']]);

    const { h, calls, notify } = flowFor();
    await tick();
    h.result.updateForm('phone', '12345');
    await tick();
    await h.result.placeOrder({ preventDefault() {} });
    assert.deepEqual(notify.mock.calls.map((c) => c.arguments), [['error', 'Enter a valid 10-digit mobile number']]);
    assert.equal(ordersCalls(calls).length, 0);
    assert.equal(h.result.loading, false);
  });

  test('the default messages are toasts — the /checkout page’s behaviour', async () => {
    stubFetch({ '/api/admin/settings': SITE(), '/api/user/address': { json: { success: true, data: [] } } });
    const h = renderHook((p) => useCheckoutFlow(p), { lines: [], subtotal: 0 });
    await h.result.placeOrder({ preventDefault() {} });
    assert.deepEqual(toast.error.mock.calls.map((c) => c.arguments), [['Your cart is empty', undefined]]);
  });

  test('COD: sends only the lines, the fees and coupon discount shown, spends the welcome code, then the confirmation page', async () => {
    remember('TULSI10');
    const { h, calls, onOrderPlaced, notify } = flowFor(
      { lines: [{ product: 'p1', quantity: 2 }], subtotal: 400, discount: 40, couponCode: 'TULSI10' },
      { '/api/orders': placed(201, { id: 'o1', orderNumber: 'TBJ1700000000000123' }) },
    );
    await tick();
    await fillValid(h);
    h.result.setPaymentMethod('cod');
    await tick();
    let prevented = false;
    await h.result.placeOrder({ preventDefault() { prevented = true; } });
    assert.ok(prevented);
    const [order] = ordersCalls(calls);
    assert.equal(order.method, 'POST');
    assert.deepEqual(order.body, {
      items: [{ product: 'p1', quantity: 2 }],
      shippingAddress: { fullName: 'Asha', phone: '9876543210', email: 'asha@example.com', street: '12 Temple St', city: 'Nagercoil', state: 'Tamil Nadu', pincode: '629001' },
      payment: { method: 'cod' },
      couponCode: 'TULSI10',
      shippingCost: 99,
      codFee: 49,
      couponDiscount: 40, // the discount shown: the server answers 409 COUPON_CHANGED if its own differs
    });
    assert.equal(onOrderPlaced.mock.callCount(), 1);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments), [['/order-success?orderNumber=TBJ1700000000000123&email=asha%40example.com']]);
    assert.equal(pending(), null, 'the remembered code is used up');
    assert.equal(notify.mock.callCount(), 0);
    await tick();
    assert.equal(h.result.loading, false);
  });

  test('a remembered code the order didn’t use is kept', async () => {
    remember('TULSI10');
    const { h } = flowFor({ couponCode: undefined }, { '/api/orders': placed(201, { id: 'o1', orderNumber: 'TBJ1700000000000123' }) });
    await tick();
    await fillValid(h);
    h.result.setPaymentMethod('cod');
    await tick();
    await h.result.placeOrder();
    assert.equal(pending(), 'TULSI10');
  });

  test('guest email is sent only without a session', async () => {
    sessionState.data = null; sessionState.status = 'unauthenticated';
    const { h, calls } = flowFor({}, { '/api/orders': placed(201, { id: 'o1', orderNumber: 'TBJ1700000000000123' }) });
    await fillValid(h);
    h.result.updateForm('email', 'guest@example.com');
    h.result.setPaymentMethod('cod');
    await tick();
    await h.result.placeOrder();
    assert.equal(ordersCalls(calls)[0].body.guestEmail, 'guest@example.com');
  });

  test('409 CHARGES_CHANGED: charges refreshed, the customer told, nothing else happens', async () => {
    const message = 'Delivery charges have been updated: shipping ₹149. Please check your total and place the order again.';
    const { h, notify, onOrderPlaced } = flowFor({}, { '/api/orders': { status: 409, json: { success: false, code: 'CHARGES_CHANGED', message } } });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    assert.equal(cart.refreshCharges.mock.callCount(), 1);
    assert.deepEqual(notify.mock.calls.map((c) => c.arguments), [['info', message, { icon: 'ℹ️', duration: 10000 }]]);
    assert.equal(onOrderPlaced.mock.callCount(), 0);
    assert.equal(router.push.mock.callCount(), 0);
    await tick();
    assert.equal(h.result.loading, false);
  });

  test('order refused by the server: its message, shown for 15s', async () => {
    const { h, notify } = flowFor({}, { '/api/orders': { status: 400, json: { success: false, message: 'Insufficient stock for Lakshmi Choker' } } });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    assert.deepEqual(notify.mock.calls.map((c) => c.arguments), [['error', 'Insufficient stock for Lakshmi Choker', { duration: 15000 }]]);
    assert.equal(router.push.mock.callCount(), 0);
  });

  test('online: create-order, the Razorpay modal, verify → confirmation', async () => {
    const rzp = stubRazorpay();
    let verifyBody = null;
    const { h, calls, onOrderPlaced } = flowFor({}, {
      '/api/orders': placed(201, { id: 'o1', orderNumber: 'TBJ1700000000000123' }),
      '/api/payments/create-order': { json: { success: true, data: { id: 'order_rzp1', amount: 159900, currency: 'INR' } } },
      '/api/payments/verify': (u, init) => { verifyBody = JSON.parse(init.body); return { json: { success: true } }; },
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    assert.equal(ordersCalls(calls)[0].body.payment.method, 'razorpay');
    assert.equal(ordersCalls(calls)[0].body.codFee, 0);
    assert.deepEqual(calls.find((c) => c.url === '/api/payments/create-order').body, { orderId: 'o1' });
    assert.equal(rzp.opened, 1);
    assert.equal(rzp.options.order_id, 'order_rzp1');
    assert.equal(rzp.options.amount, 159900);
    assert.equal(rzp.options.currency, 'INR');
    assert.equal(rzp.options.name, 'Tulsi Fashion Jewellery');
    assert.deepEqual(rzp.options.prefill, { name: 'Asha', email: 'asha@example.com', contact: '9876543210' });
    assert.deepEqual(rzp.options.theme, { color: '#800020' });
    await tick();
    assert.equal(h.result.loading, false, 'the button is free again while the modal is open');
    assert.equal(onOrderPlaced.mock.callCount(), 0, 'not placed until paid');

    await rzp.options.handler({ razorpay_order_id: 'order_rzp1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    assert.deepEqual(verifyBody, { razorpayOrderId: 'order_rzp1', razorpayPaymentId: 'pay_1', razorpaySignature: 'sig', orderId: 'o1' });
    assert.equal(onOrderPlaced.mock.callCount(), 1);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments), [['/order-success?orderNumber=TBJ1700000000000123&email=asha%40example.com']]);
    await tick();
    assert.equal(h.result.verifying, true, 'stays on "confirming" while leaving');
  });

  test('online: payment on hold (202) → My Orders with the bank’s note', async () => {
    remember('TULSI10');
    const rzp = stubRazorpay();
    const held = 'Payment is still being confirmed by the bank. Your order will update automatically — please check My Orders in a few minutes.';
    const { h, onOrderPlaced, notify } = flowFor({ couponCode: 'TULSI10' }, {
      '/api/orders': placed(201, { id: 'o1', orderNumber: 'TBJ1700000000000123' }),
      '/api/payments/create-order': { json: { success: true, data: { id: 'order_rzp1', amount: 159900, currency: 'INR' } } },
      '/api/payments/verify': { status: 202, json: { success: false, message: held } },
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    assert.equal(pending(), 'TULSI10', 'not spent before payment');
    await rzp.options.handler({ razorpay_order_id: 'order_rzp1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    assert.equal(onOrderPlaced.mock.callCount(), 1);
    assert.deepEqual(toast.mock.calls.map((c) => c.arguments), [[held, { duration: 15000 }]]);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments), [['/account']]);
    assert.equal(notify.mock.callCount(), 0);
    assert.equal(pending(), null);
  });

  test('online: failed verification, a closed modal, a declined card, offline mid-confirmation', async () => {
    const rzp = stubRazorpay();
    let verify = { status: 400, json: { success: false, message: 'Payment verification failed' } };
    const { h, onOrderPlaced, notify } = flowFor({}, {
      '/api/orders': placed(201, { id: 'o1', orderNumber: 'TBJ1700000000000123' }),
      '/api/payments/create-order': { json: { success: true, data: { id: 'order_rzp1', amount: 159900, currency: 'INR' } } },
      '/api/payments/verify': () => verify,
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();

    await rzp.options.handler({ razorpay_order_id: 'order_rzp1', razorpay_payment_id: 'pay_1', razorpay_signature: 'bad' });
    await tick();
    assert.deepEqual(notify.mock.calls.at(-1).arguments, ['error', 'Payment verification failed']);
    assert.equal(h.result.verifying, false);

    rzp.options.modal.ondismiss();
    assert.deepEqual(notify.mock.calls.at(-1).arguments, ['info', 'Payment cancelled. Your order was not placed.', { icon: 'ℹ️' }]);

    rzp.failed({ error: { description: 'Your card was declined.' } });
    assert.deepEqual(notify.mock.calls.at(-1).arguments, ['error', 'Your card was declined.', { duration: 15000 }]);
    rzp.failed({});
    assert.deepEqual(notify.mock.calls.at(-1).arguments, ['error', 'Payment failed. Please try again.', { duration: 15000 }]);

    verify = new TypeError('Failed to fetch');
    await rzp.options.handler({ razorpay_order_id: 'order_rzp1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    await tick();
    assert.equal(notify.mock.calls.at(-1).arguments[0], 'error');
    assert.match(notify.mock.calls.at(-1).arguments[1], /My Orders/);
    assert.equal(h.result.verifying, false);

    assert.equal(onOrderPlaced.mock.callCount(), 0);
    assert.equal(router.push.mock.callCount(), 0);
  });

  test('online: payment setup failing is reported, and the button is released', async () => {
    stubRazorpay();
    const { h, notify } = flowFor({}, {
      '/api/orders': placed(201, { id: 'o1', orderNumber: 'TBJ1700000000000123' }),
      '/api/payments/create-order': { status: 500, json: { success: false, message: 'Payment setup failed. Please try again.' } },
    });
    await tick();
    await fillValid(h);
    await h.result.placeOrder();
    await tick();
    assert.deepEqual(notify.mock.calls.map((c) => c.arguments), [['error', 'Payment setup failed. Please try again.', { duration: 15000 }]]);
    assert.equal(h.result.loading, false);
  });

  test('loyalty (the page only): points loaded, redeeming lowers the total — but not the COD limit (the server’s rule: before points)', async () => {
    const { h, calls } = flowFor({ withLoyalty: true, subtotal: 20050 }, {
      '/api/admin/settings': SITE({ loyaltyEnabled: true }),
      '/api/loyalty': (u, init) => (init.method === 'POST'
        ? { json: { success: true, data: { discount: 100, pointsRedeemed: 100 } } }
        : { json: { success: true, data: { points: 150 } } }),
    });
    await tick();
    assert.ok(calls.some((c) => c.url === '/api/loyalty' && c.method === 'GET'));
    assert.equal(h.result.loyaltyEnabled, true);
    assert.equal(h.result.loyalty.points, 150);
    assert.equal(h.result.codBlockedByValue, true, '₹20,050 is over the COD limit');
    await h.result.redeemLoyaltyPoints();
    await tick();
    assert.equal(h.result.loyaltyDiscount, 100);
    assert.equal(h.result.loyalty.points, 50);
    assert.equal(h.result.payableTotal, 20050 - 100);
    assert.equal(h.result.codBlockedByValue, true, '₹20,050 before points: the server refuses COD for it, so it isn’t offered');
    assert.deepEqual(toast.success.mock.calls.map((c) => c.arguments), [['₹100 discount applied!']]);
    await h.result.redeemLoyaltyPoints();
    await tick();
    assert.equal(h.result.loyaltyDiscount, 0, 'second tap removes it');
  });
});

/* ═════════════ useAutoApplyPendingCoupon ═════════════ */

describe('useAutoApplyPendingCoupon', { skip }, () => {
  beforeEach(resetStubs);
  const OK = { json: { success: true, data: { coupon: { id: 'c1', code: 'TULSI10', type: 'percentage', value: 10 }, discount: 150 } } };
  function auto(props, route) {
    const calls = stubFetch({ '/api/coupons/validate': route });
    const cbs = { onApplied: mock.fn(), onRejected: mock.fn(), onUnavailable: mock.fn() };
    const h = renderHook((p) => useAutoApplyPendingCoupon(p), { enabled: true, hasCoupon: false, orderAmount: 1500, ...cbs, ...props });
    return { h, calls, ...cbs };
  }

  test('applies the remembered code once', async () => {
    remember('TULSI10');
    const { h, calls, onApplied } = auto({}, OK);
    await tick();
    assert.deepEqual(calls.map((c) => c.body), [{ code: 'TULSI10', orderAmount: 1500 }]);
    assert.equal(onApplied.mock.callCount(), 1);
    assert.equal(onApplied.mock.calls[0].arguments[0].discount, 150);
    assert.equal(onApplied.mock.calls[0].arguments[0].coupon.code, 'TULSI10');
    h.rerender({ orderAmount: 3000 });
    await tick();
    assert.equal(calls.length, 1, 'one attempt per mount');
    assert.equal(pending(), 'TULSI10', 'kept until an order uses it');
  });

  test('refused (first order only, unknown): forgotten, with the reason', async () => {
    remember('TULSI10');
    const first = auto({}, { status: 400, json: { success: false, code: 'FIRST_ORDER_ONLY', message: 'This code is for your first order only.' } });
    await tick();
    assert.equal(pending(), null);
    assert.equal(first.onRejected.mock.callCount(), 1);
    assert.equal(first.onRejected.mock.calls[0].arguments[0].message, 'This code is for your first order only.');
    assert.equal(first.onRejected.mock.calls[0].arguments[0].definite, true);

    remember('OLDCODE');
    const unknown = auto({}, { status: 404, json: { success: false, message: 'Invalid coupon code' } });
    await tick();
    assert.equal(pending(), null);
    assert.equal(unknown.onApplied.mock.callCount(), 0);
  });

  test('minimum not met: reason shown, code kept for a bigger order', async () => {
    remember('TULSI10');
    const { onRejected } = auto({ orderAmount: 500 }, { status: 400, json: { success: false, message: 'Minimum order amount is ₹1000' } });
    await tick();
    assert.equal(pending(), 'TULSI10');
    assert.equal(onRejected.mock.calls[0].arguments[0].definite, false);
  });

  test('offline / rate-limited: kept', async () => {
    remember('TULSI10');
    const offline = auto({}, new TypeError('Failed to fetch'));
    await tick();
    assert.equal(pending(), 'TULSI10');
    assert.equal(offline.onUnavailable.mock.callCount(), 1);
    const limited = auto({}, { status: 429, json: { success: false, message: 'Too many coupon attempts. Please try again later.' } });
    await tick();
    assert.equal(pending(), 'TULSI10');
    assert.equal(limited.onUnavailable.mock.callCount(), 1);
    assert.equal(limited.onRejected.mock.callCount(), 0);
  });

  test('waits until enabled; never with a coupon already on; nothing remembered → no request', async () => {
    const none = auto({}, OK);
    await tick();
    assert.equal(none.calls.length, 0);

    remember('TULSI10');
    const { h, calls } = auto({ enabled: false }, OK);
    await tick();
    assert.equal(calls.length, 0);
    h.rerender({ hasCoupon: true, enabled: true });
    await tick();
    assert.equal(calls.length, 0);
    h.rerender({ hasCoupon: false });
    await tick();
    assert.equal(calls.length, 1);
  });

  test('a coupon applied by hand while the check is in flight wins', async () => {
    remember('TULSI10');
    let release;
    const { h, onApplied } = auto({}, () => new Promise((r) => { release = () => r(OK); }));
    await tick();
    h.rerender({ hasCoupon: true });
    release();
    await tick();
    assert.equal(onApplied.mock.callCount(), 0);
  });
});

/* ═════════════ Rendered: BuyNowDrawer and /checkout ═════════════ */

describe('rendered', { skip }, () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const icon = (name) => {
    const Icon = (props) => React.createElement('svg', { 'data-icon': name, 'aria-hidden': props['aria-hidden'], className: props.className });
    Icon.displayName = name;
    return Icon;
  };
  const icons = new Proxy({}, { get: (_, name) => (typeof name === 'string' && /^Fi/.test(name) ? icon(name) : undefined), has: () => true });
  /* next/image → <img>, dropping next-only props. */
  const Img = ({ src, alt, fill: _f, unoptimized: _u, sizes, priority: _p, ...rest }) => React.createElement('img', { src, alt, sizes, ...rest });
  const Link = ({ href, children, prefetch: _prefetch, ...rest }) => React.createElement('a', { href, ...rest }, children);
  const cartState = { charges: { ...DEFAULT_CHARGES }, refreshCharges: async () => null, items: [], subtotal: 0, discount: 0, coupon: null, dispatch: () => {} };
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
  const BuyNowDrawer = sucrase ? load('components/checkout/BuyNowDrawer.jsx').default : null;
  const CheckoutPage = sucrase ? load('app/checkout/page.js').default : null;

  function render(el) {
    const warnings = [];
    const orig = console.error;
    console.error = (...args) => { warnings.push(args.map(String).join(' ')); };
    let html;
    try { html = renderToStaticMarkup(el); } finally { console.error = orig; }
    assert.deepEqual(warnings, [], 'React warned while rendering');
    return html;
  }
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
  const text = (html) => decode(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const CLD = 'https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/products/choker.jpg';
  const PIECE = { id: 'p1', _id: 'p1', name: 'Lakshmi Temple Choker', sku: 'TJ-NK-1024', price: 1200, discountPrice: 950, stock: 3, images: [CLD] };
  const drawer = (props = {}) => render(React.createElement(BuyNowDrawer, { open: true, onClose: () => {}, product: PIECE, qty: 1, ...props }));
  const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;

  beforeEach(() => { resetStubs(); cartState.charges = { ...DEFAULT_CHARGES }; });

  test('closed (or no product): renders nothing', () => {
    assert.equal(drawer({ open: false }), '');
    assert.equal(drawer({ product: null }), '');
  });

  test('a labelled modal dialog, bottom sheet on phones and a right drawer from md', () => {
    const html = drawer();
    const dialog = html.match(/<div[^>]*role="dialog"[^>]*>/)[0];
    assert.match(dialog, /aria-modal="true"/);
    assert.match(dialog, /tabindex="-1"/);
    const labelledBy = dialog.match(/aria-labelledby="([^"]+)"/)[1];
    assert.match(html, new RegExp(`<h2 id="${labelledBy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>Buy Now</h2>`));
    const cls = dialog.match(/class="([^"]+)"/)[1].split(' ');
    for (const c of ['bottom-0', 'max-h-[92dvh]', 'rounded-t-3xl', 'md:right-0', 'md:h-full', 'md:max-w-md']) assert.ok(cls.includes(c), c);
    assert.ok(cls.some((c) => c.startsWith('motion-safe:animate-[')), 'slide only for motion-safe');
    assert.ok(cls.some((c) => c.startsWith('md:motion-safe:animate-[')));
    assert.match(html, /@keyframes tjBuyNowUp/);
    assert.match(html, /pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/, 'footer clears the home indicator');
    assert.match(html, /aria-label="Close checkout"/);
  });

  test('guest: the piece, then a sign-in step that comes back to this drawer', () => {
    sessionState.data = null; sessionState.status = 'unauthenticated';
    const html = drawer({ qty: 2 });
    const t = text(html);
    assert.match(t, /Lakshmi Temple Choker/);
    assert.match(t, /SKU TJ-NK-1024/);
    assert.match(t, /Sign in to place your order/);
    assert.match(html, /href="\/login\?callbackUrl=%2Fproduct%2Fp1%3Fbuynow%3D2"/);
    assert.doesNotMatch(t, /Place order/);
    assert.doesNotMatch(t, /Delivery address/);
    const img = html.match(/<img [^>]*>/)[0];
    assert.match(img, /src="https:\/\/res\.cloudinary\.com\/tulsi\/image\/upload\/f_auto,q_auto:best,w_160,dpr_auto\/v17\//, 'cldThumb');
  });

  test('loading session: a spinner, no form', () => {
    sessionState.data = null; sessionState.status = 'loading';
    const t = text(drawer());
    assert.doesNotMatch(t, /Sign in to place|Place order|Delivery address/);
  });

  test('signed in: coupon, address, payment, summary and one Place order button', () => {
    const html = drawer({ qty: 2 });
    const t = text(html);
    /* 2 × ₹950 = ₹1,900 → under ₹2,000, so ₹99 shipping. */
    assert.match(t, /Subtotal \(2 pieces\) ₹1,900/);
    assert.match(t, /Shipping ₹99/);
    assert.match(t, new RegExp(`Total ${rupees(1999)}`));
    assert.match(t, new RegExp(`Place order · ${rupees(1999)}`));
    assert.doesNotMatch(t, /COD fee ₹/, 'online by default: no COD fee row');
    assert.match(t, /Coupon code/);
    assert.match(t, /Delivery address/);
    assert.match(t, /Pay Online \(Razorpay\)/);
    assert.match(t, /Cash on Delivery/);
    assert.equal((html.match(/type="submit"/g) || []).length, 1);
    /* Every address label points at its input. */
    for (const [, id] of html.matchAll(/<label for="([^"]+)"/g)) assert.match(html, new RegExp(`<input[^>]*id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), id);
    assert.match(html, /autoComplete="postal-code"|autocomplete="postal-code"/i);
    /* Quantity stepper: at 2 of 3 both directions work. */
    assert.match(html, /aria-label="Decrease quantity"/);
    assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*aria-label="Increase quantity"/);
  });

  test('free shipping: the shipping row is hidden', () => {
    const t = text(drawer({ qty: 3 })); // 3 × ₹950 = ₹2,850 ≥ ₹2,000
    assert.doesNotMatch(t, /Shipping/);
    assert.match(t, new RegExp(`Place order · ${rupees(2850)}`));
  });

  test('quantity is bounded by stock', () => {
    const html = drawer({ qty: 9 });
    assert.match(text(html), /Subtotal \(3 pieces\) ₹2,850/);
    assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Increase quantity"/);
  });

  test('sold out: says so, no order form', () => {
    const t = text(drawer({ product: { ...PIECE, stock: 0 } }));
    assert.match(t, /Out of stock/);
    assert.match(t, /just sold out/);
    assert.doesNotMatch(t, /Place order|Delivery address/);
  });

  test('/checkout still renders the cart with the shared fields and the same total', () => {
    Object.assign(cartState, {
      items: [{ _id: 'p1', name: 'Lakshmi Temple Choker', price: 1200, discountPrice: 950, quantity: 1 }],
      subtotal: 950, discount: 0, coupon: null,
    });
    const t = text(render(React.createElement(CheckoutPage)));
    assert.match(t, /Shipping Details/);
    assert.match(t, /Saved addresses|Full Name \*/);
    assert.match(t, /Payment Method/);
    assert.match(t, /Lakshmi Temple Choker × 1 ₹950/);
    assert.match(t, /Shipping ₹99/);
    assert.match(t, /Place Order · ₹1,049/);
    sessionState.data = null; sessionState.status = 'loading';
    assert.doesNotMatch(text(render(React.createElement(CheckoutPage))), /Place Order/);
    Object.assign(cartState, { items: [], subtotal: 0 });
  });
});
