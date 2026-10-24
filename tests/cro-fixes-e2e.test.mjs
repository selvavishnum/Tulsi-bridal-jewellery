/* ─────────────────────────────────────────────
   CRO fixes — the shopper's screens wired to the REAL server.

   The reviewers reproduced most findings by running the checkout hooks
   against the real route handlers (cro-review2/checkout-coupons, -race,
   -hook-repro, -verify-bn3, coupon-repro). These are those reproductions
   as regression tests, end to end:

     the real CartProvider (reducer, derived discount, localStorage)
     + /cart, /checkout, the Buy Now drawer, the welcome strip and the
       admin coupon form (transpiled with sucrase, run by a tiny hook
       runner — no DOM)
     → fetch → the real POST/GET/PUT route handlers on an in-memory
       Firestore (its transactions held to real Firestore's reads-before-
       writes rule), with the Razorpay SDK and checkout window faked.

   Every test checks the guiding rule where it applies: the amount on the
   Place-order button is the amount the server stores and Razorpay asks
   for; an abandoned online payment never costs the coupon or the points.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { fakeFirestore, INC } from './helpers/fakeFirestore.mjs';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
delete process.env.SHIPROCKET_EMAIL;

/* ═════════════ Server: real routes, fake edges ═════════════ */

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let serverSession = null;
const getServerSession = async () => serverSession;

const rzp = { orders: new Map(), payments: new Map(), creates: 0 };
class FakeRazorpay {
  constructor() {
    this.orders = {
      create: async (o) => {
        rzp.creates += 1;
        const order = { id: `order_${rzp.creates}`, entity: 'order', amount: o.amount, currency: 'INR', receipt: o.receipt, status: 'created' };
        rzp.orders.set(order.id, order);
        return { ...order };
      },
      fetch: async (id) => ({ ...rzp.orders.get(id) }),
      fetchPayments: async (id) => ({ items: [...rzp.payments.values()].filter((p) => p.order_id === id).map((p) => ({ ...p })) }),
    };
    this.payments = { fetch: async (id) => ({ ...rzp.payments.get(id) }) };
  }
}

