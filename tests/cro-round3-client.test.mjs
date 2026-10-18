/* ─────────────────────────────────────────────
   CRO round 3 — the shopper's side of the skeptic's regressions
   (src/components/checkout/**, /checkout, the Buy Now drawer, the product
   page):

   • R4  the points discount already parked on the account (GET /api/loyalty
         parkedDiscount — redeemed earlier, or held by an abandoned online
         attempt) is shown on /checkout and in the drawer, capped at 20% of
         the subtotal, so the button is what the order is charged; Place
         order waits the moment it takes to load (never longer than 8 s)
   • R6  paying the kept order again: only create-order's ALREADY_PAID
         (→ confirmation page) and ORDER_CANCELLED (→ a fresh order) settle
         it; any other failure is shown as it is and nothing is cancelled
   • R7  a coupon check that gets no answer gives up after 8 s, like being
         offline: the code is kept, not applied, and Place order is free
   • R8  /checkout can remove an applied coupon (forgetting the remembered
         code); "couldn't check the coupon" twice in a row takes it off
   • BN-4 the drawer's code failing to load reloads the product page with
         Buy Now reopened (?buynow=<qty>) — once: a page that was already
         that reload asks for a refresh instead of looping

   Same harness as tests/cro-fixes-e2e.test.mjs (sucrase, the real
   CartProvider, a tiny hook runner, no DOM), but fetch answers from a small
   model of the server's documented contracts rather than the real route
   handlers, so these tests pin the client to those contracts:
     GET  /api/loyalty               data.parkedDiscount (₹, before the cap)
     POST /api/payments/create-order 409 { code: 'ALREADY_PAID' } |
                                     409 { code: 'ORDER_CANCELLED' } |
                                     plain { success: false, message }
     POST /api/orders                total = subtotal − coupon −
                                     min(parked, 20% of subtotal) + charges

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { validateCoupon, COUPON_CHECK_TIMEOUT_MS } from '../src/components/checkout/validateCoupon.js';
import { fetchJsonWithin, TimeoutError } from '../src/components/checkout/fetchWithin.js';
import {
  buyNowLoadFailure, buyNowReturnPath, buyNowSignInUrl, loyaltyCapFor, loyaltyDiscountFor,
  BUY_NOW_RELOADING, BUY_NOW_REFRESH,
} from '../src/components/checkout/checkoutRules.js';
import { DEFAULT_CHARGES, computeCharges } from '../src/lib/storeCharges.js';

/* ═════════════ The server, as its contracts describe it ═════════════ */

const UNIT = 1500; // p1's price
const world = {};
/* Per-test answers: 'METHOD /path' (or '/api/orders/:id') → ({ body, id }) → { status, json } */
const overrides = new Map();

function priceOrder(body) {
  const qty = body.items.reduce((s, l) => s + Number(l.quantity), 0);
  const subtotal = UNIT * qty;
  const coupon = body.couponCode ? Math.round(subtotal * 0.1) : 0;
  const loyaltyDiscount = Math.min(world.parked, Math.floor(subtotal * 0.2));
  const { shipping, codFee } = computeCharges({ subtotal, paymentMethod: body.payment.method, charges: DEFAULT_CHARGES });
  return { subtotal, coupon, loyaltyDiscount, total: subtotal - coupon - loyaltyDiscount + shipping + codFee };
}

function serve(method, p, body) {
  const id = /^\/api\/orders\/([^/]+)$/.exec(p)?.[1];
  const custom = overrides.get(`${method} ${p}`) || (id && overrides.get(`${method} /api/orders/:id`));
  if (custom) return custom({ body, id });
  switch (`${method} ${id ? '/api/orders/:id' : p}`) {
    case 'GET /api/store-charges': return { json: { success: true, data: DEFAULT_CHARGES } };
    case 'GET /api/admin/settings': return { json: { success: true, data: { onlinePaymentEnabled: true, loyaltyEnabled: true } } };
    case 'GET /api/user/address': return { json: { success: true, data: [{ id: 'a1', fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001' }] } };
    case 'GET /api/loyalty': return { json: { success: true, data: { points: world.points, transactions: [], parkedDiscount: world.parked } } };
    case 'POST /api/loyalty': {
      const want = Math.floor(world.points / 50) * 50;
      world.points -= want;
      world.parked += want;
      return { json: { success: true, data: { pointsRedeemed: want, discount: want } } };
    }
    case 'POST /api/coupons/validate':
      return { json: { success: true, data: { coupon: { id: 'c1', code: body.code, type: 'percentage', value: 10, minOrderAmount: 0, maxDiscount: null, firstOrderOnly: true }, discount: Math.round(body.orderAmount * 0.1), firstOrderOnly: true } } };
    case 'POST /api/orders': {
      const priced = priceOrder(body);
      world.parked -= priced.loyaltyDiscount;
      world.n += 1;
      const order = { id: `o${world.n}`, orderNumber: `TBJ${world.n}`, status: 'pending', paid: false, body, ...priced };
      world.orders.set(order.id, order);
      return { status: 201, json: { success: true, data: { id: order.id, orderNumber: order.orderNumber, total: order.total, discount: priced.coupon + priced.loyaltyDiscount, loyaltyDiscount: priced.loyaltyDiscount } } };
    }
    case 'GET /api/orders/:id': {
      const o = world.orders.get(id);
      return o ? { json: { success: true, data: { id, status: o.status, payment: { status: o.paid ? 'paid' : 'pending' } } } } : { status: 404, json: { success: false, message: 'Order not found' } };
    }
    case 'PUT /api/orders/:id': {
      const o = world.orders.get(id);
      if (o.paid) return { status: 409, json: { success: false, code: 'ALREADY_PAID', message: 'Your payment for this order has just come through.' } };
      if (o.status !== 'cancelled') { o.status = 'cancelled'; world.parked += o.loyaltyDiscount; }
      return { json: { success: true, data: { id, status: 'cancelled' } } };
    }
    case 'POST /api/payments/create-order': {
      const o = world.orders.get(body.orderId);
      if (o.paid) return { status: 409, json: { success: false, code: 'ALREADY_PAID', message: 'We have received the payment for this order. Please check My Orders.' } };
      if (o.status === 'cancelled') return { status: 409, json: { success: false, code: 'ORDER_CANCELLED', message: 'This order was cancelled.' } };
      return { json: { success: true, data: { id: `order_rzp_${o.id}`, amount: o.total * 100, currency: 'INR' } } };
    }
    case 'GET /api/products/p1': return { json: { success: true, data: { ...PIECE, isActive: true } } };
    case 'GET /api/products/p1/reviews': return { json: { success: true, data: { reviews: [], average: 0, count: 0 } } };
    default: throw new TypeError(`Failed to fetch (no route for ${method} ${p})`);
  }
}

let wire = []; // every request: { method, path, body, signal, status }
let inflight = 0;
let parked = 0;
/* A gate holds a request until the test opens it; a gate never opened is
   a request that never answers. Either way an abort (fetch's signal) ends
   it, as in a browser. */
const gates = new Map();
function gate(key) {
  let open;
  const promise = new Promise((r) => { open = r; });
  gates.set(key, promise);
  return () => { gates.delete(key); open(); };
}
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('The operation was aborted.', 'AbortError')); return; }
    signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
    promise.then(resolve, reject);
  });
}
globalThis.fetch = async (url, init = {}) => {
  inflight += 1;
  try {
    const u = new URL(String(url), 'http://tulsi.test');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const entry = { method, path: u.pathname, body, signal: init.signal };
    wire.push(entry);
    const held = gates.get(`${method} ${u.pathname}`);
    if (held) {
      parked += 1;
      try { await abortable(held, init.signal); } finally { parked -= 1; }
    }
    const r = await serve(method, u.pathname, body);
    if (r instanceof Error) throw r;
    entry.status = r.status ?? 200;
    return { status: entry.status, json: async () => { if (r.json === undefined) throw new SyntaxError('Unexpected token <'); return structuredClone(r.json); } };
  } finally {
    inflight -= 1;
  }
};
const calls = (method, p) => wire.filter((c) => c.method === method && (p === undefined || (p instanceof RegExp ? p.test(c.path) : c.path === p)));

