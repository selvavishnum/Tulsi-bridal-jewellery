/* ─────────────────────────────────────────────
   CRO round 3 — the gaps between the server tests (real routes, requests
   written by hand) and the client tests (real hooks, a model of the
   server): the shopper's real screens wired to the REAL routes, end to
   end, for the round-3 paths.

     R1  abandoned attempt → reload (or the drawer reopened) → the retry
         replaces it → a late UPI payment on it (webhook / verify) is
         recorded for a refund and gives nothing twice → cancelling the
         retry gives back exactly what the retry used
     R6  the kept attempt was replaced from another tab: the fresh order
         is never placed at a points discount the page didn't show
     B   the daily clean-up (cron) end to end: an attempt left for a day,
         a page left open for a day, a payment still being captured, a
         late payment after the expiry, guests
     R4  GET /api/loyalty parkedDiscount = what POST /api/orders takes:
         as a table of cases and through the page (the button)

   The guiding rules: the amount on the Place-order button is the amount
   charged; an abandoned online payment never costs or gifts the customer
   anything; a paid order is never cancelled; no customer messages for
   internal bookkeeping.

   Fakes only at the edges: the NextAuth session, Firestore (in-memory,
   transactions held to reads-before-writes; dotted where() paths
   mirrored the way real Firestore resolves them), email / WhatsApp
   (recorded), the Razorpay SDK and its checkout window. The client
   modules are transpiled with sucrase and run by a tiny hook runner.

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
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.CRON_SECRET = 'cron-test-secret';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
delete process.env.SHIPROCKET_EMAIL;

/* ═════════════ Server: real routes, fake edges ═════════════ */

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let serverSession = null;
const getServerSession = async () => serverSession;

/* Razorpay's own ledger of orders and payments. */
const rzp = { orders: new Map(), payments: new Map(), creates: 0 };
class FakeRazorpay {
  constructor() {
    this.orders = {
      create: async (o) => {
        rzp.creates += 1;
        const order = { id: `order_${rzp.creates}`, entity: 'order', amount: o.amount, currency: o.currency || 'INR', receipt: o.receipt, status: 'created' };
        rzp.orders.set(order.id, order);
        return { ...order };
      },
      fetch: async (id) => {
        if (!rzp.orders.has(id)) throw Object.assign(new Error('not found'), { error: { description: 'The id provided does not exist' } });
        return { ...rzp.orders.get(id) };
      },
      fetchPayments: async (id) => ({ items: [...rzp.payments.values()].filter((p) => p.order_id === id).map((p) => ({ ...p })) }),
    };
    this.payments = {
      fetch: async (id) => ({ ...rzp.payments.get(id) }),
      capture: async (id) => ({ ...rzp.payments.get(id), status: 'captured' }),
    };
  }
}