mock.module('razorpay', { defaultExport: FakeRazorpay });
mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db, getBucket: () => null,
    FieldValue: { increment: (n) => ({ [INC]: n }), serverTimestamp: () => new Date().toISOString() },
    Timestamp: class {},
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    toPublicProduct: (p) => p, paginate: async () => ({}), newId: () => `id${Date.now()}`,
  },
});
const noop = async () => {};
mock.module(src('lib/email.js'), { namedExports: { ...Object.fromEntries(['sendOTPEmail', 'sendOrderConfirmation', 'sendOrderNotificationToAdmin', 'sendStatusUpdateEmail', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'sendVendorOrderNotification', 'isConfigured'].map((n) => [n, noop])), esc: (v) => String(v ?? '') } });
mock.module(src('lib/whatsapp.js'), { namedExports: Object.fromEntries(['sendOrderWhatsAppToAdmin', 'sendOrderWhatsAppToCustomer', 'sendStatusWhatsApp', 'sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])) });

const route = (p) => import(src(`app/api/${p}/route.js`));
const [orders, orderById, validate, createOrder, verify, siteSettings, address, loyalty, storeCharges, coupons, couponById, announcement] = await Promise.all([
  route('orders'), route('orders/[id]'), route('coupons/validate'), route('payments/create-order'), route('payments/verify'),
  route('admin/settings'), route('user/address'), route('loyalty'), route('store-charges'), route('coupons'), route('coupons/[id]'),
  route('announcement'),
]);

/* The browser's fetch → the route handlers. [method, path, module, param] */
const ROUTES = [
  ['POST', /^\/api\/orders$/, orders],
  ['GET', /^\/api\/orders\/([^/]+)$/, orderById, 'id'],
  ['PUT', /^\/api\/orders\/([^/]+)$/, orderById, 'id'],
  ['POST', /^\/api\/coupons\/validate$/, validate],
  ['POST', /^\/api\/payments\/create-order$/, createOrder],
  ['POST', /^\/api\/payments\/verify$/, verify],
  ['GET', /^\/api\/admin\/settings$/, siteSettings],
  ['GET', /^\/api\/user\/address$/, address],
  ['GET', /^\/api\/loyalty$/, loyalty],
  ['POST', /^\/api\/loyalty$/, loyalty],
  ['GET', /^\/api\/store-charges$/, storeCharges],
  ['GET', /^\/api\/announcement$/, announcement],
  ['GET', /^\/api\/coupons$/, coupons],
  ['POST', /^\/api\/coupons$/, coupons],
  ['PUT', /^\/api\/coupons\/([^/]+)$/, couponById, 'id'],
];
let wire = []; // every request: { method, path, body, status }
let fixedIp = null;
let ipN = 0;
const nextIp = () => fixedIp || `10.13.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
/* A gate holds an answer until the test opens it: the server has decided,
   the response is still on its way (a slow mobile network). */
const gates = new Map();
function gate(key) {
  let open;
  const promise = new Promise((r) => { open = r; });
  gates.set(key, promise);
  return () => { gates.delete(key); open(); };
}
/* Something that happens on the server just before a request is handled
   (e.g. Razorpay's webhook landing), once. */
const before = [];
const onceBefore = (method, re, fn) => before.push({ method, re, fn });
let inflight = 0;
let parked = 0;
globalThis.fetch = async (url, init = {}) => {
  inflight += 1;
  try {
    const u = new URL(String(url), 'http://tulsi.test');
    const method = (init.method || 'GET').toUpperCase();
    const hit = ROUTES.find(([m, re]) => m === method && re.test(u.pathname));
    if (!hit) throw new TypeError(`Failed to fetch (no route for ${method} ${u.pathname})`);
    const [, re, mod, key] = hit;
    const entry = { method, path: u.pathname, body: init.body ? JSON.parse(init.body) : undefined };
    wire.push(entry);
    const params = key ? { [key]: decodeURIComponent(re.exec(u.pathname)[1]) } : {};
    const hook = before.findIndex((b) => b.method === method && b.re.test(u.pathname));
    if (hook >= 0) await before.splice(hook, 1)[0].fn(params);
    const res = await mod[method](new Request(u, {
      method,
      headers: { ...(init.headers || {}), 'x-forwarded-for': nextIp() },
      ...(init.body !== undefined && { body: init.body }),
    }), { params: Promise.resolve(params) });
    entry.status = res.status;
    const held = gates.get(`${method} ${u.pathname}`);
    if (held) { parked += 1; await held; parked -= 1; }
    return res;
  } finally {
    inflight -= 1;
  }
};
const calls = (method, p) => wire.filter((c) => c.method === method && (p instanceof RegExp ? p.test(c.path) : c.path === p));

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
    constructor(options) { this.options = options; this.events = {}; windows.push(this); }
    on(event, cb) { this.events[event] = cb; }
    open() { this.opened = true; }
  },
};
globalThis.localStorage = globalThis.window.localStorage;
globalThis.document = {
  visibilityState: 'visible', activeElement: null, body: { style: {} }, documentElement: { clientWidth: 1024 },
  addEventListener() {}, removeEventListener() {},
};
/* The shopper closes the payment window without paying. */
const closeWindow = (w = windows.at(-1)) => w.options.modal.ondismiss();
/* The shopper pays in the window: Razorpay records it, then hands back the signed ids. */
async function payInWindow(w = windows.at(-1)) {
  const o = rzp.orders.get(w.options.order_id);
  o.status = 'paid';
  const pay = { id: `pay_${rzp.payments.size + 1}`, order_id: o.id, status: 'captured', amount: o.amount, currency: 'INR' };
  rzp.payments.set(pay.id, pay);
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${o.id}|${pay.id}`).digest('hex');
  await w.options.handler({ razorpay_order_id: o.id, razorpay_payment_id: pay.id, razorpay_signature: signature });
}

/* ═════════════ Client modules: sucrase + a tiny hook runner ═════════════ */

const require = createRequire(import.meta.url);
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the pages and hooks cannot be transpiled for node --test';

const SRC = path.resolve('src');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const REAL = new Set(['react/jsx-runtime', 'date-fns']);
/* `expose` appends exports to a file before transpiling (module-private
   pieces a test drives directly, e.g. the drawer's dialog). */
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

/* Everything settles: no request in flight (gated ones aside), renders done. */
async function settle() {
  let quiet = 0;
  for (let i = 0; i < 2000; i += 1) {
    await new Promise((r) => setImmediate(r));
    if (inflight === parked) { quiet += 1; if (quiet >= 6) return; } else quiet = 0;
  }
  throw new Error('the page never settled');
}

/* Shared browser-side stubs. */
const sessionState = { data: null, status: 'unauthenticated' };
function signInAs(user) {
  serverSession = user ? { user } : null;
  sessionState.data = user ? { user: { id: user.id, name: user.name || 'Priya', email: user.email } } : null;
  sessionState.status = user ? 'authenticated' : 'unauthenticated';
}
const router = { push: mock.fn(), replace: mock.fn(), prefetch() {} };
const toast = Object.assign(mock.fn(), { error: mock.fn(), success: mock.fn(), dismiss() {} });
const icons = new Proxy({}, { get: (_, name) => (typeof name === 'string' && /^Fi/.test(name) ? function Icon() { return null; } : undefined), has: () => true });
let cart = null; // the real CartProvider's value, refreshed on every render

const providerModule = sucrase ? makeLoader({ react: fakeReact, '@/lib/analytics/tracker': { track() {} } })('context/CartContext.js') : null;
const CartProvider = providerModule?.CartProvider;
const loadApp = sucrase ? makeLoader({
  react: fakeReact,
  'next/navigation': { useRouter: () => router },
  'next-auth/react': { useSession: () => sessionState },
  'react-hot-toast': esm(toast),
  'next/image': esm(function Image() { return null; }),
  'next/link': esm(function Link() { return null; }),
  'react-icons/fi': icons,
  '@/context/CartContext': { useCart: () => cart },
  '@/lib/loadRazorpay': { loadRazorpayScript: async () => {} },
  '@/lib/analytics/tracker': { track() {} },
}, {
  'components/checkout/BuyNowDrawer.jsx': 'export { BuyNowDialog as __BuyNowDialog };',
  'app/admin/coupons/page.js': 'export { toForm as __toForm, toPayload as __toPayload, EMPTY as __EMPTY };',
}) : null;
const app = (p) => loadApp(p);
const CartPage = sucrase ? app('app/cart/page.js').default : null;
const CheckoutPage = sucrase ? app('app/checkout/page.js').default : null;
const BuyNowDialog = sucrase ? app('components/checkout/BuyNowDrawer.jsx').__BuyNowDialog : null;
const WelcomeBar = sucrase ? app('components/layout/WelcomeBar.jsx').default : null;
const useCheckoutFlow = sucrase ? app('components/checkout/useCheckoutFlow.js').default : null;
const adminCoupons = sucrase ? app('app/admin/coupons/page.js') : null;
const { DEFAULT_CHARGES } = sucrase ? app('lib/storeCharges.js') : {};
const { settlePaidOrder } = await import(src('lib/settlePayment.js'));

/* A page in the shop: the real CartProvider above it, as the layout has it. */
const mounted = new Set();
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

/* ── Reading the element tree a page returned ── */
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
const byText = (tree, re) => find(tree, (el) => el.type === 'button' && re.test(textOf(el)));
async function submit(page) {
  const form = find(page.result, (el) => el.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  await settle();
}

/* ═════════════ The shop ═════════════ */

const NEW = { id: 'u-new', email: 'new@x.test', emailVerified: true, name: 'Priya' };
const RETURNING = { id: 'u-old', email: 'old@x.test', emailVerified: true, name: 'Meena' };
const savedAddress = (phone) => ({ id: 'a1', fullName: 'Priya R', phone, street: '12 Temple St', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001' });
const PIECE = { _id: 'p1', id: 'p1', name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 5, images: [] };
const COUPON = { type: 'percentage', maxUses: 0, usedCount: 0, usedBy: [], isActive: true, minOrderAmount: 0, maxDiscount: null, startsAt: null, expiresAt: null };

/* Real Firestore refuses a read after a write inside a transaction; the
   in-memory fake doesn't, so every transaction here is held to that rule. */
function strictTransactions(fake) {
  const run = fake.runTransaction.bind(fake);
  fake.runTransaction = (fn) => run((tx) => {
    let wrote = false;
    const write = (op) => (...args) => { wrote = true; return tx[op](...args); };
    return fn({
      get: (target) => {
        if (wrote) throw new Error('Firestore transactions require all reads to be executed before all writes.');
        return tx.get(target);
      },
      set: write('set'), update: write('update'), delete: write('delete'),
    });
  });
  return fake;
}

const seedCart = (...lines) => local.set('tulsi-cart', JSON.stringify({ items: lines.map(([qty, piece = PIECE]) => ({ ...piece, quantity: qty })), coupon: null, discount: 0, discountAt: null }));
const remember = (code) => local.set('tj-pending-coupon', JSON.stringify({ code, at: Date.now() }));
const pending = () => { try { return JSON.parse(local.get('tj-pending-coupon')).code; } catch { return null; } };
const couponDoc = (id = 'welcome') => db.store.get('coupons').get(id);
const orderList = () => [...db.store.get('orders').entries()].map(([id, o]) => ({ id, ...o }));
const newOrders = () => orderList().filter((o) => o.id !== 'paid');
const userDoc = (id) => db.store.get('users').get(id);

function resetWorld() {
  leavePage();
  serverSession = null;
  sessionState.data = null; sessionState.status = 'unauthenticated';
  rzp.orders.clear(); rzp.payments.clear(); rzp.creates = 0;
  wire = []; fixedIp = null; gates.clear(); before.length = 0;
  local.clear(); tab.clear(); listeners.clear(); windows.length = 0;
  router.push.mock.resetCalls(); router.replace.mock.resetCalls();
  toast.mock.resetCalls(); toast.error.mock.resetCalls(); toast.success.mock.resetCalls();
  db = strictTransactions(fakeFirestore({
    products: { p1: { name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 5, isActive: true } },
    coupons: {
      welcome: { ...COUPON, code: 'TULSI10', value: 10, firstOrderOnly: true },
      bigfirst: { ...COUPON, code: 'BIGFIRST', type: 'fixed', value: 500, minOrderAmount: 5000, firstOrderOnly: true },
      w5k: { ...COUPON, code: 'WELCOME5K', value: 10, minOrderAmount: 5000, firstOrderOnly: true },
      fest: { ...COUPON, code: 'FEST5', value: 5 },
    },
    orders: { paid: { orderNumber: 'TBJ1', userId: 'u-old', guestEmail: 'old@x.test', status: 'delivered', payment: { method: 'razorpay', status: 'paid' }, shippingAddress: { phone: '9811111111' } } },
    users: {
      'u-new': { email: 'new@x.test', name: 'Priya', savedAddresses: [savedAddress('9876543210')], pendingLoyaltyDiscount: 0, loyaltyPoints: 0 },
      'u-old': { email: 'old@x.test', name: 'Meena', savedAddresses: [savedAddress('9811111111')] },
    },
    settings: { site: { onlinePaymentEnabled: true, loyaltyEnabled: false } },
  }));
}
beforeEach(resetWorld);
afterEach(leavePage);

/* ═════════════ checkout/A ═════════════ */

describe('checkout-coupons A: a first-order code applied at /cart while signed out', { skip }, () => {
  test('a returning customer who then signs in hears "first order only" before ordering — and is charged what the button says', async () => {
    remember('TULSI10');
    seedCart([1]);
    const cartPage = mountPage(() => CartPage());
    await settle();
    assert.equal(cart.coupon?.code, 'TULSI10', 'the signed-out preview put it on');
    assert.equal(cart.coupon.checkedFor, null);
    assert.equal(cart.discount, 150);
    assert.match(textOf(cartPage.result), /saving ₹150/);
    leavePage(); // → /login → back to /checkout (a new page load)

    signInAs(RETURNING);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(cart.coupon, null, 'refused for this customer');
    assert.deepEqual(toast.error.mock.calls.map((c) => c.arguments[0]), ['TULSI10: This code is for your first order only.']);
    assert.equal(calls('POST', '/api/orders').length, 0, 'before any order');
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,599');

    await submit(page);
    const [o] = newOrders();
    assert.equal(o.total, rupees(label), 'charged what the button said (was ₹1,599 against a ₹1,449 button)');
    assert.equal(windows.at(-1).options.amount, rupees(label) * 100, 'Razorpay asks for the same');
    assert.equal(o.couponCode, null);
  });

  test('a first-time customer keeps it: checked for them, ₹1,449 on the button, ₹1,449 stored and asked for', async () => {
    remember('TULSI10');
    seedCart([1]);
    mountPage(() => CartPage());
    await settle();
    leavePage();

    signInAs(NEW);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(cart.coupon?.checkedFor, 'u-new');
    assert.equal(calls('POST', '/api/coupons/validate').length, 2, 'the /cart preview, then once for this customer');
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,449');
    await submit(page);
    const [o] = newOrders();
    assert.equal(o.total, 1449);
    assert.equal(o.discount, 150);
    assert.equal(windows.at(-1).options.amount, 144900);
    assert.equal(calls('POST', '/api/orders')[0].body.couponDiscount, 150, 'the discount shown is sent');
  });
});

/* ═════════════ checkout/B, BN-3, contracts 3 + 4 ═════════════ */

describe('checkout-coupons B / verify-bn3: close Razorpay, then Place order again', { skip }, () => {
  test('/checkout: the same order is paid again; switching to COD cancels it first — coupon and price kept, counted once', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,449');

    await submit(page);
    assert.equal(newOrders().length, 1);
    assert.equal(windows.length, 1);
    assert.equal(windows[0].options.amount, 144900);
    closeWindow();
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,449', 'the page still shows the discount — and it is still true');

    await submit(page);
    assert.equal(calls('POST', '/api/orders').length, 1, 'no second order');
    assert.equal(windows.length, 2);
    assert.equal(windows[1].options.order_id, windows[0].options.order_id, 'the same Razorpay order');
    assert.equal(windows[1].options.amount, 144900);
    assert.equal(rzp.creates, 1);
    assert.deepEqual(couponDoc().usedBy, ['u:u-new']);
    closeWindow();
    await settle();

    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,449', 'no COD fee above ₹500');
    await submit(page);
    assert.deepEqual(wire.filter((c) => c.path.startsWith('/api/orders')).map((c) => `${c.method} ${c.path === '/api/orders' ? c.path : '/api/orders/:id'} ${c.status}`),
      ['POST /api/orders 201', 'GET /api/orders/:id 200', 'PUT /api/orders/:id 200', 'POST /api/orders 201']);
    const [first, cod] = newOrders();
    assert.equal(first.status, 'cancelled');
    assert.equal(first.couponReleased, true);
    assert.equal(cod.payment.method, 'cod');
    assert.equal(cod.discount, 150, 'the coupon the cancel gave back is used again');
    assert.equal(cod.total, rupees(label));
    assert.deepEqual(couponDoc().usedBy, ['u:u-new']);
    assert.equal(couponDoc().usedCount, 1);
    assert.equal(router.push.mock.calls.at(-1).arguments[0], `/order-success?orderNumber=${cod.orderNumber}&email=new%40x.test`);
    assert.equal(pending(), null, 'the welcome code was spent');
    assert.equal(page.result, null, 'the cart is cleared');
  });

  test('/checkout with points: the Points Discount survives the abandoned attempt and the switch to COD', async () => {
    db.store.get('settings').set('site', { onlinePaymentEnabled: true, loyaltyEnabled: true });
    userDoc('u-new').loyaltyPoints = 100;
    signInAs(NEW);
    seedCart([1]);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await flowOf(page.result).redeemLoyaltyPoints();
    await settle();
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 100);
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,499');

    await submit(page);
    assert.equal(newOrders()[0].loyaltyDiscount, 100);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
    closeWindow();
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    const label = buttonLabel(page.result);
    await submit(page);
    const [first, cod] = newOrders();
    assert.equal(first.status, 'cancelled');
    assert.equal(first.loyaltyRestored, true);
    assert.equal(cod.loyaltyDiscount, 100, 'not lost to the abandoned attempt');
    assert.equal(cod.total, rupees(label));
    assert.equal(cod.total, 1499);
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 0);
  });

  test('a big points balance on a small order: the Points Discount shown is what the order takes (20% of the subtotal)', async () => {
    db.store.get('settings').set('site', { onlinePaymentEnabled: true, loyaltyEnabled: true });
    userDoc('u-new').loyaltyPoints = 1000; // e.g. from an earlier bridal set
    signInAs(NEW);
    seedCart([1]);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await flowOf(page.result).redeemLoyaltyPoints();
    await settle();
    assert.match(textOf(page.result), /Points Discount.*-₹300/);
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,299', 'was ₹599 — the whole ₹1,000 redemption');
    await submit(page);
    const [o] = newOrders();
    assert.equal(o.loyaltyDiscount, 300);
    assert.equal(o.total, rupees(label));
    assert.equal(userDoc('u-new').pendingLoyaltyDiscount, 700, 'the rest stays parked for a later order');
  });

  test('paid on the first window after all (late UPI): the retry goes to its confirmation, nothing is cancelled or placed twice', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    const w = windows[0];
    closeWindow(w);
    /* approved in the UPI app; no webhook yet */
    const rzpOrder = rzp.orders.get(w.options.order_id);
    rzpOrder.status = 'paid';
    rzp.payments.set('pay_late', { id: 'pay_late', order_id: rzpOrder.id, status: 'captured', amount: rzpOrder.amount, currency: 'INR' });
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    assert.equal(calls('PUT', /^\/api\/orders\//).at(-1)?.status, 409, 'the cancel is refused: ALREADY_PAID');
    assert.equal(newOrders().length, 1);
    assert.equal(newOrders()[0].status, 'confirmed', 'not cancelled — confirmed by the refused cancel (R-B), as the webhook would have');
    assert.equal(newOrders()[0].payment.razorpayPaymentId, 'pay_late');
    assert.equal(router.push.mock.calls.at(-1).arguments[0], `/order-success?orderNumber=${newOrders()[0].orderNumber}&email=new%40x.test`);
    assert.equal(couponDoc().usedCount, 1);
  });

  test('the webhook confirms the payment between the look-up and the cancel: the paid order is never cancelled, and no COD order goes on top', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    const w = windows[0];
    closeWindow(w);
    /* The UPI approval lands while the page is giving the attempt up. */
    onceBefore('PUT', /^\/api\/orders\//, async ({ id }) => {
      rzp.orders.get(w.options.order_id).status = 'paid';
      await settlePaidOrder(db, db.collection('orders').doc(id), { razorpayPaymentId: 'pay_late' });
    });
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    const all = newOrders();
    assert.equal(all.length, 1, 'no COD order on top of the paid one (the customer would pay twice)');
    assert.equal(all[0].status, 'confirmed', 'the paid order is not cancelled');
    assert.equal(all[0].payment.status, 'paid');
    assert.equal(router.push.mock.calls.at(-1).arguments[0], `/order-success?orderNumber=${all[0].orderNumber}&email=new%40x.test`);
    assert.equal(couponDoc().usedCount, 1);
  });

  test('paying in the window settles the order the button was for', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    const page = mountPage(() => CheckoutPage());
    await settle();
    const label = buttonLabel(page.result);
    await submit(page);
    closeWindow();
    await submit(page); // pay again: the same order
    await payInWindow();
    await settle();
    const [o] = newOrders();
    assert.equal(o.payment.status, 'paid');
    assert.equal(o.status, 'confirmed');
    assert.equal(o.total, rupees(label));
    assert.equal(rzp.payments.get('pay_1').amount, rupees(label) * 100);
    assert.equal(newOrders().length, 1);
  });

  test('the page was reloaded between attempts (the unpaid order is forgotten): a new order, but the coupon is counted once and the price holds', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    let page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    closeWindow();
    leavePage(); // reload

    page = mountPage(() => CheckoutPage());
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,449');
    await submit(page);
    const [first, second] = newOrders();
    assert.equal(second.total, rupees(label), 'the retry is not charged ₹1,599');
    assert.equal(windows.at(-1).options.amount, 144900);
    assert.equal(first.couponReleased, true, 'the new order took the use over');
    assert.deepEqual(couponDoc().usedBy, ['u:u-new']);
    assert.equal(couponDoc().usedCount, 1);
  });
});