/* ═════════════ Browser: storage, events, Razorpay's window ═════════════ */

const local = new Map();
const tab = new Map();
const listeners = new Map();
const storage = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } });
const windows = []; // Razorpay checkout windows opened
globalThis.window = {
  localStorage: storage(local),
  sessionStorage: storage(tab),
  innerWidth: 1024,
  addEventListener: (t, f) => { (listeners.get(t) || listeners.set(t, new Set()).get(t)).add(f); },
  removeEventListener: (t, f) => { listeners.get(t)?.delete(f); },
  dispatchEvent: (e) => { for (const f of [...(listeners.get(e.type) || [])]) f(e); return true; },
  Razorpay: class {
    constructor(options) { this.options = options; windows.push(this); }
    on() {}
    open() { this.opened = true; }
  },
};
globalThis.localStorage = globalThis.window.localStorage;
globalThis.document = {
  visibilityState: 'visible', activeElement: null, body: { style: {} }, documentElement: { clientWidth: 1024 },
  addEventListener() {}, removeEventListener() {},
};
const closeWindow = (w = windows.at(-1)) => w.options.modal.ondismiss();

/* ═════════════ Client modules: sucrase + a tiny hook runner ═════════════ */

const require = createRequire(import.meta.url);
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the pages and hooks cannot be transpiled for node --test';

const SRC = path.resolve('src');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const REAL = new Set(['react/jsx-runtime', 'date-fns']);
function makeLoader(stubs, expose = {}) {
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
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8') + (expose[rel] ? `\n${expose[rel]}\n` : '');
    const { code } = sucrase.transform(text, { transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file });
    const mod = { exports: {} };
    cache.set(file, mod);
    const req = (id) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      const localFile = resolveLocal(file, id);
      if (localFile) return Object.hasOwn(stubs, aliasOf(localFile)) ? stubs[aliasOf(localFile)] : load(localFile);
      if (REAL.has(id)) return require(id);
      throw new Error(`${rel} imports ${id}: add a stub for it in this test`);
    };
    vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, req, mod);
    return mod.exports;
  }
  return (relPath) => load(path.join(SRC, relPath));
}
const esm = (value) => ({ __esModule: true, default: value });

let currentHook = null;
const fakeReact = {
  useState: (init) => currentHook.useState(init),
  useRef: (init) => currentHook.useRef(init),
  useEffect: (fn, deps) => currentHook.useEffect(fn, deps),
  useReducer: (reducer, init) => currentHook.useReducer(reducer, init),
  useCallback: (fn, deps) => currentHook.useMemo(() => fn, deps),
  useMemo: (fn, deps) => currentHook.useMemo(fn, deps),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useId: () => ':t:',
  createContext: () => ({ Provider: function Provider() { return null; } }),
  lazy: (load) => load,
  Suspense: function Suspense() { return null; },
};
const sameDeps = (a, b) => !!a && !!b && a.length === b.length && a.every((d, k) => Object.is(d, b[k]));
function renderHook(hookFn) {
  const slots = [];
  const effects = [];
  let cursor = 0; let eCursor = 0; let queued = []; let rendering = false; let dirty = false; let scheduled = false; let alive = true;
  const h = { result: undefined };
  const setter = (slot, compute) => (v) => {
    const next = compute(v);
    if (Object.is(next, slot.value)) return;
    slot.value = next;
    if (rendering) dirty = true; else schedule();
  };
  const self = {
    useState(init) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = { value: typeof init === 'function' ? init() : init };
        slot.set = setter(slot, (v) => (typeof v === 'function' ? v(slot.value) : v));
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useReducer(reducer, init) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = { value: init };
        slot.set = setter(slot, (action) => reducer(slot.value, action));
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(init) { const i = cursor++; if (!slots[i]) slots[i] = { ref: { current: init } }; return slots[i].ref; },
    useMemo(fn, deps) {
      const i = cursor++;
      if (slots[i] && sameDeps(deps, slots[i].deps)) return slots[i].value;
      slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = eCursor++;
      const prev = effects[i];
      if (prev && sameDeps(deps, prev.deps)) return;
      queued.push(() => { prev?.cleanup?.(); const c = fn(); effects[i] = { deps, cleanup: typeof c === 'function' ? c : null }; });
    },
  };
  function render() {
    if (!alive) return;
    let passes = 0;
    do {
      dirty = false; cursor = 0; eCursor = 0; queued = [];
      rendering = true; currentHook = self;
      try { h.result = hookFn(); } finally { rendering = false; currentHook = null; }
      if (++passes > 25) throw new Error('Too many re-renders');
    } while (dirty);
    const run = queued; queued = [];
    for (const f of run) f();
  }
  function schedule() {
    if (scheduled || !alive) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; render(); });
  }
  h.rerender = render;
  h.unmount = () => { if (!alive) return; alive = false; for (const e of effects) e?.cleanup?.(); };
  render();
  return h;
}

