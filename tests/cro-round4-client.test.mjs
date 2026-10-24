/* ─────────────────────────────────────────────
   CRO round 4 — the shopper's side of the agreed contracts
   (src/components/checkout/**, /checkout, the Buy Now drawer, the product
   page). The rule throughout: the price the button shows is the price
   charged, and a payment is never shown as an order it didn't become.

   • A  placing an order can find an earlier attempt paid on Razorpay after
        all (409 EARLIER_ORDER_PAID → that order's confirmation page, the
        same way a kept attempt that turned out paid opens) or its payment
        still going through / not checkable (EARLIER_PAYMENT_PENDING → the
        server's message, nothing placed, the button free again)
   • B  verify 409 PAID_AFTER_CANCEL → the server's message, never the
        confirmation page, the attempt forgotten; a look-up that finds the
        kept attempt cancelled AND paid is a refund, not the confirmation
        page (cancelled is checked first)
   • D  the points discount shown is sent with every order of a signed-in
        customer (0 too); 409 LOYALTY_CHANGED → the server's parked figure
        is shown, nothing is ordered, and the next tap matches
   • E  COD is offered by the server's rule: subtotal − coupon + shipping +
        COD fee (as if COD) over ₹20,000 → not available; points don't count
   • F  create-order 409 ORDER_CANCELLED replaced:true → told, nothing placed
        in that tap, the attempt forgotten (the next tap places a fresh
        order); without replaced → a fresh order in the same tap, as before
   • BN-4 the reload after a failed Buy Now load keeps the page's other
        query parameters (utm_*) and sets buynow

   Same harness as tests/cro-round3-client.test.mjs (sucrase, the real
   CartProvider, a tiny hook runner, no DOM); fetch answers from a small
   model of the server's documented contracts:
     POST /api/orders                409 LOYALTY_CHANGED { loyaltyDiscount,
                                     parkedDiscount } when body.loyaltyDiscount
                                     is a number ≠ its own; 400 over the COD
                                     limit; else the order (total = subtotal −
                                     coupon − min(parked, 20%) + charges)
     GET  /api/orders/:id            { orderNumber, status, cancelReason,
                                     paidAfterCancel, couponCode,
                                     shippingAddress, payment.status }
     POST /api/payments/create-order 409 ORDER_CANCELLED { replaced } |
                                     409 ALREADY_PAID | the Razorpay order
     POST /api/payments/verify       409 PAID_AFTER_CANCEL for a cancelled
                                     order | success
   Answers the model doesn't make itself (EARLIER_ORDER_PAID,
   EARLIER_PAYMENT_PENDING, …) are set per test.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { buyNowLoadFailure, buyNowReturnPath, buyNowSignInUrl, checkoutAmounts, COD_MAX_ORDER_VALUE } from '../src/components/checkout/checkoutRules.js';
import { DEFAULT_CHARGES, computeCharges } from '../src/lib/storeCharges.js';

/* The contracts' wording (the client shows the server's message as it is). */
const EARLIER_PAID = 'Your earlier payment went through — we have confirmed that order.';
const PENDING_IN_PROGRESS = 'Your earlier payment is still being processed. Please wait a few minutes and check My Orders before paying again.';
const PENDING_UNKNOWN = 'We couldn’t check your earlier payment just now. Please try again in a minute.';
const PAID_AFTER_CANCEL = 'This payment was for an order that had already been replaced or cancelled, so it was not placed. We will refund it to your original payment method.';
const EARLIER_REFUNDED = 'Your earlier payment was for an order that had already been replaced or cancelled, so it was not placed. We will refund it to your original payment method.';
const REPLACED = 'This payment was replaced by your newer order. Please check My Orders — tap the button again only if you want another order.';

/* ═════════════ The server, as its contracts describe it ═════════════ */

const PRICES = { p1: 1500, p2: 19900 };
const world = {};
/* Per-test answers: 'METHOD /path' (or '/api/orders/:id') → ({ body, id }) → { status, json } */
const overrides = new Map();
const signedIn = () => sessionState.status === 'authenticated';

function priceOrder(body) {
  const subtotal = body.items.reduce((s, l) => s + PRICES[l.product] * Number(l.quantity), 0);
  const coupon = body.couponCode ? Math.round(subtotal * 0.1) : 0;
  /* Parked points: at most 20% of the subtotal, and no more than the
     coupon leaves (src/app/api/orders/route.js). */
  const loyaltyDiscount = signedIn() ? Math.min(world.parked, Math.floor(subtotal * 0.2), Math.max(0, subtotal - coupon)) : 0;
  const { shipping, codFee } = computeCharges({ subtotal, paymentMethod: body.payment.method, charges: world.charges });
  return { subtotal, coupon, loyaltyDiscount, shipping, codFee, total: subtotal - coupon - loyaltyDiscount + shipping + codFee };
}