/* ═════════════ 409 COUPON_CHANGED on the screens ═════════════ */

describe('the coupon changed while the shopper was on the page → told, the new total shown, charged that', { skip }, () => {
  test('/checkout: the owner lowers TULSI10 to 5% → 409 → the page shows ₹75 off → the order is placed at that', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,449');
    couponDoc().value = 5;
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    assert.equal(calls('POST', '/api/orders')[0].status, 409);
    assert.equal(newOrders().length, 0, 'nothing ordered at a price the customer didn’t see');
    assert.match(toast.mock.calls.at(-1).arguments[0], /TULSI10 now takes ₹75 off this order \(not ₹150\)/);
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,524');
    await submit(page);
    const [o] = newOrders();
    assert.equal(o.total, rupees(label));
    assert.equal(o.discount, 75);
  });

  test('/checkout: signed in under another account on the same browser → the first-order code is checked again for this one', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    mountPage(() => CartPage());
    await settle();
    assert.equal(cart.coupon?.checkedFor, 'u-new');
    leavePage();
    signInAs(RETURNING); // the family's other account
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(cart.coupon, null);
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,599');
  });

  test('drawer: the code is switched off before Place order → 409 → the coupon comes off, the full price shows, and that is charged', async () => {
    signInAs(NEW);
    remember('TULSI10');
    const drawer = mountHook(() => BuyNowDialog({ onClose: () => {}, product: PIECE, initialQty: 1 }));
    await settle();
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,449');
    couponDoc().isActive = false;
    flowOf(drawer.result).setPaymentMethod('cod');
    await settle();
    await submit(drawer);
    assert.equal(newOrders().length, 0);
    assert.match(textOf(drawer.result), /TULSI10 is no longer active/);
    assert.equal(pending(), null, 'refused for good: forgotten');
    const label = buttonLabel(drawer.result);
    assert.equal(label, 'Place order · ₹1,599');
    await submit(drawer);
    assert.equal(newOrders()[0].total, rupees(label));
  });
});