/* Everything settles: no request in flight (held ones aside), renders done. */
async function settle() {
  let quiet = 0;
  for (let i = 0; i < 2000; i += 1) {
    await new Promise((r) => setImmediate(r));
    if (inflight === parked) { quiet += 1; if (quiet >= 6) return; } else quiet = 0;
  }
  throw new Error('the page never settled');
}

const sessionState = { data: null, status: 'unauthenticated' };
function signInAs(user) {
  sessionState.data = user ? { user: { id: user.id, name: user.name, email: user.email } } : null;
  sessionState.status = user ? 'authenticated' : 'unauthenticated';
}
const router = { push: mock.fn(), replace: mock.fn(), prefetch() {} };
const toast = Object.assign(mock.fn(), { error: mock.fn(), success: mock.fn(), dismiss() {} });
const icons = new Proxy({}, { get: (_, name) => (typeof name === 'string' && /^Fi/.test(name) ? function Icon() { return null; } : undefined), has: () => true });
let cart = null; // the real CartProvider's value, refreshed on every render

const providerModule = sucrase ? makeLoader({ react: fakeReact, '@/lib/analytics/tracker': { track() {} } })('context/CartContext.js') : null;
const CartProvider = providerModule?.CartProvider;
const APP_STUBS = {
  react: fakeReact,
  'next/navigation': { useRouter: () => router, useParams: () => ({ id: 'p1' }) },
  'next-auth/react': { useSession: () => sessionState },
  'react-hot-toast': esm(toast),
  'next/image': esm(function Image() { return null; }),
  'next/link': esm(function Link() { return null; }),
  'react-icons/fi': icons,
  '@/context/CartContext': { useCart: () => cart },
  '@/lib/loadRazorpay': { loadRazorpayScript: async () => {} },
  '@/lib/analytics/tracker': { track() {} },
};
const loadApp = sucrase ? makeLoader(APP_STUBS, { 'components/checkout/BuyNowDrawer.jsx': 'export { BuyNowDialog as __BuyNowDialog };' }) : null;
const CheckoutPage = sucrase ? loadApp('app/checkout/page.js').default : null;
const BuyNowDialog = sucrase ? loadApp('components/checkout/BuyNowDrawer.jsx').__BuyNowDialog : null;
const flowModule = sucrase ? loadApp('components/checkout/useCheckoutFlow.js') : {};
const useCheckoutFlow = flowModule.default;
const useAutoApplyPendingCoupon = sucrase ? loadApp('components/checkout/useAutoApplyPendingCoupon.js').default : null;

const mounted = new Set();
/* A page in the shop: the real CartProvider above it, as the layout has it. */
function mountPage(view) {
  const h = renderHook(() => {
    cart = CartProvider({ children: null }).props.value;
    return view();
  });
  mounted.add(h);
  return h;
}
function mountHook(view) {
  const h = renderHook(view);
  mounted.add(h);
  return h;
}
const leavePage = () => { for (const h of mounted) h.unmount(); mounted.clear(); };