function serve(method, p, body) {
  const id = /^\/api\/orders\/([^/]+)$/.exec(p)?.[1];
  const custom = overrides.get(`${method} ${p}`) || (id && overrides.get(`${method} /api/orders/:id`));
  if (custom) return custom({ body, id });
  switch (`${method} ${id ? '/api/orders/:id' : p}`) {
    case 'GET /api/store-charges': return { json: { success: true, data: world.charges } };
    case 'GET /api/admin/settings': return { json: { success: true, data: { onlinePaymentEnabled: true, loyaltyEnabled: true } } };
    case 'GET /api/user/address': return { json: { success: true, data: [{ id: 'a1', fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001' }] } };
    case 'GET /api/loyalty': return { json: { success: true, data: { points: world.points, transactions: [], parkedDiscount: world.parked } } };
    case 'POST /api/loyalty': {
      const want = Math.floor(world.points / 50) * 50;
      world.points -= want;
      world.parked += want;
      return { json: { success: true, data: { pointsRedeemed: want, discount: want } } };
    }
    case 'POST /api/orders': {
      const priced = priceOrder(body);
      if (typeof body.loyaltyDiscount === 'number' && body.loyaltyDiscount !== priced.loyaltyDiscount) {
        return { status: 409, json: { success: false, code: 'LOYALTY_CHANGED', loyaltyDiscount: priced.loyaltyDiscount, parkedDiscount: world.parked, message: `Your points discount is now ₹${priced.loyaltyDiscount.toLocaleString('en-IN')}. Please check your total and place the order again.` } };
      }
      /* The COD limit: the total before points, with shipping and the COD fee. */
      if (body.payment.method === 'cod' && priced.subtotal - priced.coupon + priced.shipping + priced.codFee > COD_MAX_ORDER_VALUE) {
        return { status: 400, json: { success: false, message: 'Cash on Delivery is available only for orders up to ₹20,000. Please choose online payment for this order.' } };
      }
      world.parked -= priced.loyaltyDiscount;
      world.n += 1;
      const order = { id: `o${world.n}`, orderNumber: `TBJ${world.n}`, status: 'pending', paid: false, body, ...priced };
      world.orders.set(order.id, order);
      return { status: 201, json: { success: true, data: { id: order.id, orderNumber: order.orderNumber, total: order.total, discount: priced.coupon + priced.loyaltyDiscount, loyaltyDiscount: priced.loyaltyDiscount } } };
    }
    case 'GET /api/orders/:id': {
      const o = world.orders.get(id);
      if (!o) return { status: 404, json: { success: false, message: 'Order not found' } };
      return { json: { success: true, data: {
        id, orderNumber: o.orderNumber, status: o.status, cancelReason: o.cancelReason || null, paidAfterCancel: o.paidAfterCancel || undefined,
        couponCode: o.body.couponCode || null, shippingAddress: o.body.shippingAddress, payment: { method: o.body.payment.method, status: o.paid ? 'paid' : 'pending' },
        items: (o.body.items || []).map((l) => ({ product: l.product, quantity: Number(l.quantity) })),
      } } };
    }
    case 'PUT /api/orders/:id': {
      const o = world.orders.get(id);
      if (o.status === 'cancelled') return { status: 400, json: { success: false, message: 'Order cannot be cancelled — it is already cancelled' } };
      if (o.paid) return { status: 409, json: { success: false, code: 'ALREADY_PAID', message: 'Your payment for this order has just come through.' } };
      o.status = 'cancelled';
      world.parked += o.loyaltyDiscount;
      return { json: { success: true, data: { id, status: 'cancelled' } } };
    }
    case 'POST /api/payments/create-order': {
      const o = world.orders.get(body.orderId);
      const replaced = o.cancelReason === 'replaced';
      if (o.status === 'cancelled' || replaced) {
        return { status: 409, json: { success: false, code: 'ORDER_CANCELLED', replaced, message: replaced ? 'This payment attempt was replaced by your newer order, so it can’t be paid. Please check My Orders.' : 'This order was cancelled.' } };
      }
      if (o.paid) return { status: 409, json: { success: false, code: 'ALREADY_PAID', message: 'This order is already paid. Please check My Orders.' } };
      return { json: { success: true, data: { id: `order_rzp_${o.id}`, amount: o.total * 100, currency: 'INR' } } };
    }
    case 'POST /api/payments/verify': {
      const o = world.orders.get(body.orderId);
      o.paid = true;
      if (o.status === 'cancelled') {
        Object.assign(o, { paidAfterCancel: true, refundDue: true });
        return { status: 409, json: { success: false, code: 'PAID_AFTER_CANCEL', message: PAID_AFTER_CANCEL } };
      }
      o.status = 'confirmed';
      return { json: { success: true, message: 'Payment verified' } };
    }
    case 'GET /api/products/p1': return { json: { success: true, data: { ...PIECE, isActive: true } } };
    case 'GET /api/products/p1/reviews': return { json: { success: true, data: { reviews: [], average: 0, count: 0 } } };
    default: throw new TypeError(`Failed to fetch (no route for ${method} ${p})`);
  }
}

let wire = []; // every request: { method, path, body, status }
let inflight = 0;
globalThis.fetch = async (url, init = {}) => {
  inflight += 1;
  try {
    const u = new URL(String(url), 'http://tulsi.test');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const entry = { method, path: u.pathname, body };
    wire.push(entry);
    const r = await serve(method, u.pathname, body);
    if (r instanceof Error) throw r; // offline
    entry.status = r.status ?? 200;
    return { status: entry.status, json: async () => { if (r.json === undefined) throw new SyntaxError('Unexpected token <'); return structuredClone(r.json); } };
  } finally {
    inflight -= 1;
  }
};
const calls = (method, p) => wire.filter((c) => c.method === method && (p === undefined || (p instanceof RegExp ? p.test(c.path) : c.path === p)));
const orderPosts = () => calls('POST', '/api/orders');
const payFor = () => calls('POST', '/api/payments/create-order').map((c) => c.body.orderId);

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
/* The shopper pays in the window: Razorpay hands back the signed ids. */
async function payInWindow(w = windows.at(-1)) {
  await w.options.handler({ razorpay_order_id: w.options.order_id, razorpay_payment_id: `pay_${windows.indexOf(w) + 1}`, razorpay_signature: 'sig' });
  await settle();
}

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

/* Everything settles: no request in flight, renders done. */
async function settle() {
  let quiet = 0;
  for (let i = 0; i < 2000; i += 1) {
    await new Promise((r) => setImmediate(r));
    if (inflight === 0) { quiet += 1; if (quiet >= 6) return; } else quiet = 0;
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
const useCheckoutFlow = sucrase ? loadApp('components/checkout/useCheckoutFlow.js').default : null;

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
/* The payment-method fields, rendered (a hook-free component). */
function paymentFields(tree) {
  const el = find(tree, (e) => typeof e.type === 'function' && e.type.name === 'PaymentMethodFields');
  return el.type(el.props);
}
const codRadio = (fields) => find(fields, (el) => el.type === 'input' && el.props?.name === 'payment' && el.props?.value === 'cod');
async function submit(page) {
  const form = find(page.result, (el) => el.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  await settle();
}

/* ═════════════ The shop ═════════════ */

const NEW = { id: 'u-new', email: 'new@x.test', name: 'Priya' };
const PIECE = { _id: 'p1', id: 'p1', name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 5, images: [] };
const HARAM = { _id: 'p2', id: 'p2', name: 'Kasu Mala Haram', sku: 'KM-NK-210', price: 21000, discountPrice: 19900, stock: 2, images: [] };
/* Delivery is never free and the COD fee is never waived. */
const ALWAYS_FEES = { ...DEFAULT_CHARGES, free_shipping_threshold: 0, cod_fee_waive_above: null };
const seedCart = (piece, qty) => local.set('tulsi-cart', JSON.stringify({ items: [{ ...piece, quantity: qty }], coupon: null, discount: 0, discountAt: null }));
const remember = (code) => local.set('tj-pending-coupon', JSON.stringify({ code, at: Date.now() }));
const pending = () => { try { return JSON.parse(local.get('tj-pending-coupon')).code; } catch { return null; } };
const toastTexts = (fn) => fn.mock.calls.map((c) => c.arguments[0]);
const openDrawer = (initialQty = 1) => mountHook(() => BuyNowDialog({ onClose: () => {}, product: PIECE, initialQty }));
/* An order of the customer's from an earlier visit, already in the store's books. */
const earlierOrder = (id, o = {}) => world.orders.set(id, {
  id, orderNumber: `TBJ-${id}`, status: 'confirmed', paid: true, loyaltyDiscount: 0,
  body: { items: [{ product: 'p1', quantity: 1 }], couponCode: null, shippingAddress: { email: 'new@x.test' }, payment: { method: 'razorpay' } },
  ...o,
});

function resetWorld() {
  leavePage();
  Object.assign(world, { parked: 0, points: 0, orders: new Map(), n: 0, charges: DEFAULT_CHARGES });
  overrides.clear();
  wire = [];
  local.clear(); tab.clear(); listeners.clear(); windows.length = 0;
  delete globalThis.window.location;
  sessionState.data = null; sessionState.status = 'unauthenticated';
  router.push.mock.resetCalls(); router.replace.mock.resetCalls();
  toast.mock.resetCalls(); toast.error.mock.resetCalls(); toast.success.mock.resetCalls();
  cart = { charges: DEFAULT_CHARGES, refreshCharges: async () => DEFAULT_CHARGES };
}
beforeEach(resetWorld);
afterEach(leavePage);

/* The order flow on its own (as the drawer and /checkout use it). */
function mountFlow(props = {}) {
  const p = { lines: [{ product: 'p1', quantity: 1 }], subtotal: 1500, discount: 0, notify: mock.fn(), onOrderPlaced: mock.fn(), onCouponChanged: mock.fn(), ...props };
  const h = mountHook(() => useCheckoutFlow(p));
  return { h, p };
}
const lastNotice = (p) => p.notify.mock.calls.at(-1)?.arguments;
/* A signed-in customer's online attempt, its window closed: kept for a retry. */
async function keptAttempt(props) {
  signInAs(NEW);
  const flow = mountFlow(props);
  await settle();
  await flow.h.result.placeOrder();
  await settle();
  assert.equal(windows.length, 1);
  closeWindow();
  return flow;
}

/* ═════════════ A: an earlier attempt paid, or its payment still going through ═════════════ */

describe('A: POST /api/orders finds an earlier attempt paid (EARLIER_ORDER_PAID) or still being paid (EARLIER_PAYMENT_PENDING)', { skip }, () => {
  const earlierPaid = (orderId = 'o0') => () => ({ status: 409, json: { success: false, code: 'EARLIER_ORDER_PAID', orderId, message: EARLIER_PAID } });
  const stillPending = (message) => () => ({ status: 409, json: { success: false, code: 'EARLIER_PAYMENT_PENDING', orderId: 'o0', message } });

  test('/checkout: EARLIER_ORDER_PAID → the server’s message and THAT order’s confirmation page (looked up); the cart is cleared, nothing is paid or placed', async () => {
    earlierOrder('o0');
    signInAs(NEW);
    seedCart(PIECE, 1);
    overrides.set('POST /api/orders', earlierPaid('o0'));
    const page = mountPage(() => CheckoutPage());
    await settle();
    router.push.mock.resetCalls(); // the harness's first render, before the cart is read
    await submit(page);
    assert.deepEqual(toastTexts(toast), [EARLIER_PAID]);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ-o0&email=new%40x.test']);
    assert.deepEqual(calls('GET', /^\/api\/orders\//).map((c) => c.path), ['/api/orders/o0'], 'looked up for its order number');
    assert.equal(cart.items.length, 0, 'cleared, as for any earlier attempt that turned out paid (ALREADY_PAID)');
    assert.deepEqual(payFor(), [], 'nothing to pay');
    assert.equal(windows.length, 0);
    assert.equal(toast.error.mock.callCount(), 0, 'not an error');
  });

  test('the flow: a kept attempt given up for a changed basket, then EARLIER_ORDER_PAID → that order; its welcome code forgotten; the button stays locked', async () => {
    remember('TULSI10');
    const { h, p } = await keptAttempt({ couponCode: 'TULSI10', discount: 150 });
    p.lines = [{ product: 'p1', quantity: 2 }]; p.subtotal = 3000; p.discount = 300;
    h.rerender();
    await settle();
    earlierOrder('o0', { body: { items: [{ product: 'p1', quantity: 2 }], couponCode: 'TULSI10', shippingAddress: { email: 'priya.r@x.test' }, payment: { method: 'razorpay' } } });
    overrides.set('POST /api/orders', earlierPaid('o0'));
    await h.result.placeOrder();
    await settle();
    assert.deepEqual(calls('PUT').map((c) => c.path), ['/api/orders/o1'], 'the kept attempt was given up first, as today');
    assert.deepEqual(lastNotice(p), ['info', EARLIER_PAID, { icon: '✅' }]);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ-o0&email=priya.r%40x.test']);
    assert.equal(p.onOrderPlaced.mock.callCount(), 1);
    assert.equal(pending(), null, 'the paid order used TULSI10');
    assert.equal(h.result.placed, true);
    overrides.clear();
    await h.result.placeOrder();
    await settle();
    assert.equal(orderPosts().length, 2, 'locked: nothing placed after it');
    assert.equal(windows.length, 1);
  });

  test('/checkout: EARLIER_ORDER_PAID for other pieces (an earlier Buy Now) → that order’s confirmation page; the cart is kept', async () => {
    earlierOrder('o0', { body: { items: [{ product: 'p2', quantity: 1 }], couponCode: null, shippingAddress: { email: 'new@x.test' }, payment: { method: 'razorpay' } } });
    signInAs(NEW);
    seedCart(PIECE, 1);
    overrides.set('POST /api/orders', earlierPaid('o0'));
    const page = mountPage(() => CheckoutPage());
    await settle();
    router.push.mock.resetCalls();
    await submit(page);
    assert.deepEqual(toastTexts(toast), [EARLIER_PAID]);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ-o0&email=new%40x.test']);
    assert.deepEqual(cart.items.map((i) => [i._id, i.quantity]), [['p1', 1]], 'the jhumka was not bought: still in the cart');
    assert.deepEqual(payFor(), []);

    /* The look-up fails: not known to be this basket — kept too. */
    leavePage();
    router.push.mock.resetCalls();
    overrides.set('GET /api/orders/:id', () => ({ status: 502 }));
    const again = mountPage(() => CheckoutPage());
    await settle();
    router.push.mock.resetCalls();
    await submit(again);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/account']);
    assert.equal(cart.items.length, 1);
  });

  test('EARLIER_ORDER_PAID and the look-up fails → My Orders (the message says it is confirmed); still nothing placed', async () => {
    signInAs(NEW);
    const { h, p } = mountFlow();
    await settle();
    overrides.set('POST /api/orders', earlierPaid('o0'));
    overrides.set('GET /api/orders/:id', () => ({ status: 502 }));
    await h.result.placeOrder();
    await settle();
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/account']);
    assert.deepEqual(lastNotice(p), ['info', EARLIER_PAID, { icon: '✅' }]);
    assert.equal(windows.length, 0);
    leavePage();

    /* A guest has no My Orders (and can't look orders up): order tracking. */
    signInAs(null);
    router.push.mock.resetCalls();
    overrides.set('GET /api/orders/:id', () => ({ status: 401, json: { success: false, message: 'Unauthorized' } }));
    const guest = mountFlow();
    await settle();
    for (const [k, v] of Object.entries({ fullName: 'Guest', phone: '9123456780', email: 'g@x.test', street: '1 Main Rd', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001' })) guest.h.result.updateForm(k, v);
    await settle();
    await guest.h.result.placeOrder();
    await settle();
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/track-order']);
  });

  test('EARLIER_PAYMENT_PENDING (in progress, or Razorpay couldn’t be asked): the server’s message, nothing placed or cancelled, the button free — the next tap places the order', async () => {
    const { h, p } = await keptAttempt();
    p.lines = [{ product: 'p1', quantity: 2 }]; p.subtotal = 3000;
    h.rerender();
    await settle();
    for (const message of [PENDING_IN_PROGRESS, PENDING_UNKNOWN]) {
      overrides.set('POST /api/orders', stillPending(message));
      await h.result.placeOrder();
      await settle();
      assert.deepEqual(lastNotice(p), ['info', message, { icon: 'ℹ️', duration: 15000 }]);
      assert.equal(h.result.loading, false);
      assert.equal(h.result.placed, false);
      assert.deepEqual(payFor(), ['o1'], 'no payment started');
      assert.equal(windows.length, 1);
      assert.equal(router.push.mock.callCount(), 0);
      assert.equal(p.onOrderPlaced.mock.callCount(), 0);
    }
    overrides.clear();
    await h.result.placeOrder();
    await settle();
    assert.equal(world.orders.get('o2').total, h.result.payableTotal);
    assert.equal(windows.at(-1).options.order_id, 'order_rzp_o2');
  });

  test('drawer: EARLIER_PAYMENT_PENDING shows beside the button, which is free again', async () => {
    signInAs(NEW);
    overrides.set('POST /api/orders', stillPending(PENDING_IN_PROGRESS));
    const drawer = openDrawer(1);
    await settle();
    await submit(drawer);
    const note = find(drawer.result, (el) => (el.props?.role === 'alert' || el.props?.role === 'status') && textOf(el).includes(PENDING_IN_PROGRESS));
    assert.equal(note?.props.role, 'status', 'a note, not an error: nothing went wrong');
    assert.equal(submitButton(drawer.result).props.disabled, false);
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,599');
    assert.equal(windows.length, 0);
  });
});

/* ═════════════ B: paid after the cancel → a refund, never the confirmation page ═════════════ */

describe('B: a payment on an attempt already replaced or cancelled is refunded — never the confirmation page', { skip }, () => {
  test('verify 409 PAID_AFTER_CANCEL (replaced from another tab while the window was open): the server’s message, no confirmation page, the attempt forgotten — the next tap places a fresh order', async () => {
    signInAs(NEW);
    const { h, p } = mountFlow();
    await settle();
    await h.result.placeOrder();
    await settle();
    Object.assign(world.orders.get('o1'), { status: 'cancelled', cancelReason: 'replaced' });
    await payInWindow(windows[0]);
    assert.deepEqual(calls('POST', '/api/payments/verify').map((c) => c.status), [409]);
    assert.deepEqual(lastNotice(p), ['info', PAID_AFTER_CANCEL, { icon: 'ℹ️', duration: 15000 }]);
    assert.equal(router.push.mock.callCount(), 0, 'never /order-success');
    assert.equal(p.onOrderPlaced.mock.callCount(), 0);
    assert.equal(h.result.placed, false);
    assert.equal(h.result.verifying, false);

    await h.result.placeOrder();
    await settle();
    assert.deepEqual(payFor(), ['o1', 'o2'], 'a fresh order — the refunded attempt isn’t tried again');
    assert.equal(orderPosts().length, 2);
    assert.equal(windows.at(-1).options.order_id, 'order_rzp_o2');
  });

  test('switched to COD, and the kept attempt turns out cancelled AND paid (a late payment): the refund message — not its confirmation page; nothing placed; the next tap places the COD order', async () => {
    const { h, p } = await keptAttempt();
    Object.assign(world.orders.get('o1'), { status: 'cancelled', cancelReason: 'expired', paid: true, paidAfterCancel: true });
    h.result.setPaymentMethod('cod');
    await settle();
    await h.result.placeOrder();
    await settle();
    assert.equal(router.push.mock.callCount(), 0, 'was the confirmation page of a refunded attempt');
    assert.equal(p.onOrderPlaced.mock.callCount(), 0);
    assert.deepEqual(lastNotice(p), ['info', EARLIER_REFUNDED, { icon: 'ℹ️', duration: 15000 }]);
    assert.equal(calls('PUT').length, 0, 'already cancelled');
    assert.equal(orderPosts().length, 1);

    await h.result.placeOrder();
    await settle();
    assert.equal(world.orders.get('o2').body.payment.method, 'cod');
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ2&email=new%40x.test']);
  });

  test('the cancel can’t be sent (offline) and the look-up after it finds the attempt cancelled and paid: the same', async () => {
    const { h, p } = await keptAttempt();
    let reads = 0;
    overrides.set('GET /api/orders/:id', ({ id }) => {
      reads += 1;
      if (reads === 2) Object.assign(world.orders.get(id), { status: 'cancelled', paid: true, paidAfterCancel: true });
      return serveDefault('GET', `/api/orders/${id}`);
    });
    overrides.set('PUT /api/orders/:id', () => new TypeError('Failed to fetch'));
    h.result.setPaymentMethod('cod');
    await settle();
    await h.result.placeOrder();
    await settle();
    assert.equal(reads, 2);
    assert.equal(router.push.mock.callCount(), 0);
    assert.deepEqual(lastNotice(p), ['info', EARLIER_REFUNDED, { icon: 'ℹ️', duration: 15000 }]);
    assert.equal(orderPosts().length, 1);
  });

  test('a code-less create-order refusal; the look-up finds the kept attempt cancelled and paid → the refund message, not the confirmation page', async () => {
    const { h, p } = await keptAttempt();
    Object.assign(world.orders.get('o1'), { status: 'cancelled', cancelReason: 'expired', paid: true, paidAfterCancel: true });
    overrides.set('POST /api/payments/create-order', () => ({ status: 502, json: { success: false, message: 'Bad gateway' } }));
    await h.result.placeOrder();
    await settle();
    assert.deepEqual(calls('GET', /^\/api\/orders\//).map((c) => c.path), ['/api/orders/o1']);
    assert.equal(router.push.mock.callCount(), 0);
    assert.equal(h.result.placed, false);
    assert.deepEqual(lastNotice(p), ['info', EARLIER_REFUNDED, { icon: 'ℹ️', duration: 15000 }]);
    assert.equal(orderPosts().length, 1, 'nothing placed in that tap');
  });

  test('a paid, still-open attempt (the webhook confirmed it) is still its confirmation page', async () => {
    const { h, p } = await keptAttempt();
    Object.assign(world.orders.get('o1'), { status: 'confirmed', paid: true });
    h.result.setPaymentMethod('cod');
    await settle();
    await h.result.placeOrder();
    await settle();
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), ['/order-success?orderNumber=TBJ1&email=new%40x.test']);
    assert.equal(p.onOrderPlaced.mock.callCount(), 1);
  });
});

/* The model's own answer, for an override that only changes some cases. */
function serveDefault(method, p, body) {
  const id = /^\/api\/orders\/([^/]+)$/.exec(p)?.[1];
  const keys = [`${method} ${p}`, id && `${method} /api/orders/:id`].filter(Boolean);
  const saved = keys.map((k) => [k, overrides.get(k)]);
  keys.forEach((k) => overrides.delete(k));
  try { return serve(method, p, body); } finally { for (const [k, v] of saved) if (v) overrides.set(k, v); }
}

/* ═════════════ D: the points discount shown is sent, and checked ═════════════ */

describe('D: the points discount shown goes with the order; 409 LOYALTY_CHANGED shows the server’s figure', { skip }, () => {
  test('/checkout and the drawer send the points discount shown; a flow without points, and a guest, send none', async () => {
    world.parked = 100;
    signInAs(NEW);
    seedCart(PIECE, 1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    assert.equal(orderPosts()[0].body.loyaltyDiscount, 100);
    leavePage();

    world.parked = 100;
    const drawer = openDrawer(1);
    await settle();
    await submit(drawer);
    assert.equal(orderPosts()[1].body.loyaltyDiscount, 100);
    leavePage();

    const plain = mountFlow();
    await settle();
    await plain.h.result.placeOrder();
    await settle();
    assert.equal('loyaltyDiscount' in orderPosts()[2].body, false, 'a checkout without points says nothing about them');
    leavePage();

    signInAs(null);
    const guest = mountFlow({ withParkedLoyalty: true });
    await settle();
    for (const [k, v] of Object.entries({ fullName: 'Guest', phone: '9123456780', email: 'g@x.test', street: '1 Main Rd', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001' })) guest.h.result.updateForm(k, v);
    await settle();
    await guest.h.result.placeOrder();
    await settle();
    assert.equal(orderPosts()[3].body.guestEmail, 'g@x.test');
    assert.equal('loyaltyDiscount' in orderPosts()[3].body, false, 'a guest has no points');
  });

  test('/checkout: the points didn’t load (₹0 shown) but ₹100 is parked → sent as 0 → LOYALTY_CHANGED: nothing ordered, the server’s figure shown; the next tap is charged the button', async () => {
    world.parked = 100;
    signInAs(NEW);
    seedCart(PIECE, 1);
    overrides.set('GET /api/loyalty', () => ({ status: 500, json: { success: false, message: 'boom' } }));
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,599');
    await submit(page);
    const [first] = orderPosts();
    assert.equal(first.body.loyaltyDiscount, 0, 'the 0 shown is sent — the case the server must catch');
    assert.equal(first.status, 409);
    assert.equal(world.orders.size, 0);
    assert.equal(windows.length, 0);
    assert.deepEqual(toastTexts(toast), ['Your points discount is now ₹100. Please check your total and place the order again.']);
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,499', 'the server’s figure');
    assert.match(textOf(page.result), /Points Discount-₹100/);

    await submit(page);
    const [o] = world.orders.values();
    assert.equal(o.body.loyaltyDiscount, 100);
    assert.equal(o.total, rupees(label), 'charged the button');
    assert.equal(windows[0].options.amount, rupees(label) * 100);
  });

  test('drawer: ₹1,000 parked on a ₹1,500 piece → the server’s parked amount is capped on screen (₹300) exactly as the server caps it; converges', async () => {
    world.parked = 1000;
    signInAs(NEW);
    overrides.set('GET /api/loyalty', () => ({ status: 500, json: { success: false } }));
    const drawer = openDrawer(1);
    await settle();
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,599');
    await submit(drawer);
    assert.match(textOf(drawer.result), /Your points discount is now ₹300\. Please check your total and place the order again\./);
    assert.match(textOf(drawer.result), /Points discount−₹300/);
    const label = buttonLabel(drawer.result);
    assert.equal(label, 'Place order · ₹1,299');
    assert.equal(world.orders.size, 0);
    await submit(drawer);
    const [o] = world.orders.values();
    assert.equal(o.total, rupees(label));
    assert.equal(world.parked, 700, 'the rest stays parked');
  });

  test('points redeemed on this page, then another tab spent most of them: the server’s figure replaces parked + redeemed (no double count)', async () => {
    world.parked = 100;
    world.points = 150;
    signInAs(NEW);
    seedCart(PIECE, 1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await byText(page.result, /^Use Points$/).props.onClick();
    await settle();
    assert.match(textOf(page.result), /Points Discount-₹250/);
    world.parked = 50; // an order in another tab took ₹200 of it
    await submit(page);
    assert.equal(orderPosts()[0].status, 409);
    assert.match(textOf(page.result), /Points Discount-₹50/);
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,549');
    await submit(page);
    const [o] = world.orders.values();
    assert.equal(o.total, rupees(label));
    assert.equal(o.loyaltyDiscount, 50);
  });

  test('an answer without parkedDiscount (an older server): the points are read again', async () => {
    signInAs(NEW);
    const { h, p } = mountFlow({ withParkedLoyalty: true });
    await settle();
    world.parked = 100; // parked after the page loaded
    overrides.set('POST /api/orders', () => ({ status: 409, json: { success: false, code: 'LOYALTY_CHANGED', loyaltyDiscount: 100 } }));
    await h.result.placeOrder();
    await settle();
    assert.equal(calls('GET', '/api/loyalty').length, 2);
    assert.equal(h.result.loyaltyDiscount, 100);
    assert.deepEqual(lastNotice(p), ['info', 'Your points discount is now ₹100. Please check your total and place the order again.', { icon: 'ℹ️', duration: 10000 }]);
    overrides.clear();
    await h.result.placeOrder();
    await settle();
    assert.equal(world.orders.get('o1').total, 1500 - 100 + 99);
  });
});

/* ═════════════ E: one COD limit on both sides ═════════════ */

describe('E: COD is offered by the server’s rule — the total before points, with shipping and the COD fee', { skip }, () => {
  /* The server's preliminaryTotal (src/app/api/orders/route.js). */
  const serverRefusesCod = ({ subtotal, discount = 0, charges }) => {
    const { shipping, codFee } = computeCharges({ subtotal, paymentMethod: 'cod', charges });
    return Math.max(0, subtotal - discount + shipping + codFee) > COD_MAX_ORDER_VALUE;
  };

  test('checkoutAmounts: codBlockedByValue is exactly what the server refuses — whatever method is selected, whatever the points', () => {
    /* [subtotal, coupon, points, charges] */
    const CASES = [
      [19900, 0, 0, ALWAYS_FEES], // ₹19,900 + ₹99 + ₹49 = ₹20,048 → refused (was offered: ₹19,999 without the fee)
      [19852, 0, 0, ALWAYS_FEES], // ₹20,000 exactly → allowed
      [19853, 0, 0, ALWAYS_FEES], // ₹20,001 → refused
      [20500, 0, 600, DEFAULT_CHARGES], // points don't lift the limit (was offered)
      [20500, 600, 0, DEFAULT_CHARGES], // a coupon does
      [20000, 0, 0, DEFAULT_CHARGES],
      [400, 0, 0, DEFAULT_CHARGES],
    ];
    for (const [subtotal, discount, loyaltyDiscount, charges] of CASES) {
      const refused = serverRefusesCod({ subtotal, discount, charges });
      for (const paymentMethod of ['razorpay', 'cod']) {
        const a = checkoutAmounts({ subtotal, discount, loyaltyDiscount, paymentMethod, charges });
        assert.equal(a.codBlockedByValue, refused, `₹${subtotal} − ₹${discount} coupon, ₹${loyaltyDiscount} points, ${paymentMethod} selected`);
      }
    }
    assert.equal(checkoutAmounts({ subtotal: 19900, paymentMethod: 'razorpay', charges: ALWAYS_FEES }).codBlockedByValue, true);
    assert.equal(checkoutAmounts({ subtotal: 20500, loyaltyDiscount: 600, paymentMethod: 'cod', charges: DEFAULT_CHARGES }).codBlockedByValue, true);
  });

  test('/checkout: ₹100 of points on a ₹19,900 piece, ₹99 delivery, ₹49 COD fee → COD isn’t offered (₹20,048 before points), so it can’t be refused after the tap', async () => {
    world.charges = ALWAYS_FEES;
    world.parked = 100;
    signInAs(NEW);
    seedCart(HARAM, 1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(cart.charges.cod_fee_waive_above, null, 'the store’s current charges');
    const fields = paymentFields(page.result);
    assert.equal(codRadio(fields).props.disabled, true, 'was offered (₹19,999 − ₹100 points)');
    assert.match(textOf(fields), /Cash on DeliveryNot available above ₹20,000/);
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    assert.equal(flowOf(page.result).paymentMethod, 'razorpay');
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹19,899');
    await submit(page);
    const [o] = world.orders.values();
    assert.equal(o.body.payment.method, 'razorpay');
    assert.equal(o.total, rupees(label));
  });

  test('the flow: over the limit only because of the COD fee → not offered; a coupon brings it under → offered, and the order goes through at the button', async () => {
    world.charges = ALWAYS_FEES;
    cart = { charges: ALWAYS_FEES, refreshCharges: async () => ALWAYS_FEES };
    signInAs(NEW);
    const over = mountFlow({ lines: [{ product: 'p2', quantity: 1 }], subtotal: 19900 });
    await settle();
    assert.equal(over.h.result.paymentMethod, 'razorpay');
    assert.equal(over.h.result.codBlockedByValue, true, '₹19,999 online, ₹20,048 with COD: the server refuses COD');
    leavePage();
    const ok = mountFlow({ lines: [{ product: 'p2', quantity: 1 }], subtotal: 19900, discount: 1990, couponCode: 'TULSI10' });
    await settle();
    assert.equal(ok.h.result.codBlockedByValue, false);
    ok.h.result.setPaymentMethod('cod');
    await settle();
    const shown = ok.h.result.payableTotal;
    assert.equal(shown, 19900 - 1990 + 99 + 49);
    await ok.h.result.placeOrder();
    await settle();
    const [o] = world.orders.values();
    assert.equal(o.total, shown);
  });
});

/* ═════════════ F: the kept attempt was replaced by a newer order ═════════════ */

describe('F: create-order ORDER_CANCELLED replaced:true → nothing is placed for the customer; the next tap places a fresh order', { skip }, () => {
  test('Pay again → replaced: the message, nothing placed in that tap, the attempt forgotten — the next tap places a fresh order', async () => {
    const { h, p } = await keptAttempt();
    Object.assign(world.orders.get('o1'), { status: 'cancelled', cancelReason: 'replaced' });
    await h.result.placeOrder();
    await settle();
    assert.equal(orderPosts().length, 1, 'no fresh order in the same tap (it may be the newer order they wanted)');
    assert.equal(windows.length, 1);
    assert.deepEqual(p.notify.mock.calls.map((c) => c.arguments), [['info', 'Payment cancelled. Your order was not placed.', { icon: 'ℹ️' }], ['info', REPLACED, { icon: 'ℹ️', duration: 15000 }]]);

    await h.result.placeOrder();
    await settle();
    assert.deepEqual(payFor(), ['o1', 'o1', 'o2'], 'the replaced attempt isn’t tried again');
    assert.equal(orderPosts().length, 2);
    assert.equal(windows.at(-1).options.order_id, 'order_rzp_o2');
    assert.equal(windows.at(-1).options.amount, h.result.payableTotal * 100);
  });

  test('/checkout with points the newer order took: one message, and the total is brought up to date — the next tap is charged it', async () => {
    world.parked = 100;
    signInAs(NEW);
    seedCart(PIECE, 1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,499');
    await submit(page);
    closeWindow();
    toast.mock.resetCalls();
    Object.assign(world.orders.get('o1'), { status: 'cancelled', cancelReason: 'replaced' }); // its ₹100 went with the newer order
    await submit(page);
    assert.deepEqual(toastTexts(toast), [REPLACED]);
    assert.equal(orderPosts().length, 1);
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,599');
    await submit(page);
    const o2 = world.orders.get('o2');
    assert.equal(o2.total, rupees(label));
    assert.equal(o2.body.loyaltyDiscount, 0);
  });

  test('switched to COD and the look-up finds the kept attempt replaced: told the same; nothing placed in that tap', async () => {
    const { h, p } = await keptAttempt();
    Object.assign(world.orders.get('o1'), { status: 'cancelled', cancelReason: 'replaced' });
    h.result.setPaymentMethod('cod');
    await settle();
    await h.result.placeOrder();
    await settle();
    assert.deepEqual(lastNotice(p), ['info', REPLACED, { icon: 'ℹ️', duration: 15000 }]);
    assert.equal(orderPosts().length, 1, 'was a COD order beside the newer one');
    await h.result.placeOrder();
    await settle();
    assert.equal(world.orders.get('o2').body.payment.method, 'cod');
  });

  test('a brand-new order answered replaced (another tab, the same instant): told, nothing more placed', async () => {
    signInAs(NEW);
    const { h, p } = mountFlow();
    await settle();
    overrides.set('POST /api/payments/create-order', () => ({ status: 409, json: { success: false, code: 'ORDER_CANCELLED', replaced: true, message: 'This payment attempt was replaced by your newer order, so it can’t be paid. Please check My Orders.' } }));
    await h.result.placeOrder();
    await settle();
    assert.equal(orderPosts().length, 1);
    assert.deepEqual(lastNotice(p), ['info', REPLACED, { icon: 'ℹ️', duration: 15000 }]);
  });

  test('ORDER_CANCELLED without replaced (expired, or cancelled by the store): a fresh order in the same tap, as before', async () => {
    const { h, p } = await keptAttempt();
    Object.assign(world.orders.get('o1'), { status: 'cancelled', cancelReason: 'expired' });
    await h.result.placeOrder();
    await settle();
    assert.equal(orderPosts().length, 2);
    assert.deepEqual(payFor(), ['o1', 'o1', 'o2']);
    assert.equal(windows.length, 2);
    assert.equal(p.notify.mock.calls.filter((c) => c.arguments[0] === 'error').length, 0);
  });
});

/* ═════════════ BN-4: the reload keeps the page's other parameters ═════════════ */

describe('BN-4: Buy Now’s code fails to load → the reload keeps the page’s utm_* parameters', { skip }, () => {
  function productPage({ search = '', chunk = () => 'fail', realReturn = false } = {}) {
    const Drawer = function BuyNowDrawerStub() { return null; };
    globalThis.window.location = { search, pathname: '/product/p1', hash: '#reviews', assign: mock.fn() };
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
        if (chunk() === 'fail') throw Object.assign(new Error('Loading chunk 812 failed.'), { name: 'ChunkLoadError' });
        return esm(Drawer);
      },
    });
    const ProductDetail = makeLoader(stubs)('app/product/[id]/ProductDetail.js').default;
    const initialProduct = { ...PIECE, isActive: true };
    const page = mountHook(() => ProductDetail({ initialProduct }));
    return { page, Drawer, assign: globalThis.window.location.assign };
  }

  test('a failed load from an ad link: the reload keeps utm_source / utm_campaign and adds buynow', async () => {
    signInAs(NEW);
    const { page, assign } = productPage({ search: '?utm_source=instagram&utm_campaign=bridal+week' });
    await settle();
    byLabel(page.result, 'Increase quantity').props.onClick();
    await settle();
    byText(page.result, /Buy Now/).props.onClick();
    await settle();
    assert.deepEqual(assign.mock.calls.map((c) => c.arguments[0]), ['/product/p1?utm_source=instagram&utm_campaign=bridal+week&buynow=2'], 'was /product/p1?buynow=2 — the visit lost its campaign');
    assert.deepEqual(toastTexts(toast), ['Opening checkout…']);
    assert.equal(toast.error.mock.callCount(), 0);
  });

  test('the reloaded page opens the drawer and drops only buynow (the campaign stays in the address)', async () => {
    signInAs(NEW);
    const { page, Drawer, assign } = productPage({ search: '?utm_source=instagram&buynow=2', chunk: () => 'ok', realReturn: true });
    await settle();
    assert.deepEqual(router.replace.mock.calls.map((c) => c.arguments[0]), ['/product/p1?utm_source=instagram#reviews']);
    assert.equal(find(page.result, (el) => el.type === Drawer)?.props.qty, 2);
    assert.equal(assign.mock.callCount(), 0);
  });

  test('buyNowReturnPath / buyNowLoadFailure: other parameters kept, a stale buynow replaced, no search → as before', () => {
    assert.equal(buyNowReturnPath('p1', 3, '?utm_source=ig&buynow=1&ref=story'), '/product/p1?utm_source=ig&buynow=3&ref=story');
    assert.equal(buyNowReturnPath('p1', 2), '/product/p1?buynow=2');
    assert.equal(buyNowReturnPath('p1', 2, ''), '/product/p1?buynow=2');
    assert.equal(buyNowReturnPath('a b/c', 0, '?q=gold%20set'), '/product/a%20b%2Fc?q=gold+set&buynow=1');
    assert.deepEqual(buyNowLoadFailure({ productId: 'p1', qty: 2, openedWithBuyNow: false, search: '?utm_medium=cpc' }), { reloadTo: '/product/p1?utm_medium=cpc&buynow=2', message: 'Opening checkout…' });
    assert.deepEqual(buyNowLoadFailure({ productId: 'p1', qty: 2, openedWithBuyNow: true, search: '?utm_medium=cpc' }), { reloadTo: null, message: 'Couldn’t open checkout — please refresh the page' });
    assert.equal(buyNowSignInUrl('p1', 2), '/login?callbackUrl=%2Fproduct%2Fp1%3Fbuynow%3D2', 'the sign-in link is unchanged');
  });
});