/* ═════════════ checkout/C ═════════════ */

describe('checkout-coupons C: the cart discount follows the quantity', { skip }, () => {
  test('3 pieces → 1 at /cart: ₹150 off, not the ₹450 frozen at 3; /checkout charges what it shows', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([3]);
    const cartPage = mountPage(() => CartPage());
    await settle();
    assert.equal(cart.discount, 450);
    cart.dispatch({ type: 'UPDATE_QUANTITY', payload: { id: 'p1', quantity: 1 } });
    await settle();
    assert.equal(cart.discount, 150);
    assert.match(textOf(cartPage.result), /saving ₹150/);
    leavePage();

    const page = mountPage(() => CheckoutPage());
    await settle();
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,449');
    await submit(page);
    assert.equal(newOrders()[0].total, rupees(label), 'was ₹1,449 charged against a ₹1,149 button');
  });

  test('below its minimum after removing pieces: ₹0 off with "Add ₹2,000 more", and the order is placed at the price shown', async () => {
    signInAs(NEW);
    remember('WELCOME5K');
    seedCart([4]);
    const cartPage = mountPage(() => CartPage());
    await settle();
    assert.equal(cart.discount, 600);
    cart.dispatch({ type: 'UPDATE_QUANTITY', payload: { id: 'p1', quantity: 2 } });
    await settle();
    assert.equal(cart.discount, 0);
    assert.equal(cart.couponShortfall, 2000);
    assert.match(textOf(cartPage.result), /Add ₹2,000 more to use “WELCOME5K”/);
    leavePage();

    const page = mountPage(() => CheckoutPage());
    await settle();
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    assert.match(textOf(page.result), /Add ₹2,000 more to use WELCOME5K/);
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹3,000');
    await submit(page);
    const [o] = newOrders();
    assert.equal(o.total, 3000, 'was ₹3,000 charged against a ₹2,400 button');
    assert.equal(o.couponCode, null);
    assert.equal(calls('POST', '/api/orders')[0].body.couponDiscount, 0);
    assert.equal(couponDoc('w5k').usedCount, 0);
  });

  test('the quantity changes while the coupon check is still in flight: the discount shown is the one for the new quantity', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([3]);
    const open = gate('POST /api/coupons/validate');
    const cartPage = mountPage(() => CartPage());
    await settle();
    cart.dispatch({ type: 'UPDATE_QUANTITY', payload: { id: 'p1', quantity: 1 } });
    await settle();
    open(); // the answer for 3 pieces (₹450) arrives now
    await settle();
    assert.equal(cart.coupon?.code, 'TULSI10');
    assert.equal(cart.discount, 150, 'not the ₹450 the server gave for 3 pieces');
    assert.match(textOf(cartPage.result), /saving ₹150/);
    leavePage();

    const page = mountPage(() => CheckoutPage());
    await settle();
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,449', 'not ₹1,149');
    await submit(page);
    assert.deepEqual(calls('POST', '/api/orders').map((c) => c.status), [201], 'no COUPON_CHANGED round trip');
    assert.equal(newOrders()[0].total, rupees(label));
  });

  test('the same for a code typed at /cart: the answer for the old quantity doesn’t stick to the new one', async () => {
    signInAs(NEW);
    seedCart([3]);
    const cartPage = mountPage(() => CartPage());
    await settle();
    find(cartPage.result, (el) => el.type === 'input' && el.props?.['aria-label'] === 'Coupon code').props.onChange({ target: { value: 'FEST5' } });
    await settle();
    const open = gate('POST /api/coupons/validate');
    const applying = byText(cartPage.result, /^Apply$/).props.onClick();
    await settle();
    cart.dispatch({ type: 'UPDATE_QUANTITY', payload: { id: 'p1', quantity: 2 } });
    await settle();
    open(); // 5% of ₹4,500 = ₹225, for 3 pieces
    await applying;
    await settle();
    assert.equal(cart.coupon?.code, 'FEST5');
    assert.equal(cart.discount, 150, '5% of ₹3,000');
  });

  test('removing the last piece drops the coupon; an empty cart never takes one', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    mountPage(() => CartPage());
    await settle();
    assert.equal(cart.coupon?.code, 'TULSI10');
    cart.dispatch({ type: 'REMOVE_ITEM', payload: 'p1' });
    await settle();
    assert.equal(cart.coupon, null);
    assert.equal(JSON.parse(local.get('tulsi-cart')).coupon, null, 'not saved with the empty cart either');
    cart.dispatch({ type: 'APPLY_COUPON', payload: { coupon: { code: 'TULSI10', type: 'percentage', value: 10 }, discount: 150 } });
    await settle();
    assert.equal(cart.coupon, null);
  });
});