/* Every message to a customer: [kind, orderNumber, status?]. */
const sent = [];
const record = (kind) => async (o, status) => { sent.push([kind, o?.orderNumber, status]); };
const noop = async () => {};

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
mock.module(src('lib/email.js'), {
  namedExports: {
    ...Object.fromEntries(['sendOTPEmail', 'sendOrderNotificationToAdmin', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'sendVendorOrderNotification', 'isConfigured'].map((n) => [n, noop])),
    sendOrderConfirmation: record('email:placed'),
    sendStatusUpdateEmail: record('email:status'),
    esc: (v) => String(v ?? ''),
  },
});
mock.module(src('lib/whatsapp.js'), {
  namedExports: {
    ...Object.fromEntries(['sendOrderWhatsAppToAdmin', 'sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])),
    sendOrderWhatsAppToCustomer: record('wa:placed'),
    sendStatusWhatsApp: record('wa:status'),
  },
});

const route = (p) => import(src(`app/api/${p}/route.js`));
const [orders, orderById, validate, createOrder, verify, webhookRoute, siteSettings, address, loyalty, storeCharges, expireCron] = await Promise.all([
  route('orders'), route('orders/[id]'), route('coupons/validate'), route('payments/create-order'), route('payments/verify'),
  route('payments/webhook'), route('admin/settings'), route('user/address'), route('loyalty'), route('store-charges'),
  route('cron/expire-unpaid-orders'),
]);
const { couponDiscountFor } = await import(src('lib/coupons.js'));

/* Real Firestore resolves where('payment.method' / 'payment.razorpayOrderId', …)
   on the nested field; the fake compares top-level keys, so they are
   mirrored before every request. */
function syncDotted() {
  for (const o of db.store.get('orders')?.values() || []) {
    if (o.payment?.method !== undefined) o['payment.method'] = o.payment.method;
    if (o.payment?.razorpayOrderId !== undefined) o['payment.razorpayOrderId'] = o.payment.razorpayOrderId;
  }
}

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
];
let wire = []; // every request from a page: { method, path, body, status }
let ipN = 0;
const nextIp = () => `10.14.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
let inflight = 0;
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
    syncDotted();
    const params = key ? { [key]: decodeURIComponent(re.exec(u.pathname)[1]) } : {};
    const res = await mod[method](new Request(u, {
      method,
      headers: { ...(init.headers || {}), 'x-forwarded-for': nextIp() },
      ...(init.body !== undefined && { body: init.body }),
    }), { params: Promise.resolve(params) });
    entry.status = res.status;
    return res;
  } finally {
    inflight -= 1;
  }
};
const calls = (method, p) => wire.filter((c) => c.method === method && (p instanceof RegExp ? p.test(c.path) : c.path === p));

/* A route called directly, not from a page: the webhook, the cron, My
   Orders, the store owner. */
async function call(mod, method, body, params = {}, headers = {}) {
  syncDotted();
  const res = await mod[method](new Request('http://tulsi.test/api', {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), ...headers },
    ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
}
const quietly = async (fn) => {
  const orig = [console.error, console.warn];
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { [console.error, console.warn] = orig; }
};

/* Razorpay's server calls the webhook: a payment on that Razorpay order was
   captured (e.g. a UPI approval landing after the window was closed). */
async function webhookPaid(rzpOrderId, payment = null) {
  const o = rzp.orders.get(rzpOrderId);
  let pay = payment;
  if (!pay) {
    o.status = 'paid';
    pay = { id: `pay_${rzp.payments.size + 1}`, order_id: o.id, status: 'captured', amount: o.amount, currency: 'INR' };
    rzp.payments.set(pay.id, pay);
  }
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: pay } } });
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  const r = await quietly(() => call(webhookRoute, 'POST', body, {}, { 'x-razorpay-signature': signature }));
  return { ...r, payment: pay };
}
const runCron = () => quietly(() => call(expireCron, 'GET', undefined, {}, { authorization: `Bearer ${process.env.CRON_SECRET}` }));
const readParked = async () => (await call(loyalty, 'GET')).json.data.parkedDiscount;
/* The customer cancels from My Orders (a real cancel — no unpaidOnly). */
const cancelFromMyOrders = (id) => call(orderById, 'PUT', { status: 'cancelled' }, { id });
/* The store owner acts on an order. */
async function asOwner(fn) {
  const was = serverSession;
  serverSession = { user: OWNER };
  try { return await fn(); } finally { serverSession = was; }
}

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
  return pay;
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
}) : null;
const CheckoutPage = sucrase ? loadApp('app/checkout/page.js').default : null;
const BuyNowDialog = sucrase ? loadApp('components/checkout/BuyNowDrawer.jsx').__BuyNowDialog : null;
const rules = sucrase ? loadApp('components/checkout/checkoutRules.js') : null;
const { DEFAULT_CHARGES } = sucrase ? loadApp('lib/storeCharges.js') : {};

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
const unmount = (h) => { h.unmount(); mounted.delete(h); };
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
const rupees = (label) => Number(String(label).split('₹').pop().replace(/[^\d]/g, '')) * (/-₹/.test(label) ? -1 : 1);
const flowOf = (tree) => find(tree, (el) => !!el.props?.flow)?.props.flow;
async function submit(page) {
  const form = find(page.result, (el) => el.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  await settle();
}

/* ═════════════ The shop ═════════════ */

const NEW = { id: 'u-new', email: 'new@x.test', emailVerified: true, name: 'Priya' };
const OWNER = { id: 'owner', email: 'owner@tulsi.test' };
const savedAddress = { id: 'a1', fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001' };
const PIECE = { _id: 'p1', id: 'p1', name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 5, images: [] };
const COUPON = { type: 'percentage', maxUses: 0, usedCount: 0, usedBy: [], isActive: true, minOrderAmount: 0, maxDiscount: null, startsAt: null, expiresAt: null };
const HOUR = 3_600_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

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

const seedCart = (qty) => local.set('tulsi-cart', JSON.stringify({ items: [{ ...PIECE, quantity: qty }], coupon: null, discount: 0, discountAt: null }));
const remember = (code) => local.set('tj-pending-coupon', JSON.stringify({ code, at: Date.now() }));
const couponDoc = (id = 'welcome') => db.store.get('coupons').get(id);
const orderDoc = (id) => db.store.get('orders').get(id);
const allOrders = () => [...db.store.get('orders').entries()].map(([id, o]) => ({ id, ...o }));
const userDoc = (id = 'u-new') => db.store.get('users').get(id);
const stock = () => db.store.get('products').get('p1').stock;
const statusMessages = () => sent.filter(([k]) => k.endsWith(':status'));
const earned = () => [...(db.store.get('loyaltyTransactions')?.values() || [])].filter((t) => t.type === 'earn');
const snapshot = () => {
  syncDotted();
  return JSON.stringify([...db.store.entries()].filter(([c, m]) => c !== 'rateLimits' && m.size > 0)
    .map(([c, m]) => [c, [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1))]));
};
/* What the customer holds: the coupon's bookkeeping and the parked points. */
const holdings = (id = 'welcome') => ({ usedCount: couponDoc(id).usedCount, usedBy: couponDoc(id).usedBy, parked: userDoc().pendingLoyaltyDiscount });

function resetWorld() {
  leavePage();
  serverSession = null;
  sessionState.data = null; sessionState.status = 'unauthenticated';
  rzp.orders.clear(); rzp.payments.clear(); rzp.creates = 0;
  wire = []; sent.length = 0;
  local.clear(); tab.clear(); listeners.clear(); windows.length = 0;
  router.push.mock.resetCalls(); router.replace.mock.resetCalls();
  toast.mock.resetCalls(); toast.error.mock.resetCalls(); toast.success.mock.resetCalls();
  db = strictTransactions(fakeFirestore({
    products: { p1: { name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 5, isActive: true } },
    coupons: {
      welcome: { ...COUPON, code: 'TULSI10', value: 10, firstOrderOnly: true },
      fest: { ...COUPON, code: 'FEST100', type: 'fixed', value: 100 },
      big: { ...COUPON, code: 'BIG1300', type: 'fixed', value: 1300 },
    },
    orders: {},
    users: { 'u-new': { email: 'new@x.test', name: 'Priya', savedAddresses: [savedAddress], pendingLoyaltyDiscount: 100, loyaltyPoints: 0 } },
    settings: { site: { onlinePaymentEnabled: true, loyaltyEnabled: true } },
  }));
}
beforeEach(resetWorld);
afterEach(leavePage);

const openDrawer = (initialQty = 1) => mountHook(() => BuyNowDialog({ onClose: () => {}, product: PIECE, initialQty }));

/* ═════════════ R1 end to end ═════════════ */

describe('R1 end to end: abandoned → reload → the retry replaces it → the late payment is refunded → cancelling the retry gives back exactly what it used', { skip }, () => {
  test('/checkout, a COD retry, the UPI payment lands late through the webhook', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart(1);
    let page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,349', '₹1,500 − ₹150 TULSI10 − ₹100 points + ₹99');
    assert.match(textOf(page.result), /Points Discount-₹100/);
    await submit(page);
    const first = allOrders()[0];
    assert.equal(first.total, 1349);
    const w1 = windows[0];
    assert.equal(w1.options.amount, 134900);
    closeWindow(w1);
    assert.equal(userDoc().pendingLoyaltyDiscount, 0, 'held by the attempt now');
    leavePage(); // reload: the page forgets the unpaid order
    sent.length = 0;

    page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(await readParked(), 100, 'held by the abandoned attempt');
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,349', 'the reloaded page shows the points discount the retry takes');
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    assert.equal(buttonLabel(page.result), label, 'no COD fee above ₹500');
    await submit(page);

    const retry = allOrders().find((o) => o.id !== first.id);
    assert.equal(retry.payment.method, 'cod');
    assert.equal(retry.total, rupees(label), 'charged what the button said');
    assert.deepEqual([retry.discount, retry.loyaltyDiscount, retry.couponCode], [250, 100, 'TULSI10']);
    let A = orderDoc(first.id);
    assert.deepEqual([A.status, A.cancelReason, A.replacedBy], ['cancelled', 'replaced', retry.id]);
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 });
    assert.deepEqual(statusMessages(), [], 'no "order cancelled" for the replaced attempt');
    assert.deepEqual(sent.map(([k, n]) => [k, n]), [['email:placed', retry.orderNumber], ['wa:placed', retry.orderNumber]]);

    /* The UPI approval for #1 arrives after all (Razorpay's webhook). */
    const hook = await webhookPaid(w1.options.order_id);
    assert.equal(hook.status, 200, JSON.stringify(hook.json));
    A = orderDoc(first.id);
    assert.equal(A.status, 'cancelled', 'not revived');
    assert.equal(A.payment.status, 'paid');
    assert.equal(A.payment.razorpayPaymentId, hook.payment.id);
    assert.deepEqual([A.paidAfterCancel, A.refundDue], [true, true], '"Refund due" for the store');
    assert.equal(A.stockDeducted, undefined);
    assert.equal(stock(), 5, 'no stock for the refunded attempt');
    assert.equal(A.pointsAwarded, undefined);
    assert.equal(userDoc().loyaltyPoints, 0);
    assert.deepEqual(earned(), [], 'no points earned on a payment being refunded');
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 }, 'no second use of TULSI10, no points discount given back');
    assert.deepEqual(statusMessages(), []);
    assert.equal(await readParked(), 0);

    /* Razorpay delivers the same event again: nothing changes. */
    const once = snapshot();
    assert.equal((await webhookPaid(w1.options.order_id, hook.payment)).status, 200);
    assert.equal(snapshot(), once);

    /* The store refunds it and ticks it off: only the refund flags move. */
    const done = await asOwner(() => call(orderById, 'PUT', { refundDone: true }, { id: first.id }));
    assert.equal(done.status, 200, done.json.message);
    assert.equal(orderDoc(first.id).refundDue, false);
    assert.equal(orderDoc(first.id).status, 'cancelled');
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 });

    /* The customer cancels the COD order from My Orders: exactly what IT
       used comes back — TULSI10 once, ₹100 of points — and they hear about it. */
    const c = await cancelFromMyOrders(retry.id);
    assert.equal(c.status, 200, c.json.message);
    assert.deepEqual(holdings(), { usedCount: 0, usedBy: [], parked: retry.loyaltyDiscount });
    assert.deepEqual(statusMessages().map(([k, n, s]) => [k, n, s]), [['email:status', retry.orderNumber, 'cancelled'], ['wa:status', retry.orderNumber, 'cancelled']]);
    assert.equal(await readParked(), 100, 'the refunded attempt holds nothing');

    /* Next visit: the same price once more, and then never again. */
    leavePage();
    remember('TULSI10');
    seedCart(1);
    page = mountPage(() => CheckoutPage());
    await settle();
    const again = buttonLabel(page.result);
    assert.equal(again, 'Place Order · ₹1,349');
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    const third = allOrders().find((o) => ![first.id, retry.id].includes(o.id));
    assert.equal(third.total, rupees(again));
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 });
    assert.equal(stock(), 5, 'COD stock is taken on confirmation');
  });

  test('Buy Now: the drawer closed and reopened → an online retry replaces the attempt and is paid; the first window’s late payment is refunded; the store cancelling the paid retry takes back exactly its code, points and stock', async () => {
    signInAs(NEW);
    remember('TULSI10');
    let drawer = openDrawer(1);
    await settle();
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,349');
    assert.match(textOf(drawer.result), /Points discount−₹100/);
    await submit(drawer);
    const w1 = windows[0];
    closeWindow(w1);
    unmount(drawer); // the drawer closed — each open starts fresh

    drawer = openDrawer(1);
    await settle();
    const label = buttonLabel(drawer.result);
    assert.equal(label, 'Place order · ₹1,349', 'the reopened drawer still shows the points the retry takes');
    await submit(drawer);
    const [first, retry] = allOrders();
    assert.notEqual(retry.payment.razorpayOrderId, first.payment.razorpayOrderId);
    const w2 = windows[1];
    assert.equal(w2.options.order_id, retry.payment.razorpayOrderId);
    assert.equal(w2.options.amount, rupees(label) * 100, 'Razorpay asks for the button’s amount');
    assert.deepEqual([orderDoc(first.id).status, orderDoc(first.id).replacedBy], ['cancelled', retry.id]);

    await payInWindow(w2);
    await settle();
    let R = orderDoc(retry.id);
    assert.deepEqual([R.status, R.payment.status, R.total], ['confirmed', 'paid', rupees(label)]);
    assert.equal(stock(), 4);
    assert.equal(userDoc().loyaltyPoints, 13, '₹1,349 → 13 points, for the paid order only');
    assert.equal(router.push.mock.calls.at(-1).arguments[0], `/order-success?orderNumber=${retry.orderNumber}&email=new%40x.test`);

    /* The UPI approval for the first window lands late. */
    const hook = await webhookPaid(w1.options.order_id);
    assert.equal(hook.status, 200);
    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.paidAfterCancel, A.refundDue, A.pointsAwarded], ['cancelled', true, true, undefined]);
    assert.equal(stock(), 4, 'one piece taken, for the order that is going out');
    assert.equal(userDoc().loyaltyPoints, 13, 'no points for the refunded payment');
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 });
    assert.equal(orderDoc(retry.id).status, 'confirmed', 'the paid retry is untouched');

    /* The store cancels the paid retry (refunding it too). */
    const c = await asOwner(() => call(orderById, 'PUT', { status: 'cancelled' }, { id: retry.id }));
    assert.equal(c.status, 200, c.json.message);
    R = orderDoc(retry.id);
    assert.equal(R.pointsReversed, true);
    assert.equal(userDoc().loyaltyPoints, 0, 'the 13 points earned on it are taken back');
    assert.deepEqual(holdings(), { usedCount: 0, usedBy: [], parked: 100 }, 'its code and its ₹100 of points come back — no more');
    assert.equal(stock(), 5);
    assert.equal(orderDoc(first.id).status, 'cancelled');
    assert.equal(await readParked(), 100);
  });

  test('the retry is smaller: it takes the points its cap allows, the rest stays parked — and cancelling it gives back only what it took', async () => {
    userDoc().pendingLoyaltyDiscount = 500;
    signInAs(NEW);
    seedCart(2);
    let page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹2,500', '₹3,000 − ₹500 (under the ₹600 cap), free delivery');
    await submit(page);
    const [first] = allOrders();
    assert.equal(first.loyaltyDiscount, 500);
    closeWindow();
    leavePage();

    seedCart(1); // the shopper took one off before coming back
    page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(await readParked(), 500);
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,299', '₹1,500 − ₹300 (20% of ₹1,500) + ₹99');
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    const retry = allOrders().find((o) => o.id !== first.id);
    assert.equal(retry.total, rupees(label));
    assert.equal(retry.loyaltyDiscount, 300);
    assert.equal(orderDoc(first.id).cancelReason, 'replaced');
    assert.equal(userDoc().pendingLoyaltyDiscount, 200, 'the ₹200 the retry couldn’t take stays parked');
    assert.equal(await readParked(), 200);

    /* A late payment on the first attempt changes none of it. */
    await webhookPaid(first.payment.razorpayOrderId);
    assert.equal(orderDoc(first.id).refundDue, true);
    assert.equal(userDoc().pendingLoyaltyDiscount, 200);

    assert.equal((await cancelFromMyOrders(retry.id)).status, 200);
    assert.equal(userDoc().pendingLoyaltyDiscount, 500, '₹200 + the ₹300 the retry took — never the attempt’s ₹500 again');
  });

  test('the same page: window closed, switched to COD → the attempt is given up quietly (unpaidOnly); its code and points go to the COD order', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart(1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    const [first] = allOrders();
    closeWindow();
    sent.length = 0;
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    const label = buttonLabel(page.result);
    await submit(page);
    assert.deepEqual(calls('PUT', /^\/api\/orders\//).map((c) => [c.body, c.status]), [[{ status: 'cancelled', unpaidOnly: true }, 200]]);
    const cod = allOrders().find((o) => o.id !== first.id);
    assert.equal(cod.total, rupees(label));
    assert.deepEqual([cod.discount, cod.loyaltyDiscount], [250, 100]);
    assert.deepEqual([orderDoc(first.id).status, orderDoc(first.id).loyaltyRestored, orderDoc(first.id).couponReleased], ['cancelled', true, true]);
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 });
    assert.deepEqual(statusMessages(), [], 'no "order cancelled" email or WhatsApp for the attempt');
    assert.deepEqual(sent.map(([k, n]) => [k, n]), [['email:placed', cod.orderNumber], ['wa:placed', cod.orderNumber]], 'only "order placed", once');

    /* A late payment on the given-up attempt: refunded, nothing else. */
    await webhookPaid(first.payment.razorpayOrderId);
    assert.deepEqual([orderDoc(first.id).status, orderDoc(first.id).refundDue], ['cancelled', true]);
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 });
  });

  test('a stale second tab still has the first window open: its payment is recorded for a refund and confirms nothing', async () => {
    signInAs(NEW);
    seedCart(1);
    const tabA = mountPage(() => CheckoutPage());
    await settle();
    await submit(tabA);
    const [first] = allOrders();
    const w1 = windows[0]; // still open in tab A (a UPI collect request pending)

    /* Tab B: the same piece through Buy Now, COD — it takes the attempt over. */
    const tabB = openDrawer(1);
    await settle();
    flowOf(tabB.result).setPaymentMethod('cod');
    await settle();
    const labelB = buttonLabel(tabB.result);
    await submit(tabB);
    const retry = allOrders().find((o) => o.id !== first.id);
    assert.equal(retry.total, rupees(labelB));
    assert.equal(orderDoc(first.id).cancelReason, 'replaced');

    /* The shopper approves the UPI request for tab A's window. */
    await quietly(() => payInWindow(w1));
    await settle();
    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.payment.status, A.paidAfterCancel, A.refundDue], ['cancelled', 'paid', true, true]);
    assert.equal(stock(), 5);
    assert.equal(userDoc().loyaltyPoints, 0);
    assert.deepEqual(earned(), []);
    assert.equal(userDoc().pendingLoyaltyDiscount, 0, 'the points stay with the COD order');
    assert.equal(orderDoc(retry.id).loyaltyDiscount, 100);
  });
});

/* ═════════════ R6: the kept attempt replaced from another tab ═════════════ */

describe('R6: the kept attempt was replaced from another tab → no order at a points discount the page didn’t show', { skip }, () => {
  /* Tab A: /checkout with ₹100 parked; Place order (online), window closed —
     the attempt is kept. Tab B: Buy Now, COD — it takes the attempt over,
     with its points. */
  async function replacedFromAnotherTab() {
    signInAs(NEW);
    seedCart(1);
    const tabA = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(tabA.result), 'Place Order · ₹1,499');
    await submit(tabA);
    closeWindow();
    const [first] = allOrders();

    const tabB = openDrawer(1);
    await settle();
    flowOf(tabB.result).setPaymentMethod('cod');
    await settle();
    await submit(tabB);
    unmount(tabB);
    const other = allOrders().find((o) => o.id !== first.id);
    assert.equal(other.loyaltyDiscount, 100);
    assert.equal(orderDoc(first.id).replacedBy, other.id);
    toast.mock.resetCalls();
    return { tabA, first, other };
  }
  const newest = (known) => allOrders().filter((o) => !known.includes(o.id));
  const told = () => toast.mock.calls.map((c) => c.arguments[0]).join('\n');

  test('Pay again (create-order → ORDER_CANCELLED, replaced): the new total is shown instead of an order ₹100 dearer than the button', async () => {
    const { tabA, first, other } = await replacedFromAnotherTab();
    const shown = buttonLabel(tabA.result);
    await submit(tabA);
    const placed = newest([first.id, other.id]);
    assert.deepEqual(placed.map((o) => o.total), [], `placed at ₹${placed.map((o) => o.total)} under a ${shown} button`);
    assert.equal(windows.length, 1, 'no payment window at a price the page didn’t show');
    assert.equal(buttonLabel(tabA.result), 'Place Order · ₹1,599', 'the points went with the other order: the new total is shown');
    assert.doesNotMatch(textOf(tabA.result), /Points Discount/);
    /* Round 4 (F): replaced by the newer order — that may be the one they
       wanted, so nothing is placed until they tap again. */
    assert.match(told(), /^This payment was replaced by your newer order\. Please check My Orders — tap the button again only if you want another order\.$/m);

    /* The next tap places it at what the button now says. */
    await submit(tabA);
    const [fresh] = newest([first.id, other.id]);
    assert.equal(fresh.total, 1599);
    assert.equal(windows.at(-1).options.amount, 159900);
  });

  test('switched to COD (the page looks the attempt up and finds it cancelled): no COD order dearer than the button', async () => {
    const { tabA, first, other } = await replacedFromAnotherTab();
    flowOf(tabA.result).setPaymentMethod('cod');
    await settle();
    const shown = buttonLabel(tabA.result);
    await submit(tabA);
    const placed = newest([first.id, other.id]);
    assert.deepEqual(placed.map((o) => o.total), [], `a COD order at ₹${placed.map((o) => o.total)} under a ${shown} button`);
    assert.equal(calls('PUT', /^\/api\/orders\//).length, 0, 'already cancelled: nothing to cancel');
    assert.equal(buttonLabel(tabA.result), 'Place Order · ₹1,599');
    assert.match(told(), /replaced by your newer order/, 'the look-up says replaced: told so, as create-order’s answer is (round 4, F)');

    await submit(tabA);
    const [fresh] = newest([first.id, other.id]);
    assert.equal(fresh.total, 1599);
    assert.equal(fresh.payment.method, 'cod');
  });

  test('cancelled elsewhere with its points given back (the store, or the daily clean-up): the fresh order still goes in the same tap, at the button’s price', async () => {
    signInAs(NEW);
    seedCart(1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,499');
    await submit(page);
    closeWindow();
    const [first] = allOrders();
    const c = await asOwner(() => call(orderById, 'PUT', { status: 'cancelled' }, { id: first.id }));
    assert.equal(c.status, 200);
    assert.equal(userDoc().pendingLoyaltyDiscount, 100, 'given back');

    await submit(page);
    const [fresh] = allOrders().filter((o) => o.id !== first.id);
    assert.ok(fresh, 'placed in the same tap');
    assert.equal(fresh.total, rupees(label));
    assert.equal(windows.length, 2);
    assert.equal(windows[1].options.amount, rupees(label) * 100);
  });
});

/* ═════════════ B: the daily clean-up, end to end ═════════════ */

describe('the daily clean-up (cron) end to end', { skip }, () => {
  test('an attempt left for a day: expired quietly, its code and points back; a payment landing after that is refunded; the next visit is charged what it shows', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart(1);
    let page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    const [first] = allOrders();
    const w1 = windows[0];
    closeWindow(w1);
    leavePage();
    sent.length = 0;
    orderDoc(first.id).createdAt = ago(25 * HOUR); // a day later

    const r = await runCron();
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.expired, [first.id]);
    assert.deepEqual([orderDoc(first.id).status, orderDoc(first.id).cancelReason], ['cancelled', 'expired']);
    assert.deepEqual(holdings(), { usedCount: 0, usedBy: [], parked: 100 });
    assert.deepEqual(sent, [], 'no email or WhatsApp');
    assert.equal(await readParked(), 100);

    /* The payment for it lands after all. */
    await webhookPaid(w1.options.order_id);
    assert.deepEqual([orderDoc(first.id).status, orderDoc(first.id).refundDue], ['cancelled', true]);
    assert.deepEqual(holdings(), { usedCount: 0, usedBy: [], parked: 100 }, 'nothing taken back from the customer for it');
    assert.equal(stock(), 5);

    /* The next day's run leaves it alone. */
    assert.deepEqual((await runCron()).json.expired, []);

    remember('TULSI10');
    seedCart(1);
    page = mountPage(() => CheckoutPage());
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,349');
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    const next = allOrders().find((o) => o.id !== first.id);
    assert.equal(next.total, rupees(label));
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 });
  });

  test('a page left open for a day: Pay again → ORDER_CANCELLED → a fresh order in the same tap at the button’s price; the code counted once', async () => {
    signInAs(NEW);
    remember('TULSI10');
    seedCart(1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    const label = buttonLabel(page.result);
    await submit(page);
    closeWindow();
    const [first] = allOrders();
    orderDoc(first.id).createdAt = ago(25 * HOUR);
    assert.deepEqual((await runCron()).json.expired, [first.id]);

    await submit(page);
    const pays = calls('POST', '/api/payments/create-order');
    assert.equal(pays.at(-2).status, 409, 'the expired attempt can’t be paid');
    const fresh = allOrders().find((o) => o.id !== first.id);
    assert.equal(fresh.total, rupees(label));
    assert.equal(windows.length, 2);
    assert.equal(windows[1].options.amount, rupees(label) * 100);
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 });
    await payInWindow(windows[1]);
    await settle();
    assert.equal(orderDoc(fresh.id).status, 'confirmed');
    assert.equal(router.push.mock.calls.at(-1).arguments[0], `/order-success?orderNumber=${fresh.orderNumber}&email=new%40x.test`);
  });

  test('never expired: an attempt whose payment is authorized (still being captured) — it confirms when captured; nor a replaced attempt again', async () => {
    signInAs(NEW);
    seedCart(1);
    let page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    closeWindow();
    const [held] = allOrders();
    /* The bank has authorized it; the capture is on its way. */
    const auth = { id: 'pay_auth', order_id: held.payment.razorpayOrderId, status: 'authorized', amount: held.total * 100, currency: 'INR' };
    rzp.payments.set(auth.id, auth);
    rzp.orders.get(held.payment.razorpayOrderId).status = 'attempted';
    orderDoc(held.id).createdAt = ago(25 * HOUR);

    const r = await runCron();
    assert.deepEqual(r.json.expired, []);
    assert.deepEqual(r.json.skipped, [{ id: held.id, reason: 'razorpay_attempted' }]);
    assert.equal(orderDoc(held.id).status, 'pending');
    assert.equal(userDoc().pendingLoyaltyDiscount, 0, 'its points stay with it');

    /* Captured: the webhook confirms it as a normal order. */
    auth.status = 'captured';
    rzp.orders.get(held.payment.razorpayOrderId).status = 'paid';
    await webhookPaid(held.payment.razorpayOrderId, auth);
    assert.deepEqual([orderDoc(held.id).status, orderDoc(held.id).refundDue], ['confirmed', undefined]);
    assert.equal(stock(), 4);
    assert.equal((await runCron()).json.checked, 0);

    /* A replaced attempt (already cancelled) is not cancelled again. */
    leavePage();
    userDoc().pendingLoyaltyDiscount = 50; // something for the retry to take over
    seedCart(1);
    page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    closeWindow();
    leavePage();
    seedCart(1);
    page = mountPage(() => CheckoutPage());
    await settle();
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    const replaced = allOrders().find((o) => o.cancelReason === 'replaced');
    assert.ok(replaced, 'the COD retry replaced the second attempt');
    orderDoc(replaced.id).createdAt = ago(25 * HOUR);
    const before = snapshot();
    assert.deepEqual((await runCron()).json.expired, []);
    assert.equal(snapshot(), before);
  });

  test('an attempt taken over before replaced attempts were cancelled (still pending): expired without handing its code or points back a second time', async () => {
    /* Saved by the earlier code: the newer order holds the use and the
       points; the attempt was only marked. */
    db.store.get('orders').set('newer', {
      orderNumber: 'TBJ-newer', userId: 'u-new', couponUserKey: 'u:u-new', coupon: 'fest', status: 'confirmed', stockDeducted: true,
      loyaltyDiscount: 100, total: 1399, createdAt: ago(30 * HOUR), payment: { method: 'cod', status: 'pending' },
    });
    db.store.get('orders').set('legacy', {
      orderNumber: 'TBJ-legacy', userId: 'u-new', couponUserKey: 'u:u-new', coupon: 'fest', status: 'pending', total: 1399,
      loyaltyDiscount: 100, couponReleased: true, couponMovedTo: 'newer', loyaltyRestored: true, loyaltyMovedTo: 'newer',
      createdAt: ago(31 * HOUR), items: [{ product: 'p1', quantity: 1 }], payment: { method: 'razorpay', status: 'pending', razorpayOrderId: 'order_legacy' },
    });
    rzp.orders.set('order_legacy', { id: 'order_legacy', amount: 139900, status: 'created' });
    Object.assign(couponDoc('fest'), { usedCount: 1, usedBy: ['u:u-new'] });
    userDoc().pendingLoyaltyDiscount = 0;
    signInAs(NEW);
    assert.equal(await readParked(), 0, 'the legacy attempt holds nothing');

    const r = await runCron();
    assert.deepEqual(r.json.expired, ['legacy']);
    assert.equal(orderDoc('legacy').status, 'cancelled');
    assert.deepEqual(holdings('fest'), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 }, 'still the newer order’s — nothing given back twice');
    assert.deepEqual(sent, []);
  });

  test('guests: an attempt whose code use a later guest order took over is expired without giving that use back twice', async () => {
    const guest = (method) => call(orders, 'POST', {
      items: [{ product: 'p1', quantity: 1 }], payment: { method }, guestEmail: 'g@x.test', couponCode: 'FEST100',
      shippingAddress: { fullName: 'Guest', phone: '9876543210', street: '1 Main Rd', city: 'Madurai', state: 'TN', pincode: '625001' },
    });
    signInAs(null);
    const a = await guest('razorpay');
    assert.equal(a.status, 201, a.json.message);
    const b = await guest('cod');
    assert.equal(b.json.data.discount, 100, 'the use is taken over');
    assert.equal(orderDoc(a.json.data.id).status, 'pending', 'never cancelled on a sessionless request');
    assert.deepEqual([couponDoc('fest').usedCount, couponDoc('fest').usedBy], [1, ['e:g@x.test']]);

    orderDoc(a.json.data.id).createdAt = ago(25 * HOUR);
    const r = await runCron();
    assert.deepEqual(r.json.expired, [a.json.data.id]);
    assert.deepEqual([couponDoc('fest').usedCount, couponDoc('fest').usedBy], [1, ['e:g@x.test']], 'still held by the COD order — not released by the expiry');
    assert.deepEqual(sent.filter(([k, n]) => k.endsWith(':status') && n === a.json.data.orderNumber), []);

    /* Cancelling the COD order releases it — once. */
    const cRes = await asOwner(() => call(orderById, 'PUT', { status: 'cancelled' }, { id: b.json.data.id }));
    assert.equal(cRes.status, 200);
    assert.deepEqual([couponDoc('fest').usedCount, couponDoc('fest').usedBy], [0, []]);
  });
});

/* ═════════════ R4: parkedDiscount = what the server takes ═════════════ */

describe('R4: GET /api/loyalty parkedDiscount is what POST /api/orders takes', { skip }, () => {
  /* [label, pendingLoyaltyDiscount, held by an abandoned attempt, qty, coupon, method] */
  const CASES = [
    ['nothing parked', 0, 0, 1, null, 'cod'],
    ['₹100 parked', 100, 0, 1, null, 'razorpay'],
    ['₹100 held by an abandoned attempt', 0, 100, 1, null, 'cod'],
    ['₹40 parked + ₹100 held', 40, 100, 1, 'TULSI10', 'razorpay'],
    ['₹1,000 parked, ₹1,500 order (20% cap)', 1000, 0, 1, null, 'cod'],
    ['₹250 parked + ₹450 held, 3 pieces (cap ₹900)', 250, 450, 3, 'FEST100', 'cod'],
    ['₹700 held, 2 pieces (cap ₹600): the rest stays parked', 0, 700, 2, 'TULSI10', 'razorpay'],
    ['₹300 parked under a ₹1,300 code: the points cover only what the code leaves', 300, 0, 1, 'BIG1300', 'razorpay'],
    ['₹300 held under a ₹1,300 code', 0, 300, 1, 'BIG1300', 'cod'],
  ];
  const COUPONS = { TULSI10: 'welcome', FEST100: 'fest', BIG1300: 'big' };
  for (const [label, pendingDiscount, held, qty, code, method] of CASES) {
    test(label, async () => {
      userDoc().pendingLoyaltyDiscount = pendingDiscount;
      if (held) {
        db.store.get('orders').set('held', {
          orderNumber: 'TBJ-held', userId: 'u-new', status: 'pending', createdAt: ago(HOUR), total: 9999, loyaltyDiscount: held,
          items: [{ product: 'p1', quantity: 1 }], payment: { method: 'razorpay', status: 'pending' },
        });
      }
      signInAs(NEW);
      const parkedDiscount = await readParked();
      assert.equal(parkedDiscount, pendingDiscount + held);

      /* What the page shows, from the same rules (checkoutRules). */
      const subtotal = 1500 * qty;
      const discount = code ? couponDiscountFor(couponDoc(COUPONS[code]), subtotal) : 0;
      const loyaltyDiscount = rules.loyaltyDiscountFor(parkedDiscount, subtotal, discount);
      const { payableTotal } = rules.checkoutAmounts({ subtotal, discount, loyaltyDiscount, paymentMethod: method, charges: DEFAULT_CHARGES });

      const r = await call(orders, 'POST', {
        items: [{ product: 'p1', quantity: qty }], shippingAddress: savedAddress, payment: { method },
        ...(code && { couponCode: code, couponDiscount: discount }),
      });
      assert.equal(r.status, 201, r.json.message);
      assert.equal(r.json.data.loyaltyDiscount, loyaltyDiscount, 'the points discount shown is the one taken');
      assert.equal(r.json.data.total, payableTotal, 'the amount shown is the amount charged');
      assert.ok(payableTotal >= 0);
      const left = pendingDiscount + held - loyaltyDiscount;
      assert.equal(userDoc().pendingLoyaltyDiscount, left, 'what the order couldn’t take stays parked');
      /* An online order holds its points until it is paid (a later order
         would take them over); a COD order has spent them. */
      assert.equal(await readParked(), left + (method === 'razorpay' ? loyaltyDiscount : 0));
      if (held) assert.equal(orderDoc('held').cancelReason, 'replaced');
    });
  }

  test('through the page: a ₹1,300 code and ₹300 of points on a ₹1,500 piece — the button is what is charged, and the unused points stay', async () => {
    userDoc().pendingLoyaltyDiscount = 300;
    signInAs(NEW);
    remember('BIG1300');
    seedCart(1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(cart.coupon?.code, 'BIG1300');
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹99', 'the points cover the ₹200 the code leaves, then delivery (was -₹1)');
    assert.match(textOf(page.result), /Points Discount-₹200/);
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    await submit(page);
    const [o] = allOrders();
    assert.equal(o.total, rupees(label));
    assert.deepEqual([o.discount, o.loyaltyDiscount], [1500, 200]);
    assert.equal(userDoc().pendingLoyaltyDiscount, 100, 'the ₹100 the order couldn’t use is not lost');
  });
});