function find(el, pred) {
  if (el === null || el === undefined || typeof el !== 'object') return null;
  if (Array.isArray(el)) { for (const c of el) { const f = find(c, pred); if (f) return f; } return null; }
  if (pred(el)) return el;
  return find(el.props?.children, pred);
}
const textOf = (el) => {
  if (el === null || el === undefined || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(textOf).join('');
  return textOf(el.props?.children);
};
const submitButton = (tree) => find(tree, (el) => el.type === 'button' && el.props?.type === 'submit');
const buttonLabel = (tree) => textOf(submitButton(tree)).replace(/\s+/g, ' ').trim();
const rupees = (label) => Number(String(label).split('₹').pop().replace(/[^\d]/g, ''));
const flowOf = (tree) => find(tree, (el) => !!el.props?.flow)?.props.flow;
const byLabel = (tree, label) => find(tree, (el) => el.type === 'button' && el.props?.['aria-label'] === label);
const byText = (tree, re) => find(tree, (el) => el.type === 'button' && re.test(textOf(el).trim()));
async function submit(page) {
  const form = find(page.result, (el) => el.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  await settle();
}

/* ═════════════ The shop ═════════════ */

const NEW = { id: 'u-new', email: 'new@x.test', name: 'Priya' };
const PIECE = { _id: 'p1', id: 'p1', name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: UNIT, stock: 5, images: [] };
const TULSI10 = { id: 'c1', code: 'TULSI10', type: 'percentage', value: 10, minOrderAmount: 0, maxDiscount: null, firstOrderOnly: true };
const seedCart = (qty, coupon = null) => local.set('tulsi-cart', JSON.stringify({ items: [{ ...PIECE, quantity: qty }], coupon, discount: 0, discountAt: null }));
const remember = (code) => local.set('tj-pending-coupon', JSON.stringify({ code, at: Date.now() }));
const pending = () => { try { return JSON.parse(local.get('tj-pending-coupon')).code; } catch { return null; } };
const toastTexts = (fn) => fn.mock.calls.map((c) => c.arguments[0]);
const openDrawer = (initialQty = 1) => mountHook(() => BuyNowDialog({ onClose: () => {}, product: PIECE, initialQty }));
const FEEDBACK = /taken off this order/;

function resetWorld() {
  leavePage();
  Object.assign(world, { parked: 0, points: 0, orders: new Map(), n: 0 });
  overrides.clear();
  wire = []; gates.clear();
  local.clear(); tab.clear(); listeners.clear(); windows.length = 0;
  delete globalThis.window.location;
  sessionState.data = null; sessionState.status = 'unauthenticated';
  router.push.mock.resetCalls(); router.replace.mock.resetCalls();
  toast.mock.resetCalls(); toast.error.mock.resetCalls(); toast.success.mock.resetCalls();
  cart = { charges: DEFAULT_CHARGES, refreshCharges: async () => DEFAULT_CHARGES };
}
beforeEach(resetWorld);
afterEach(() => { mock.timers.reset(); leavePage(); });

/* The order flow on its own (as the drawer and /checkout use it). */
function mountFlow(props = {}) {
  const p = { lines: [{ product: 'p1', quantity: 1 }], subtotal: UNIT, discount: 0, notify: mock.fn(), onOrderPlaced: mock.fn(), onCouponChanged: mock.fn(), ...props };
  const h = mountHook(() => useCheckoutFlow(p));
  return { h, p };
}

/* ═════════════ R4: the points discount already on the account ═════════════ */

describe('R4: points redeemed earlier (parked on the account) are shown, so the button is what is charged', { skip }, () => {
  test('/checkout: ₹100 parked → Points Discount −₹100, button ₹1,499 = the order = Razorpay; no Remove (it can’t be taken back)', async () => {
    world.parked = 100;
    signInAs(NEW);
    seedCart(1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.match(textOf(page.result), /Points Discount.*-₹100/);
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,499', 'was ₹1,599 against a ₹1,499 charge');
    assert.equal(byText(page.result, /Remove/), null);
    await submit(page);
    const [o] = world.orders.values();
    assert.equal(o.total, rupees(label));
    assert.equal(o.loyaltyDiscount, 100);
    assert.equal(windows.at(-1).options.amount, rupees(label) * 100);
  });

  test('/checkout: redeeming more points adds to the parked discount (offered once); the 20% cap applies to the total', async () => {
    world.parked = 100;
    world.points = 150;
    signInAs(NEW);
    seedCart(1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.match(textOf(page.result), /150 Loyalty Points/);
    await byText(page.result, /^Use Points$/).props.onClick();
    await settle();
    assert.deepEqual(toastTexts(toast.success), ['₹150 discount applied!']);
    assert.match(textOf(page.result), /Points Discount.*-₹250/);
    assert.equal(byText(page.result, /^Use Points$/), null, 'one redemption per visit');
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,349');
    await submit(page);
    const [o] = world.orders.values();
    assert.equal(o.total, rupees(label));
    assert.equal(router.push.mock.calls.at(-1).arguments[0], '/order-success?orderNumber=TBJ1&email=new%40x.test');
  });

  test('/checkout: a large parked discount on a small order shows 20% of the subtotal, no more — and no offer to redeem past the cap', async () => {
    world.parked = 1000;
    world.points = 500;
    signInAs(NEW);
    seedCart(1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(loyaltyCapFor(UNIT), 300);
    assert.match(textOf(page.result), /Points Discount.*-₹300/);
    assert.equal(byText(page.result, /^Use Points$/), null, 'more points would not lower this order');
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,299');
    await submit(page);
    assert.equal([...world.orders.values()][0].total, rupees(label));
    assert.equal(world.parked, 700, 'the rest stays parked');
  });

  test('drawer: ₹100 parked → a Points discount row and a ₹1,499 button, charged ₹1,499', async () => {
    world.parked = 100;
    signInAs(NEW);
    const drawer = openDrawer(1);
    await settle();
    assert.equal(calls('GET', '/api/loyalty').length, 1);
    assert.match(textOf(drawer.result), /Points discount−₹100/);
    const label = buttonLabel(drawer.result);
    assert.equal(label, 'Place order · ₹1,499');
    await submit(drawer);
    const [o] = world.orders.values();
    assert.equal(o.total, rupees(label));
    assert.equal(windows.at(-1).options.amount, 149900);
  });

  test('drawer: Place order waits while the points load, then shows the lower total', async () => {
    world.parked = 100;
    signInAs(NEW);
    const open = gate('GET /api/loyalty');
    const drawer = openDrawer(1);
    await settle();
    assert.equal(submitButton(drawer.result).props.disabled, true);
    await submit(drawer);
    assert.equal(calls('POST', '/api/orders').length, 0, 'held');
    open();
    await settle();
    assert.equal(submitButton(drawer.result).props.disabled, false);
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,499');
  });

  test('no answer from /api/loyalty within 8 s: checkout carries on (Place order is never stuck)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    signInAs(NEW);
    gate('GET /api/loyalty'); // never opened
    const { h } = mountFlow({ withParkedLoyalty: true });
    await settle();
    assert.equal(h.result.loyaltyLoading, true);
    mock.timers.tick(flowModule.LOYALTY_LOAD_TIMEOUT_MS);
    await settle();
    assert.equal(h.result.loyaltyLoading, false);
    assert.equal(h.result.loyaltyDiscount, 0);
    assert.equal(calls('GET', '/api/loyalty')[0].signal.aborted, true, 'the stalled request is aborted');
  });

  test('the flow: parked only for a signed-in customer who asked for it; an older server without parkedDiscount counts as 0', async () => {
    world.parked = 100;
    const out = mountFlow({ withParkedLoyalty: true });
    await settle();
    assert.equal(calls('GET', '/api/loyalty').length, 0, 'signed out: nothing to load (the server applies none)');
    assert.equal(out.h.result.loyaltyLoading, false);
    leavePage();

    signInAs(NEW);
    const plain = mountFlow();
    await settle();
    assert.equal(calls('GET', '/api/loyalty').length, 0);
    assert.equal(plain.h.result.loyaltyLoading, false);
    leavePage();

    overrides.set('GET /api/loyalty', () => ({ json: { success: true, data: { points: 0 } } }));
    const old = mountFlow({ withLoyalty: true });
    await settle();
    assert.equal(old.h.result.loyaltyDiscount, 0);
    assert.equal(old.h.result.loyaltyLoading, false);
    leavePage();

    overrides.set('GET /api/loyalty', () => ({ status: 500, json: { success: false, message: 'boom' } }));
    const failed = mountFlow({ withParkedLoyalty: true });
    await settle();
    assert.equal(failed.h.result.loyaltyLoading, false, 'a failed load never holds the button');
    assert.equal(failed.h.result.loyaltyDiscount, 0);
  });

  test('after a reload: the parked discount an abandoned attempt holds is shown, and the retry is charged the button', async () => {
    /* ₹100 redeemed, Razorpay closed (the attempt took the ₹100), the page
       reloaded: GET /api/loyalty counts what the attempt holds. */
    world.parked = 100;
    signInAs(NEW);
    seedCart(1);
    const first = mountPage(() => CheckoutPage());
    await settle();
    await submit(first);
    closeWindow();
    leavePage();
    assert.equal(world.parked, 0, 'the abandoned attempt holds it');
    overrides.set('GET /api/loyalty', () => ({ json: { success: true, data: { points: 0, parkedDiscount: world.parked + [...world.orders.values()].filter((o) => o.status === 'pending' && !o.paid).reduce((s, o) => s + o.loyaltyDiscount, 0) } } }));

    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,499', 'was ₹1,599 (charged ₹1,499) — e2e B5');
  });

  test('loyaltyDiscountFor: the cap applies to parked + redeemed together', () => {
    assert.equal(loyaltyDiscountFor(100 + 150, 1500), 250);
    assert.equal(loyaltyDiscountFor(250 + 100, 1500), 300);
    assert.equal(loyaltyCapFor(0), 0);
    assert.equal(loyaltyCapFor(1999), 399);
  });
});

/* ═════════════ R6: paying the kept order again ═════════════ */

describe('R6: create-order fails on a retry → only ALREADY_PAID / ORDER_CANCELLED settle it', { skip }, () => {
  async function abandonedAttempt(props) {
    signInAs(NEW);
    const flow = mountFlow(props);
    await settle();
    await flow.h.result.placeOrder();
    await settle();
    assert.equal(windows.length, 1);
    closeWindow();
    return flow;
  }
  const lastNotice = (p) => p.notify.mock.calls.at(-1).arguments;

  test('online payment paused: the server’s message as it is — the kept order is not cancelled, and the next tap pays that same order', async () => {
    const { h, p } = await abandonedAttempt();
    const paused = 'Online payment is temporarily unavailable. Please choose Cash on Delivery.';
    overrides.set('POST /api/payments/create-order', () => ({ status: 400, json: { success: false, message: paused } }));
    await h.result.placeOrder();
    await settle();
    assert.deepEqual(lastNotice(p), ['error', paused, { duration: 15000 }], 'was “Your earlier payment attempt has expired”');
    assert.equal(calls('PUT').length, 0, 'nothing cancelled');
    assert.equal(world.orders.get('o1').status, 'pending');

    overrides.clear();
    await h.result.placeOrder();
    await settle();
    assert.equal(calls('POST', '/api/orders').length, 1, 'no second order');
    assert.equal(windows.length, 2);
    assert.equal(windows[1].options.order_id, windows[0].options.order_id);
  });

  test('a failure with some other code (or a 5xx) is shown as it is: no look-up, no cancel', async () => {
    const { h, p } = await abandonedAttempt();
    overrides.set('POST /api/payments/create-order', () => ({ status: 409, json: { success: false, code: 'AMOUNT_MISMATCH', message: 'Please refresh and try again.' } }));
    await h.result.placeOrder();
    await settle();
    assert.deepEqual(lastNotice(p), ['error', 'Please refresh and try again.', { duration: 15000 }]);
    assert.equal(calls('GET', /^\/api\/orders\//).length, 0);
    overrides.set('POST /api/payments/create-order', () => ({ status: 502 }));
    await h.result.placeOrder();
    await settle();
    assert.deepEqual(lastNotice(p), ['error', 'Payment setup failed. Please try again.', { duration: 15000 }]);
    assert.equal(calls('PUT').length, 0);
    assert.equal(world.orders.get('o1').status, 'pending');
    assert.equal(calls('POST', '/api/orders').length, 1);
  });

  test('ORDER_CANCELLED (by the store, or taken over by a later attempt): a fresh order for what is on screen, at the button’s price', async () => {
    world.parked = 100;
    const { h, p } = await abandonedAttempt({ withParkedLoyalty: true, couponCode: 'TULSI10', discount: 150 });
    const label = h.result.payableTotal;
    assert.equal(label, 1500 - 150 - 100 + 99);
    /* Cancelled elsewhere: its coupon use and points go back. */
    world.orders.get('o1').status = 'cancelled';
    world.parked += world.orders.get('o1').loyaltyDiscount;

    await h.result.placeOrder();
    await settle();
    assert.equal(calls('PUT').length, 0, 'nothing to cancel');
    assert.equal(calls('GET', /^\/api\/orders\//).length, 0, 'the code says it all');
    const posts = calls('POST', '/api/orders');
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[1].body, posts[0].body, 'the same order, again');
    const o2 = world.orders.get('o2');
    assert.equal(o2.total, label);
    assert.equal(windows.length, 2);
    assert.equal(windows[1].options.order_id, 'order_rzp_o2');
    assert.equal(windows[1].options.amount, label * 100);
    assert.equal(p.notify.mock.calls.filter((c) => c.arguments[0] === 'error').length, 0);

    /* That one is the kept order now. */
    closeWindow();
    await h.result.placeOrder();
    await settle();
    assert.equal(calls('POST', '/api/orders').length, 2);
    assert.equal(windows[2].options.order_id, 'order_rzp_o2');
  });

  test('ORDER_CANCELLED, and the fresh order can’t be paid either → told; no third order', async () => {
    const { h, p } = await abandonedAttempt();
    world.orders.get('o1').status = 'cancelled';
    overrides.set('POST /api/payments/create-order', ({ body }) => (body.orderId === 'o1'
      ? { status: 409, json: { success: false, code: 'ORDER_CANCELLED', message: 'This order was cancelled.' } }
      : { status: 500, json: { success: false, message: 'Razorpay is not responding.' } }));
    await h.result.placeOrder();
    await settle();
    assert.equal(calls('POST', '/api/orders').length, 2);
    assert.deepEqual(lastNotice(p), ['error', 'Razorpay is not responding.', { duration: 15000 }]);
  });

  test('ORDER_CANCELLED for a brand-new order: told, no loop; the next tap places a new one', async () => {
    signInAs(NEW);
    const { h, p } = mountFlow();
    await settle();
    overrides.set('POST /api/payments/create-order', () => ({ status: 409, json: { success: false, code: 'ORDER_CANCELLED', message: 'This order was cancelled.' } }));
    await h.result.placeOrder();
    await settle();
    assert.equal(calls('POST', '/api/orders').length, 1);
    assert.deepEqual(lastNotice(p), ['error', 'This order was cancelled.', { duration: 15000 }]);
    overrides.clear();
    await h.result.placeOrder();
    await settle();
    assert.equal(calls('POST', '/api/orders').length, 2, 'not the cancelled one again');
    assert.equal(windows.at(-1).options.order_id, 'order_rzp_o2');
  });

  test('ALREADY_PAID (a late UPI payment): the confirmation page — nothing cancelled, nothing placed twice', async () => {
    const { h, p } = await abandonedAttempt();
    world.orders.get('o1').paid = true;
    await h.result.placeOrder();
    await settle();
    assert.equal(calls('PUT').length, 0);
    assert.equal(calls('POST', '/api/orders').length, 1);
    assert.equal(h.result.placed, true);
    assert.equal(p.onOrderPlaced.mock.callCount(), 1);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ1&email=new%40x.test']);
  });

  test('a code-less refusal (an older server, a proxy page) only looks the order up: paid → confirmation, cancelled → a fresh order, else shown', async () => {
    const paid = await abandonedAttempt();
    world.orders.get('o1').paid = true;
    overrides.set('POST /api/payments/create-order', () => ({ status: 400, json: { success: false, message: 'Order is already paid' } }));
    await paid.h.result.placeOrder();
    await settle();
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ1&email=new%40x.test']);
    assert.equal(calls('PUT').length, 0);
    resetWorld();

    const cancelled = await abandonedAttempt();
    world.orders.get('o1').status = 'cancelled';
    overrides.set('POST /api/payments/create-order', ({ body }) => (body.orderId === 'o1'
      ? { status: 400, json: { success: false, message: 'This order was cancelled.' } }
      : serveDefault('POST', '/api/payments/create-order', body)));
    await cancelled.h.result.placeOrder();
    await settle();
    assert.equal(calls('PUT').length, 0);
    assert.equal(calls('POST', '/api/orders').length, 2);
    assert.equal(windows.at(-1).options.order_id, 'order_rzp_o2');
  });
});

/* The model's own answer, for an override that only changes some cases. */
function serveDefault(method, p, body) {
  const key = `${method} ${p}`;
  const saved = overrides.get(key);
  overrides.delete(key);
  try { return serve(method, p, body); } finally { if (saved) overrides.set(key, saved); }
}

/* ═════════════ R7: a coupon check that never answers ═════════════ */

describe('R7: validateCoupon gives up after 8 s, like being offline', () => {
  const hanging = (seen = []) => (url, init) => {
    seen.push(init.signal);
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  };

  test('no answer → offline (kept, not applied, not refused), timedOut, and the request is aborted', async () => {
    const seen = [];
    const r = await validateCoupon('tulsi10', 1500, { fetchImpl: hanging(seen), timeoutMs: 20 });
    assert.deepEqual(r, { ok: false, code: 'TULSI10', refused: false, definite: false, status: 0, message: 'Couldn’t check the code — check your connection and try again.', timedOut: true });
    assert.equal(seen[0].aborted, true);
  });

  test('headers arrive but the body stalls → the same', async () => {
    const r = await validateCoupon('TULSI10', 1500, { fetchImpl: async () => ({ status: 200, json: () => new Promise(() => {}) }), timeoutMs: 20 });
    assert.equal(r.timedOut, true);
    assert.equal(r.refused, false);
  });

  test('8 s by default; an answer in time is classified as before (no timedOut key)', async () => {
    assert.equal(COUPON_CHECK_TIMEOUT_MS, 8000);
    mock.timers.enable({ apis: ['setTimeout'] });
    let result = null;
    validateCoupon('TULSI10', 1500, { fetchImpl: hanging() }).then((r) => { result = r; });
    mock.timers.tick(7999);
    await new Promise((r) => setImmediate(r));
    assert.equal(result, null, 'still waiting at 7.999 s');
    mock.timers.tick(1);
    await new Promise((r) => setImmediate(r));
    assert.equal(result?.timedOut, true);
    mock.timers.reset();

    const ok = await validateCoupon('TULSI10', 1500, { fetchImpl: async () => ({ status: 200, json: async () => ({ success: true, data: { coupon: TULSI10, discount: 150 } }) }) });
    assert.deepEqual(Object.keys(ok).sort(), ['code', 'coupon', 'discount', 'firstOrderOnly', 'ok']);
    const refused = await validateCoupon('TULSI10', 1500, { fetchImpl: async () => ({ status: 400, json: async () => ({ success: false, message: 'This code is for your first order only.' }) }) });
    assert.equal('timedOut' in refused, false);
  });

  test('fetchJsonWithin: rejects with a TimeoutError; a network error passes through; a non-JSON body is data null', async () => {
    await assert.rejects(fetchJsonWithin('/x', {}, { ms: 10, fetchImpl: hanging() }), (e) => e instanceof TimeoutError && e.name === 'TimeoutError');
    await assert.rejects(fetchJsonWithin('/x', {}, { ms: 1000, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), TypeError);
    const { res, data } = await fetchJsonWithin('/x', {}, { ms: 1000, fetchImpl: async () => ({ status: 502, json: async () => { throw new SyntaxError('<html>'); } }) });
    assert.equal(res.status, 502);
    assert.equal(data, null);
  });
});

describe('R7: Place order is never stuck on “Checking your coupon…”', { skip }, () => {
  test('/checkout: the re-check of a first-order code gets no answer → after 8 s the button is free, the coupon kept (the server has the last word)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    signInAs(NEW);
    seedCart(1, { ...TULSI10, checkedFor: null }); // applied while signed out
    gate('POST /api/coupons/validate'); // never answers
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.match(buttonLabel(page.result), /Checking your coupon/);
    assert.equal(submitButton(page.result).props.disabled, true);
    mock.timers.tick(COUPON_CHECK_TIMEOUT_MS);
    await settle();
    assert.equal(submitButton(page.result).props.disabled, false);
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,449');
    assert.equal(cart.coupon?.code, 'TULSI10', 'kept');
    await submit(page);
    assert.equal(calls('POST', '/api/orders')[0].body.couponDiscount, 150, 'sent with the discount shown');
  });

  test('drawer: the remembered welcome code gets no answer → kept in the box to try again, not applied; the button is free', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    signInAs(NEW);
    remember('TULSI10');
    gate('POST /api/coupons/validate');
    const drawer = openDrawer(1);
    await settle();
    assert.match(buttonLabel(drawer.result), /Checking coupon/);
    mock.timers.tick(COUPON_CHECK_TIMEOUT_MS);
    await settle();
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,599');
    assert.equal(submitButton(drawer.result).props.disabled, false);
    assert.equal(find(drawer.result, (el) => el.type === 'input' && el.props?.id === ':t:-coupon').props.value, 'TULSI10');
    assert.match(textOf(drawer.result), /Couldn’t check TULSI10 just now — tap Apply to try again/);
    assert.equal(pending(), 'TULSI10', 'remembered for later');
  });

  test('useAutoApplyPendingCoupon: a timed-out check is “unavailable” (kept, remembered for this basket), not a refusal', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    remember('TULSI10');
    gate('POST /api/coupons/validate');
    const cb = { onApplied: mock.fn(), onRejected: mock.fn(), onUnavailable: mock.fn() };
    const h = mountHook(() => useAutoApplyPendingCoupon({ enabled: true, hasCoupon: false, orderAmount: 1500, ...cb }));
    await settle();
    assert.equal(h.result.checking, true);
    mock.timers.tick(COUPON_CHECK_TIMEOUT_MS);
    await settle();
    assert.equal(h.result.checking, false);
    assert.equal(cb.onUnavailable.mock.callCount(), 1);
    assert.equal(cb.onUnavailable.mock.calls[0].arguments[0].timedOut, true);
    assert.equal(cb.onApplied.mock.callCount() + cb.onRejected.mock.callCount(), 0);
    assert.equal(pending(), 'TULSI10');
    assert.equal(JSON.parse(tab.get('tj-pending-coupon-attempt')).code, 'TULSI10', 'not re-checked on every open');
  });
});

/* ═════════════ R8: removing the coupon on /checkout ═════════════ */

describe('R8: /checkout — Remove, and “couldn’t check the coupon” twice in a row', { skip }, () => {
  const checkFailed = () => ({ status: 409, json: { success: false, code: 'COUPON_CHANGED', couponApplied: false, discount: 0, reason: 'check_failed', message: 'We couldn’t check TULSI10 just now. Please try again.' } });

  test('an applied coupon has a Remove: off the order, the remembered code forgotten, the button back to the full price — and charged that', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart(1, { ...TULSI10, checkedFor: 'u-new' });
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.match(textOf(page.result), /Discount \(TULSI10\)-₹150/);
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,449');
    const remove = byText(page.result, /^Remove coupon$/);
    assert.equal(remove.props.disabled, false);
    remove.props.onClick();
    await settle();
    assert.equal(cart.coupon, null);
    assert.equal(pending(), null, 'not put straight back on');
    assert.equal(calls('POST', '/api/coupons/validate').length, 0);
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,599');
    await submit(page);
    const [o] = world.orders.values();
    assert.equal(o.body.couponCode, undefined);
    assert.equal(o.total, rupees(label));
  });

  test('a coupon waiting for its minimum (“Add ₹X more”) can be removed too', async () => {
    signInAs(NEW);
    seedCart(1, { ...TULSI10, code: 'WELCOME5K', minOrderAmount: 5000, checkedFor: 'u-new' });
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.match(textOf(page.result), /Add ₹3,500 more to use WELCOME5K/);
    byText(page.result, /^Remove$/).props.onClick();
    await settle();
    assert.equal(cart.coupon, null);
    assert.doesNotMatch(textOf(page.result), /WELCOME5K/);
  });

  test('check_failed once: kept, try again; twice in a row: taken off with a short message — the next tap is charged the new button', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart(1, { ...TULSI10, checkedFor: 'u-new' });
    overrides.set('POST /api/orders', checkFailed);
    const page = mountPage(() => CheckoutPage());
    await settle();
    flowOf(page.result).setPaymentMethod('cod');
    await settle();

    await submit(page);
    assert.equal(cart.coupon?.code, 'TULSI10', 'the first time it stays on');
    assert.deepEqual(toastTexts(toast), ['We couldn’t check TULSI10 just now. Please try again.']);
    assert.equal(pending(), 'TULSI10');

    await submit(page);
    assert.equal(cart.coupon, null, 'the second time in a row it comes off (the shopper was stuck)');
    assert.match(toastTexts(toast).at(-1), /^We still couldn’t check TULSI10, so it has been taken off this order\./);
    assert.equal(pending(), null, 'or the page would put it back on');
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,599');

    overrides.clear();
    await submit(page);
    const [o] = world.orders.values();
    assert.equal(o.total, rupees(label));
    assert.equal(o.body.couponCode, undefined);
  });

  test('“in a row”: any other answer in between starts the count again; so does another code', async () => {
    signInAs(NEW);
    const answers = [checkFailed(), { status: 409, json: { success: false, code: 'CHARGES_CHANGED', message: 'Delivery charges have changed.' } }, checkFailed()];
    overrides.set('POST /api/orders', () => answers.shift() || checkFailed());
    const { h, p } = mountFlow({ couponCode: 'TULSI10', discount: 150 });
    await settle();
    for (let i = 0; i < 3; i += 1) { await h.result.placeOrder(); await settle(); }
    assert.equal(p.onCouponChanged.mock.callCount(), 0, 'check_failed, charges changed, check_failed: never two in a row');
    p.couponCode = 'FEST5';
    h.rerender();
    await h.result.placeOrder();
    await settle();
    assert.equal(p.onCouponChanged.mock.callCount(), 0, 'the first for FEST5');
    await h.result.placeOrder();
    await settle();
    assert.deepEqual(p.onCouponChanged.mock.calls.map((c) => c.arguments[0]), [{ code: 'FEST5', couponApplied: false, discount: 0, reason: 'check_failed' }]);
  });

  test('drawer: twice in a row → the coupon is off and its code back in the box (Apply tries again)', async () => {
    signInAs(NEW);
    remember('TULSI10');
    overrides.set('POST /api/orders', checkFailed);
    const drawer = openDrawer(1);
    await settle();
    assert.match(textOf(drawer.result), /TULSI10 applied — you save ₹150/);
    await submit(drawer);
    assert.match(textOf(drawer.result), /TULSI10 applied/);
    await submit(drawer);
    assert.doesNotMatch(textOf(drawer.result), /TULSI10 applied/);
    assert.match(textOf(drawer.result), FEEDBACK);
    assert.equal(find(drawer.result, (el) => el.type === 'input' && el.props?.id === ':t:-coupon').props.value, 'TULSI10');
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,599');
  });
});

/* ═════════════ BN-4: the drawer's code fails to load ═════════════ */

describe('BN-4: Buy Now’s code fails to load → the page reloads with Buy Now reopened, once', { skip }, () => {
  function productPage({ search = '', chunk = () => 'fail', realReturn = false } = {}) {
    const Drawer = function BuyNowDrawerStub() { return null; };
    const imports = [];
    globalThis.window.location = { search, pathname: '/product/p1', hash: '', assign: mock.fn() };
    const stubs = {
      ...APP_STUBS,
      '@/context/CartContext': { useCart: () => ({ dispatch() {}, charges: DEFAULT_CHARGES }) },
      '@/context/WishlistContext': { useWishlist: () => ({ toggle() {}, isWishlisted: () => false }) },
      '@/hooks/useProductTracking': { useProductTracking: () => ({ recordCarouselClick() {}, recordZoomInteraction() {} }) },
      '@/components/product/useStoreWhatsApp': esm(() => null),
      ...(realReturn ? {} : { '@/components/product/useBuyNowReturn': esm(() => {}) }),
      ...Object.fromEntries(['shop/ImageZoomModal', 'chat/ChatWithSeller', 'product/StockBadge', 'product/LiveViewersBadge', 'product/OrderOnWhatsApp', 'product/WhatsAppIcon', 'ar/TryOnModal', 'ui/LoadingSpinner']
        .map((c) => [`@/components/${c}`, esm(function Stub() { return null; })])),
    };
    Object.defineProperty(stubs, '@/components/checkout/BuyNowDrawer', {
      enumerable: true,
      get() {
        const now = chunk();
        imports.push(now);
        if (now === 'fail') throw Object.assign(new Error('Loading chunk 812 failed.'), { name: 'ChunkLoadError' });
        return esm(Drawer);
      },
    });
    const ProductDetail = makeLoader(stubs)('app/product/[id]/ProductDetail.js').default;
    const initialProduct = { ...PIECE, isActive: true }; // one object, as the server page passes it
    const page = mountHook(() => ProductDetail({ initialProduct }));
    return { page, imports, Drawer, assign: globalThis.window.location.assign };
  }
  const buyNow = (page) => byText(page.result, /Buy Now/);

  test('a failed load: “Opening checkout…” and a full load of /product/p1?buynow=<qty> (Turbopack would hand the same failure back to every retry)', async () => {
    signInAs(NEW);
    const { page, assign } = productPage();
    await settle();
    byLabel(page.result, 'Increase quantity').props.onClick();
    await settle();
    buyNow(page).props.onClick();
    await settle();
    assert.deepEqual(toastTexts(toast), [BUY_NOW_RELOADING]);
    assert.deepEqual(assign.mock.calls.map((c) => c.arguments[0]), ['/product/p1?buynow=2']);
    assert.equal(toast.error.mock.callCount(), 0, 'not “please try again” — trying again never works');
  });

  test('the reloaded page (?buynow=2) opens the drawer for that quantity', async () => {
    signInAs(NEW);
    const { page, imports, Drawer, assign } = productPage({ search: '?buynow=2', chunk: () => 'ok', realReturn: true });
    await settle();
    assert.deepEqual(router.replace.mock.calls.map((c) => c.arguments[0]), ['/product/p1'], 'the parameter is dropped');
    const drawer = find(page.result, (el) => el.type === Drawer);
    assert.equal(drawer?.props.qty, 2);
    assert.deepEqual(imports, ['ok']);
    assert.equal(assign.mock.callCount(), 0);
  });

  test('the reloaded page fails to load it again: “please refresh the page”, and no loop — a later tap doesn’t reload either', async () => {
    signInAs(NEW);
    const { page, assign } = productPage({ search: '?buynow=2', realReturn: true });
    await settle();
    assert.deepEqual(toastTexts(toast.error), [BUY_NOW_REFRESH]);
    assert.equal(assign.mock.callCount(), 0);
    buyNow(page).props.onClick();
    await settle();
    assert.deepEqual(toastTexts(toast.error), [BUY_NOW_REFRESH, BUY_NOW_REFRESH]);
    assert.equal(assign.mock.callCount(), 0);
    assert.equal(toast.mock.callCount(), 0, 'never “Opening checkout…”');
  });

  test('buyNowLoadFailure / buyNowReturnPath', () => {
    assert.deepEqual(buyNowLoadFailure({ productId: 'p1', qty: 3, openedWithBuyNow: false }), { reloadTo: '/product/p1?buynow=3', message: 'Opening checkout…' });
    assert.deepEqual(buyNowLoadFailure({ productId: 'p1', qty: 3, openedWithBuyNow: true }), { reloadTo: null, message: 'Couldn’t open checkout — please refresh the page' });
    assert.equal(buyNowReturnPath('a b/c', 0), '/product/a%20b%2Fc?buynow=1');
    assert.equal(buyNowReturnPath('p1', 2.6), '/product/p1?buynow=3');
    assert.equal(buyNowSignInUrl('p1', 2), '/login?callbackUrl=%2Fproduct%2Fp1%3Fbuynow%3D2', 'unchanged');
  });
});