/* ═════════════ checkout/D, checkout/E, checkout/F, server/D ═════════════ */

describe('the remembered welcome code', { skip }, () => {
  test('checkout-coupons D: a code kept below its minimum is checked once, not on every open — the customer’s own Apply is never rate-limited by it', async () => {
    fixedIp = '10.200.0.1'; // one phone, one address, all hour
    signInAs(NEW);
    remember('WELCOME5K');
    seedCart([1]);
    for (let visit = 0; visit < 20; visit += 1) {
      mountPage(() => (visit % 2 ? CheckoutPage() : CartPage()));
      await settle();
      leavePage();
    }
    assert.equal(calls('POST', '/api/coupons/validate').length, 1, 'was 20');
    assert.equal(toast.mock.calls.length, 1, 'one "minimum order" note, not 20');
    assert.equal(pending(), 'WELCOME5K', 'kept for a bigger order');

    const cartPage = mountPage(() => CartPage());
    await settle();
    const input = find(cartPage.result, (el) => el.type === 'input' && el.props?.['aria-label'] === 'Coupon code');
    assert.equal(input.props.value, 'WELCOME5K', 'shown in the box without a request');
    input.props.onChange({ target: { value: 'fest5' } });
    await settle();
    await byText(cartPage.result, /^Apply$/).props.onClick();
    await settle();
    assert.equal(calls('POST', '/api/coupons/validate').at(-1).status, 200, 'was 429 Too many coupon attempts');
    assert.equal(cart.coupon?.code, 'FEST5');
  });

  test('checkout-coupons E + server/D: the strip offers a code only while it is live; tapping it on an open /checkout applies it there', async () => {
    db.store.get('coupons').delete('welcome'); // the default TULSI10 offer, no such coupon
    const strip = mountHook(() => WelcomeBar({ settings: null, charges: DEFAULT_CHARGES }));
    await settle();
    assert.equal(byLabel(strip.result, 'Apply code TULSI10 at checkout'), null, 'never advertised');
    assert.match(textOf(strip.result), /Handcrafted Bridal Jewellery/);
    leavePage();

    resetWorld(); // a fresh store: the coupon exists and is live
    signInAs(NEW);
    seedCart([1]);
    const page = mountPage(() => CheckoutPage());
    const bar = mountHook(() => WelcomeBar({ settings: null, charges: DEFAULT_CHARGES }));
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,599');
    const chip = byLabel(bar.result, 'Apply code TULSI10 at checkout');
    assert.ok(chip, 'the live code is offered');
    chip.props.onClick();
    await settle();
    assert.equal(cart.coupon?.code, 'TULSI10', 'applied on the open page (was: nothing listened)');
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,449');
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    assert.equal(newOrders()[0].total, rupees(label));
    assert.equal(newOrders()[0].couponCode, 'TULSI10');
  });

  test('checkout/F: /cart can take an applied code off (and forget it) or replace it with another', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    const cartPage = mountPage(() => CartPage());
    await settle();
    assert.equal(cart.coupon?.code, 'TULSI10');
    const input = () => find(cartPage.result, (el) => el.type === 'input' && el.props?.['aria-label'] === 'Coupon code');
    input().props.onChange({ target: { value: 'FEST5' } });
    await settle();
    await byText(cartPage.result, /^Apply$/).props.onClick();
    await settle();
    assert.equal(cart.coupon?.code, 'FEST5', 'replaced (Apply used to be disabled)');
    assert.equal(cart.discount, 75);

    byText(cartPage.result, /^Remove$/).props.onClick();
    await settle();
    assert.equal(cart.coupon, null);
    assert.equal(pending(), null, 'the remembered code is forgotten too');
    leavePage();
    mountPage(() => CartPage());
    await settle();
    assert.equal(cart.coupon, null, 'not put straight back on the next visit');
  });
});

/* ═════════════ checkout/G (race.test.mjs) ═════════════ */

describe('race: Place order while the welcome code is still being checked', { skip }, () => {
  test('held until the answer; then the order carries the code and the button’s price', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    const open = gate('POST /api/coupons/validate');
    const page = mountPage(() => CheckoutPage());
    await settle();
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    const btn = submitButton(page.result);
    assert.equal(btn.props.disabled, true);
    assert.match(buttonLabel(page.result), /Checking your coupon/);
    await submit(page);
    assert.equal(calls('POST', '/api/orders').length, 0, 'held (was: sent without the code)');

    open();
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,449');
    await submit(page);
    const [o] = newOrders();
    assert.equal(o.total, rupees(label));
    assert.equal(o.couponCode, 'TULSI10');
  });

  test('an answer that lands after an order was placed never writes a phantom coupon into the emptied cart', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart([1]);
    const open = gate('POST /api/coupons/validate');
    const page = mountPage(() => CheckoutPage());
    await settle();
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await flowOf(page.result).placeOrder(); // the hook alone, past the page's hold
    await settle();
    assert.equal(newOrders().length, 1);
    open();
    await settle();
    assert.equal(cart.items.length, 0);
    assert.equal(cart.coupon, null);
    assert.equal(JSON.parse(local.get('tulsi-cart')).coupon, null, 'nothing saved for the next visit');
    assert.equal(toast.success.mock.callCount(), 0, 'no "TULSI10 applied" over the confirmation');
    assert.equal(couponDoc().usedCount, 0);
  });
});

/* ═════════════ The Buy Now drawer (BN-1, BN-2, BN-3) ═════════════ */

describe('Buy Now drawer against the real server', { skip }, () => {
  const openDrawer = (initialQty = 1) => mountHook(() => BuyNowDialog({ onClose: () => {}, product: PIECE, initialQty }));

  test('coupon-repro BN-2: a ₹5,000-minimum code, quantity lowered below it → "Add ₹500 more" and the order costs what the button says', async () => {
    signInAs(NEW);
    const drawer = openDrawer(4);
    await settle();
    const input = find(drawer.result, (el) => el.type === 'input' && el.props?.id === ':t:-coupon');
    input.props.onChange({ target: { value: 'bigfirst' } });
    await settle();
    await byText(drawer.result, /^Apply$/).props.onClick();
    await settle();
    assert.match(textOf(drawer.result), /BIGFIRST applied — you save ₹500/);
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹5,500');

    byLabel(drawer.result, 'Decrease quantity').props.onClick();
    await settle();
    assert.match(textOf(drawer.result), /Add ₹500 more to use BIGFIRST/);
    flowOf(drawer.result).setPaymentMethod('cod');
    await settle();
    const label = buttonLabel(drawer.result);
    assert.equal(label, 'Place order · ₹4,500', 'was ₹4,000');
    await submit(drawer);
    const [o] = newOrders();
    assert.equal(o.total, rupees(label));
    assert.equal(o.couponCode, null);
    assert.equal(couponDoc('bigfirst').usedCount, 0);
  });

  test('verify-bn3 + hook-repro BN-1: close Razorpay, pay again (same order), switch to COD (cancel, then place) — then locked', async () => {
    signInAs(NEW);
    remember('TULSI10');
    const drawer = openDrawer(1);
    await settle();
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,449');
    await submit(drawer);
    closeWindow();
    await settle();
    await submit(drawer);
    assert.equal(calls('POST', '/api/orders').length, 1);
    assert.equal(windows[1].options.order_id, windows[0].options.order_id);
    closeWindow();
    flowOf(drawer.result).setPaymentMethod('cod');
    await settle();
    const label = buttonLabel(drawer.result);
    await submit(drawer);
    const [first, cod] = newOrders();
    assert.equal(first.status, 'cancelled');
    assert.equal(cod.total, rupees(label));
    assert.equal(cod.total, 1449);

    /* The confirmation page is still loading: the drawer stays locked. */
    const btn = submitButton(drawer.result);
    assert.equal(btn.props.disabled, true);
    assert.equal(buttonLabel(drawer.result), 'Order placed — opening confirmation…');
    await submit(drawer);
    await flowOf(drawer.result).placeOrder();
    await settle();
    assert.equal(calls('POST', '/api/orders').length, 2, 'no duplicate COD order (was a 3rd POST)');
    assert.equal(newOrders().length, 2);
    assert.equal(couponDoc().usedCount, 1);
  });

  test('hook-repro: two taps in the same instant place one COD order', async () => {
    signInAs(NEW);
    const drawer = openDrawer(1);
    await settle();
    flowOf(drawer.result).setPaymentMethod('cod');
    await settle();
    const place = flowOf(drawer.result).placeOrder;
    await Promise.all([place(), place()]);
    await settle();
    assert.equal(newOrders().length, 1);
  });
});

/* ═════════════ BN-4: the drawer's code fails to load ═════════════ */

describe('product page: the Buy Now code fails to load (flaky data, or a tab open across a deploy)', { skip }, () => {
  /* The browser's address bar: reloading is a full page load (assign). */
  afterEach(() => { delete globalThis.window.location; });

  test('the page stays up and reloads itself with Buy Now reopened (?buynow), keeping its other parameters (React.lazy kept the failure for good)', async () => {
    globalThis.window.location = { search: '?utm_source=instagram&utm_campaign=bridal', pathname: '/product/p1', hash: '', assign: mock.fn() };
    const { assign } = globalThis.window.location;
    const Drawer = function BuyNowDrawerStub() { return null; };
    let chunk = 'fail';
    const imports = [];
    const stubs = {
      react: { ...fakeReact, lazy: (load) => load, Suspense: function Suspense() { return null; } },
      'next/navigation': { useRouter: () => router, useParams: () => ({ id: 'p1' }) },
      'next-auth/react': { useSession: () => sessionState },
      'react-hot-toast': esm(toast),
      'next/image': esm(function Image() { return null; }),
      'next/link': esm(function Link() { return null; }),
      'react-icons/fi': icons,
      '@/context/CartContext': { useCart: () => ({ dispatch() {}, charges: DEFAULT_CHARGES }) },
      '@/context/WishlistContext': { useWishlist: () => ({ toggle() {}, isWishlisted: () => false }) },
      '@/hooks/useProductTracking': { useProductTracking: () => ({ recordCarouselClick() {}, recordZoomInteraction() {} }) },
      '@/components/product/useStoreWhatsApp': esm(() => null),
      '@/components/product/useBuyNowReturn': esm(() => {}),
      ...Object.fromEntries(['shop/ImageZoomModal', 'chat/ChatWithSeller', 'product/StockBadge', 'product/LiveViewersBadge', 'product/OrderOnWhatsApp', 'product/WhatsAppIcon', 'ar/TryOnModal', 'ui/LoadingSpinner']
        .map((c) => [`@/components/${c}`, esm(function Stub() { return null; })])),
    };
    /* The drawer's chunk: the first request fails, later ones arrive. */
    Object.defineProperty(stubs, '@/components/checkout/BuyNowDrawer', {
      enumerable: true,
      get() {
        imports.push(chunk);
        if (chunk === 'fail') throw Object.assign(new Error('Loading chunk 812 failed.'), { name: 'ChunkLoadError' });
        return esm(Drawer);
      },
    });
    const ProductDetail = makeLoader(stubs)('app/product/[id]/ProductDetail.js').default;
    signInAs(NEW);
    const page = mountHook(() => ProductDetail({ initialProduct: { ...PIECE, isActive: true } }));
    await settle();
    const buyNow = () => byText(page.result, /Buy Now/);
    const drawerOpen = () => !!find(page.result, (el) => el.type === Drawer);

    buyNow().props.onClick();
    await settle();
    assert.deepEqual(toast.mock.calls.map((c) => c.arguments[0]), ['Opening checkout…']);
    assert.deepEqual(assign.mock.calls.map((c) => c.arguments[0]), ['/product/p1?utm_source=instagram&utm_campaign=bridal&buynow=1'],
      'a fresh page load (a retry in the same page gets the same failure back); the visit’s utm_* parameters are kept');
    assert.equal(toast.error.mock.callCount(), 0, 'not “please try again”');
    assert.ok(buyNow(), 'the product page is still there');
    assert.equal(drawerOpen(), false);

    /* Before the reload lands, a chunk that does arrive still opens it. */
    chunk = 'ok';
    buyNow().props.onClick();
    await settle();
    assert.equal(drawerOpen(), true, 'the second tap loads it');
    const drawer = find(page.result, (el) => el.type === Drawer);
    assert.equal(drawer.props.product.id, 'p1');
    assert.equal(drawer.props.qty, 1);
    assert.deepEqual(imports, ['fail', 'ok'], 'loaded once, then kept');
  });
});

/* ═════════════ The unpaid order is re-used only for the very same attempt ═════════════ */

describe('useCheckoutFlow: pay the unpaid order again, or cancel it and place a new one', { skip }, () => {
  /* [label, change after the window was closed, re-used?] */
  const CASES = [
    ['nothing changed', () => {}, true],
    ['the quantity', (p) => { p.lines = [{ product: 'p1', quantity: 2 }]; p.subtotal = 3000; p.discount = 300; }, false],
    ['the coupon removed', (p) => { p.couponCode = undefined; p.discount = 0; }, false],
    ['the street', (p, f) => f.updateForm('street', '14 Temple St'), false],
    ['the mobile number', (p, f) => f.updateForm('phone', '9123456780'), false],
    ['the email', (p, f) => f.updateForm('email', 'priya.r@x.test'), false],
    ['Cash on Delivery instead', (p, f) => f.setPaymentMethod('cod'), false],
  ];
  for (const [label, change, reused] of CASES) {
    test(`${label} → ${reused ? 'the same order is paid' : 'cancelled first, then a new order'}`, async () => {
      signInAs(NEW);
      cart = { charges: { ...DEFAULT_CHARGES }, refreshCharges: async () => null };
      const props = { lines: [{ product: 'p1', quantity: 1 }], subtotal: 1500, discount: 150, couponCode: 'TULSI10', notify: () => {} };
      const h = mountHook(() => useCheckoutFlow({ ...props }));
      await settle();
      assert.equal(h.result.form.phone, '9876543210', 'the saved address');
      await h.result.placeOrder();
      await settle();
      closeWindow();
      change(props, h.result);
      h.rerender();
      await settle();
      const shown = h.result.payableTotal;
      await h.result.placeOrder();
      await settle();
      const all = newOrders();
      if (reused) {
        assert.equal(all.length, 1);
        assert.equal(calls('PUT', /^\/api\/orders\//).length, 0);
        assert.equal(windows.length, 2);
        assert.equal(windows[1].options.order_id, windows[0].options.order_id);
      } else {
        assert.equal(all.length, 2);
        assert.equal(all[0].status, 'cancelled', 'the unpaid one is given up first');
        assert.equal(calls('PUT', /^\/api\/orders\//).length, 1);
        assert.equal(all[1].total, shown, 'the new order costs what the button shows');
        assert.equal(couponDoc().usedCount, props.couponCode ? 1 : 0, 'never held twice');
      }
    });
  }

  test('the charges changed under the same basket: the old total no longer matches → replaced at the new price', async () => {
    signInAs(NEW);
    cart = { charges: { ...DEFAULT_CHARGES }, refreshCharges: async () => null };
    const h = mountHook(() => useCheckoutFlow({ lines: [{ product: 'p1', quantity: 1 }], subtotal: 1500, discount: 0, notify: () => {} }));
    await settle();
    await h.result.placeOrder();
    await settle();
    closeWindow();
    db.store.get('settings').set('store_settings', { ...DEFAULT_CHARGES, shipping_fee_amount: 149 });
    cart = { ...cart, charges: { ...DEFAULT_CHARGES, shipping_fee_amount: 149 } };
    h.rerender();
    await settle();
    assert.equal(h.result.payableTotal, 1649);
    await h.result.placeOrder();
    await settle();
    const [old, fresh] = newOrders();
    assert.equal(old.status, 'cancelled');
    assert.equal(fresh.total, 1649);
    assert.equal(windows.at(-1).options.amount, 164900);
  });
});

/* ═════════════ The admin coupon form ↔ the API (server/F, server/B) ═════════════ */

describe('admin coupon form: what is typed is what is stored and what loads back', { skip }, () => {
  const OWNER = { id: 'owner', email: 'owner@tulsi.test' };
  test('Max Discount, Valid From and a blank (unlimited) Usage Limit survive a save and an edit', async () => {
    const { __toForm: toForm, __toPayload: toPayload, __EMPTY: EMPTY } = adminCoupons;
    signInAs(OWNER);
    const form = { ...EMPTY, code: 'BRIDE10', type: 'percentage', value: '10', maxDiscount: '500', usageLimit: '', validFrom: '2026-12-01', validUntil: '2026-12-31', isActive: true };
    const created = await fetch('/api/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toPayload(form)) }).then((r) => r.json());
    assert.equal(created.success, true, created.message);
    const stored = db.store.get('coupons').get(created.data.id);
    assert.equal(stored.maxDiscount, 500, 'was dropped');
    assert.equal(stored.startsAt, '2026-11-30T18:30:00.000Z', 'Valid From = midnight in India; was dropped');
    assert.equal(stored.maxUses, 0, 'blank = unlimited; was 100');

    const listed = (await fetch('/api/coupons').then((r) => r.json())).data.find((c) => c.code === 'BRIDE10');
    const loaded = toForm(listed);
    assert.equal(loaded.maxDiscount, '500', 'the edit form shows the cap (was blank)');
    assert.equal(loaded.validFrom, '2026-12-01');
    assert.equal(loaded.validUntil, '2026-12-31');
    assert.equal(loaded.usageLimit, '', 'unlimited shows as blank');

    /* Edit: clear the cap, set a limit, clear the start. */
    const edited = await fetch(`/api/coupons/${created.data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toPayload({ ...loaded, maxDiscount: '', usageLimit: '25', validFrom: '' })) }).then((r) => r.json());
    assert.equal(edited.success, true, edited.message);
    assert.equal(edited.data.maxDiscount, null, 'an edit can clear it (JSON used to drop the field)');
    assert.equal(edited.data.maxUses, 25);
    assert.equal(edited.data.startsAt, null);
    const reloaded = toForm(edited.data);
    assert.deepEqual([reloaded.maxDiscount, reloaded.usageLimit, reloaded.validFrom], ['', '25', '']);

    /* And the limit cleared again → unlimited. */
    const unlimited = await fetch(`/api/coupons/${created.data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toPayload({ ...reloaded, usageLimit: '' })) }).then((r) => r.json());
    assert.equal(unlimited.data.maxUses, 0);
  });
});
