/* ─────────────────────────────────────────────
   CRO round 4 — the agreed contracts across the boundary: the shopper's
   REAL screens (/checkout, the Buy Now drawer, the order hook) wired to
   the REAL route handlers, no model of either side in between.

     A  a new order would take over an earlier attempt: Razorpay is asked
        first — paid → that order is confirmed and opened (no second
        order, one payment, one "order confirmed"); still being paid → the
        server's message, nothing written (Razorpay unreachable: that
        attempt is taken over as before — tests/cro-round4-fixes.test.mjs)
     B  verify on an attempt another tab replaced → 409 PAID_AFTER_CANCEL →
        the refund message, never /order-success
     C  "order confirmed" (email + WhatsApp) for an online order goes when
        it is paid, exactly once, whichever path confirms it; never for an
        attempt that was not paid, never for a payment being refunded; a
        resend refuses an unpaid attempt
     D  the points discount shown goes with the order; the points didn't
        load → 409 LOYALTY_CHANGED, nothing written → the page shows the
        server's figure → the next tap is charged it
     E  COD at the ₹20,000 limit: whenever the page offers COD the server
        accepts it, and whenever it doesn't the server refuses it — the
        COD fee counted as if COD, points never
     F  Pay again on an attempt a newer order replaced → told, nothing
        placed in that tap; the next tap places a fresh order

   The guiding rules: the amount on the Place-order button is the amount
   charged; a paid order is never cancelled or taken over; no customer
   messages for internal bookkeeping.

   Fakes only at the edges (as tests/cro-round3-extra.test.mjs): the
   NextAuth session, Firestore (in-memory, transactions held to
   reads-before-writes; dotted where() paths mirrored the way real
   Firestore resolves them), email / WhatsApp (recorded), the Razorpay SDK
   (its own ledger of orders and payments) and its checkout window. The
   client modules are transpiled with sucrase and run by a tiny hook
   runner.

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
process.env.SMTP_USER = 'shop@tulsi.test';
process.env.SMTP_PASS = 'smtp-test';
process.env.ADMIN_EMAIL = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
delete process.env.SHIPROCKET_EMAIL;

/* The contracts' wording. */
const EARLIER_PAID = 'Your earlier payment went through — we have confirmed that order.';
const PENDING_IN_PROGRESS = 'Your earlier payment is still being processed. Please wait a few minutes and check My Orders before paying again.';
const PAID_AFTER_CANCEL = 'This payment was for an order that had already been replaced or cancelled, so it was not placed. We will refund it to your original payment method.';
const REPLACED = 'This payment was replaced by your newer order. Please check My Orders — tap the button again only if you want another order.';
const COD_LIMIT = /^Cash on Delivery is available only for orders up to ₹20,000\./;

/* ═════════════ Server: real routes, fake edges ═════════════ */

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let serverSession = null;
const getServerSession = async () => serverSession;

/* Razorpay's own ledger of orders and payments. down: unreachable. */
const rzp = { orders: new Map(), payments: new Map(), creates: 0, down: false };
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
        if (rzp.down) throw new Error('ETIMEDOUT');
        if (!rzp.orders.has(id)) throw Object.assign(new Error('not found'), { error: { description: 'The id provided does not exist' } });
        return { ...rzp.orders.get(id) };
      },
      fetchPayments: async (id) => {
        if (rzp.down) throw new Error('ETIMEDOUT');
        return { items: [...rzp.payments.values()].filter((p) => p.order_id === id).map((p) => ({ ...p })) };
      },
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
/* What the store's own mailer sent (the admin's resend tool). */
const mailed = [];

mock.module('razorpay', { defaultExport: FakeRazorpay });
mock.module('nodemailer', { defaultExport: { createTransport: () => ({ verify: async () => true, sendMail: async (m) => { mailed.push(m); } }) } });
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
const [orders, orderById, validate, createOrder, verify, webhookRoute, siteSettings, address, loyalty, storeCharges, expireCron, vendorResend, adminResend] = await Promise.all([
  route('orders'), route('orders/[id]'), route('coupons/validate'), route('payments/create-order'), route('payments/verify'),
  route('payments/webhook'), route('admin/settings'), route('user/address'), route('loyalty'), route('store-charges'),
  route('cron/expire-unpaid-orders'), route('vendor/orders/[id]/resend-email'), route('admin/resend-email'),
]);

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
/* 'METHOD /path' the browser can't reach (the network drops that request). */
const unreachable = new Set();
let ipN = 0;
const nextIp = () => `10.15.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
let inflight = 0;
globalThis.fetch = async (url, init = {}) => {
  inflight += 1;
  try {
    const u = new URL(String(url), 'http://tulsi.test');
    const method = (init.method || 'GET').toUpperCase();
    if (unreachable.has(`${method} ${u.pathname}`)) throw new TypeError('Failed to fetch');
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
    entry.json = await res.clone().json().catch(() => null);
    return res;
  } finally {
    inflight -= 1;
  }
};
const calls = (method, p) => wire.filter((c) => c.method === method && (p instanceof RegExp ? p.test(c.path) : c.path === p));
const lastOrderPost = () => calls('POST', '/api/orders').at(-1);

/* A route called directly, not from a page: the webhook, the cron, the
   store, a vendor. */
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

/* The shopper approves the payment in their UPI app after the window was
   closed (or the tab went away): Razorpay has it, nobody has told us.
   'captured' → paid; 'authorized' / 'created' → still going through. */
function payOnRazorpay(rzpOrderId, status = 'captured') {
  const o = rzp.orders.get(rzpOrderId);
  const pay = { id: `pay_${rzp.payments.size + 1}`, order_id: o.id, status, amount: o.amount, currency: 'INR' };
  rzp.payments.set(pay.id, pay);
  o.status = status === 'captured' ? 'paid' : 'attempted';
  return pay;
}
/* Razorpay's server calls the webhook for a captured payment. */
async function webhookPaid(rzpOrderId, payment = null) {
  const pay = payment || payOnRazorpay(rzpOrderId);
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: pay } } });
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  const r = await quietly(() => call(webhookRoute, 'POST', body, {}, { 'x-razorpay-signature': signature }));
  return { ...r, payment: pay };
}
const runCron = () => quietly(() => call(expireCron, 'GET', undefined, {}, { authorization: `Bearer ${process.env.CRON_SECRET}` }));
const captured = () => [...rzp.payments.values()].filter((p) => p.status === 'captured').map((p) => p.id);
async function as(user, fn) {
  const was = serverSession;
  serverSession = { user };
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
  const pay = payOnRazorpay(w.options.order_id);
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${w.options.order_id}|${pay.id}`).digest('hex');
  await w.options.handler({ razorpay_order_id: w.options.order_id, razorpay_payment_id: pay.id, razorpay_signature: signature });
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
const rupees = (label) => Number(String(label).split('₹').pop().replace(/[^\d]/g, ''));
const flowOf = (tree) => find(tree, (el) => !!el.props?.flow)?.props.flow;
/* The payment-method fields, rendered (a hook-free component). */
function paymentFields(tree) {
  const el = find(tree, (e) => typeof e.type === 'function' && e.type.name === 'PaymentMethodFields');
  return el.type(el.props);
}
const codRadio = (tree) => find(paymentFields(tree), (el) => el.type === 'input' && el.props?.name === 'payment' && el.props?.value === 'cod');
/* The drawer's note beside the button. */
const drawerNote = (tree) => find(tree, (el) => (el.props?.role === 'status' || el.props?.role === 'alert') && /rounded-xl px-3/.test(el.props?.className || ''));
async function submit(page) {
  const form = find(page.result, (el) => el.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  await settle();
}

/* ═════════════ The shop ═════════════ */

const NEW = { id: 'u-new', email: 'new@x.test', emailVerified: true, name: 'Priya' };
const OWNER = { id: 'owner', email: 'owner@tulsi.test' };
const VENDOR = { id: 'uid-v', email: 'v@vendor.test' };
const savedAddress = { id: 'a1', fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001' };
const PIECE = { _id: 'p1', id: 'p1', name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 5, images: [] };
const BANGLE = { _id: 'p2', id: 'p2', name: 'Kemp Bangle', sku: 'KB-BN-220', price: 2800, discountPrice: 2500, stock: 3, images: [] };
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

const seedCart = (piece, qty = 1) => local.set('tulsi-cart', JSON.stringify({ items: [{ ...piece, quantity: qty }], coupon: null, discount: 0, discountAt: null }));
const remember = (code) => local.set('tj-pending-coupon', JSON.stringify({ code, at: Date.now() }));
const couponDoc = (id = 'welcome') => db.store.get('coupons').get(id);
const orderDoc = (id) => db.store.get('orders').get(id);
const allOrders = () => [...db.store.get('orders').entries()].map(([id, o]) => ({ id, ...o }));
const newest = (known) => allOrders().filter((o) => !known.includes(o.id));
const userDoc = (id = 'u-new') => db.store.get('users').get(id);
const stock = (id = 'p1') => db.store.get('products').get(id).stock;
/* "Order confirmed" (email + WhatsApp) to the customer: [kind, orderNumber]. */
const confirmations = () => sent.filter(([k]) => k.endsWith(':placed')).map(([k, n]) => [k, n]);
const confirmedOnce = (orderNumber) => [['email:placed', orderNumber], ['wa:placed', orderNumber]];
const statusMessages = () => sent.filter(([k]) => k.endsWith(':status'));
const earned = () => [...(db.store.get('loyaltyTransactions')?.values() || [])].filter((t) => t.type === 'earn');
const toasts = () => toast.mock.calls.map((c) => c.arguments[0]);
/* Every document but the rate-limit counters, for "nothing was written". */
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
  rzp.orders.clear(); rzp.payments.clear(); rzp.creates = 0; rzp.down = false;
  wire = []; sent.length = 0; mailed.length = 0; unreachable.clear();
  local.clear(); tab.clear(); listeners.clear(); windows.length = 0;
  router.push.mock.resetCalls(); router.replace.mock.resetCalls();
  toast.mock.resetCalls(); toast.error.mock.resetCalls(); toast.success.mock.resetCalls();
  db = strictTransactions(fakeFirestore({
    products: {
      p1: { name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 5, isActive: true },
      p2: { name: 'Kemp Bangle', sku: 'KB-BN-220', price: 2800, discountPrice: 2500, stock: 3, isActive: true },
    },
    coupons: {
      welcome: { ...COUPON, code: 'TULSI10', value: 10, firstOrderOnly: true },
      fest: { ...COUPON, code: 'FEST100', type: 'fixed', value: 100 },
    },
    orders: {},
    users: { 'u-new': { email: 'new@x.test', name: 'Priya', savedAddresses: [savedAddress], pendingLoyaltyDiscount: 100, loyaltyPoints: 0 } },
    settings: { site: { onlinePaymentEnabled: true, loyaltyEnabled: true } },
    staff: { v: { email: 'v@vendor.test', role: 'VENDOR', vendorId: 'vA', status: 'Active' } },
    vendors: { vA: { name: 'Vendor A', status: 'active', selfFulfil: true } },
  }));
}
beforeEach(resetWorld);
afterEach(leavePage);

/* The drawer on a product page, the layout's CartProvider above it (its
   charges come from the store, as the page's do). */
const openDrawer = (initialQty = 1, product = PIECE) => mountPage(() => BuyNowDialog({ onClose: () => {}, product, initialQty }));

/* /checkout: Place order (online) → the window opens → closed without
   paying. The page is then left (a reload, or the tab closed). */
async function abandonedAttempt({ code = 'TULSI10' } = {}) {
  signInAs(NEW);
  if (code) remember(code);
  seedCart(PIECE, 1);
  const page = mountPage(() => CheckoutPage());
  await settle();
  const label = buttonLabel(page.result);
  await submit(page);
  const [first] = allOrders();
  assert.equal(first.total, rupees(label));
  const w1 = windows.at(-1);
  assert.equal(w1.options.amount, rupees(label) * 100);
  closeWindow(w1);
  leavePage();
  return { first, w1, label };
}

/* ═════════════ A: the earlier attempt paid on Razorpay, or still being paid ═════════════ */

describe('A: a new order would take over an earlier attempt → Razorpay is asked first', { skip }, () => {
  test('paid in the UPI app after the window closed (no webhook yet) → the reload’s tap confirms #1 and opens its page: no #2, one payment, one "order confirmed"', async () => {
    const { first, w1, label } = await abandonedAttempt();
    assert.equal(label, 'Place Order · ₹1,349', '₹1,500 − ₹150 TULSI10 − ₹100 points + ₹99');
    assert.deepEqual(confirmations(), [], 'an unpaid attempt is not an order yet: nobody is told it is confirmed');
    const pay = payOnRazorpay(w1.options.order_id);

    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), label, 'the reload shows the attempt’s code and points, which the order would take over');
    toast.mock.resetCalls();
    router.push.mock.resetCalls();
    await quietly(() => submit(page));

    assert.deepEqual([lastOrderPost().status, lastOrderPost().json.code, lastOrderPost().json.orderId], [409, 'EARLIER_ORDER_PAID', first.id]);
    assert.deepEqual(allOrders().map((o) => o.id), [first.id], 'no #2');
    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.payment.status, A.payment.razorpayPaymentId, A.stockDeducted], ['confirmed', 'paid', pay.id, true]);
    assert.equal(A.refundDue, undefined);
    assert.equal(stock(), 4);
    assert.deepEqual(captured(), [pay.id], 'charged once');
    assert.equal(windows.length, 1, 'no second payment window');
    assert.equal(rzp.creates, 1);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), [`/order-success?orderNumber=${first.orderNumber}&email=new%40x.test`]);
    assert.deepEqual(toasts(), [EARLIER_PAID]);
    assert.equal(toast.error.mock.callCount(), 0);
    assert.equal(cart.items.length, 0, 'this basket was bought: the cart is cleared');
    assert.equal(local.has('tj-pending-coupon'), false, 'TULSI10 was spent on #1');
    assert.deepEqual(confirmations(), confirmedOnce(first.orderNumber));
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 }, 'one use of the code, the points spent once');
    assert.equal(userDoc().loyaltyPoints, 13, '₹1,349 paid → 13 points');

    /* Razorpay's webhook arrives after all, then the daily clean-up runs:
       nothing changes, nobody is told again. */
    const once = snapshot();
    assert.equal((await webhookPaid(w1.options.order_id, pay)).status, 200);
    const cron = await runCron();
    assert.equal(cron.status, 200);
    assert.deepEqual([cron.json.expired, cron.json.settled], [[], []]);
    assert.equal(snapshot(), once);
    assert.deepEqual(confirmations(), confirmedOnce(first.orderNumber));
    assert.deepEqual(statusMessages(), []);
  });

  test('Buy Now for one piece paid late; then /checkout for another → #1 is confirmed and opened, the cart keeps the other piece — the next visit orders it at its own price', async () => {
    signInAs(NEW);
    const drawer = openDrawer(1);
    await settle();
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,499');
    await submit(drawer);
    const [first] = allOrders();
    closeWindow();
    unmount(drawer);
    const pay = payOnRazorpay(first.payment.razorpayOrderId);

    seedCart(BANGLE, 1);
    let page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹2,400', '₹2,500 − the ₹100 of points the Buy Now attempt holds, free delivery');
    router.push.mock.resetCalls();
    await quietly(() => submit(page));
    assert.equal(lastOrderPost().json.code, 'EARLIER_ORDER_PAID');
    assert.deepEqual(allOrders().map((o) => o.id), [first.id], 'the bangle was not ordered');
    assert.deepEqual([orderDoc(first.id).status, orderDoc(first.id).payment.razorpayPaymentId], ['confirmed', pay.id]);
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), [`/order-success?orderNumber=${first.orderNumber}&email=new%40x.test`]);
    assert.deepEqual(cart.items.map((i) => [i._id, i.quantity]), [['p2', 1]], 'the bangle is still in the cart');
    assert.deepEqual(confirmations(), confirmedOnce(first.orderNumber));
    leavePage();

    page = mountPage(() => CheckoutPage());
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹2,500', 'the points went with #1');
    await submit(page);
    const [second] = newest([first.id]);
    assert.equal(second.total, 2500);
    assert.equal(windows.at(-1).options.amount, 250000);
    await payInWindow();
    await settle();
    assert.equal(orderDoc(second.id).status, 'confirmed');
    assert.deepEqual(captured().length, 2, 'two orders, two payments');
    assert.deepEqual(confirmations(), [...confirmedOnce(first.orderNumber), ...confirmedOnce(second.orderNumber)]);
  });

  test('a payment still going through (authorized) → the server’s message and nothing written; once it fails, the next tap takes the attempt over at the button’s price', async () => {
    const { first, w1, label } = await abandonedAttempt();
    const auth = payOnRazorpay(w1.options.order_id, 'authorized');
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), label);
    router.push.mock.resetCalls(); // the first render, before the cart is read

    for (const [setup, message] of [[() => {}, PENDING_IN_PROGRESS]]) {
      setup();
      const before = snapshot();
      toast.mock.resetCalls();
      await quietly(() => submit(page));
      assert.deepEqual([lastOrderPost().status, lastOrderPost().json.code, lastOrderPost().json.orderId], [409, 'EARLIER_PAYMENT_PENDING', first.id]);
      assert.deepEqual(toasts(), [message], 'a note, the server’s words');
      assert.equal(toast.error.mock.callCount(), 0, 'not an error');
      assert.equal(snapshot(), before, 'nothing written: no order, nothing cancelled, no code use, no points moved');
      assert.equal(orderDoc(first.id).status, 'pending');
      assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 }, 'still the attempt’s');
      assert.equal(windows.length, 1, 'no payment window');
      assert.equal(router.push.mock.callCount(), 0);
      assert.equal(submitButton(page.result).props.disabled, false, 'the button is free again');
      assert.equal(buttonLabel(page.result), label);
    }
    assert.deepEqual(confirmations(), []);

    /* Razorpay answers again; the bank declined the payment. */
    rzp.down = false;
    auth.status = 'failed';
    await submit(page);
    const [retry] = newest([first.id]);
    assert.equal(lastOrderPost().status, 201);
    assert.equal(retry.total, rupees(label), 'charged what the button said');
    assert.deepEqual([orderDoc(first.id).status, orderDoc(first.id).cancelReason, orderDoc(first.id).replacedBy], ['cancelled', 'replaced', retry.id]);
    assert.deepEqual(holdings(), { usedCount: 1, usedBy: ['u:u-new'], parked: 0 }, 'the code and points moved to the retry, once');
    assert.equal(windows.at(-1).options.amount, rupees(label) * 100);
    await payInWindow();
    await settle();
    assert.equal(orderDoc(retry.id).status, 'confirmed');
    assert.deepEqual(confirmations(), confirmedOnce(retry.orderNumber));
    assert.deepEqual(statusMessages(), [], 'no "order cancelled" for the replaced attempt');
  });
});

/* ═════════════ B: verify on a replaced attempt ═════════════ */

describe('B: the window of an attempt another tab replaced is paid → PAID_AFTER_CANCEL → a refund, never /order-success', { skip }, () => {
  test('tab A’s window still open, tab B places COD (taking the attempt over), the shopper pays in tab A → the refund message; the next tap is never at a price the page didn’t show', async () => {
    signInAs(NEW);
    seedCart(PIECE, 1);
    const tabA = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(tabA.result), 'Place Order · ₹1,499');
    await submit(tabA);
    const [first] = allOrders();
    const w1 = windows[0]; // still open: a UPI collect request on its way

    const tabB = openDrawer(1);
    await settle();
    flowOf(tabB.result).setPaymentMethod('cod');
    await settle();
    await submit(tabB);
    unmount(tabB);
    const [cod] = newest([first.id]);
    assert.equal(cod.payment.method, 'cod');
    assert.deepEqual([orderDoc(first.id).status, orderDoc(first.id).replacedBy], ['cancelled', cod.id]);
    assert.deepEqual(confirmations(), confirmedOnce(cod.orderNumber), 'COD: told at once, as before');

    toast.mock.resetCalls();
    router.push.mock.resetCalls();
    const pay = await quietly(() => payInWindow(w1));
    await settle();
    const v = calls('POST', '/api/payments/verify').at(-1);
    assert.deepEqual([v.status, v.json.code, v.json.message], [409, 'PAID_AFTER_CANCEL', PAID_AFTER_CANCEL]);
    assert.deepEqual(toasts(), [PAID_AFTER_CANCEL]);
    assert.equal(router.push.mock.callCount(), 0, 'no /order-success');
    assert.equal(flowOf(tabA.result).verifying, false);
    assert.equal(submitButton(tabA.result).props.disabled, false);
    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.payment.status, A.payment.razorpayPaymentId, A.paidAfterCancel, A.refundDue], ['cancelled', 'paid', pay.id, true, true]);
    assert.equal(stock(), 5, 'no stock for a payment being refunded');
    assert.deepEqual(earned(), []);
    assert.equal(userDoc().pendingLoyaltyDiscount, 0, 'the points stay with the COD order');
    assert.deepEqual(confirmations(), confirmedOnce(cod.orderNumber), 'no "order confirmed" for the refunded payment');
    assert.deepEqual(statusMessages(), []);

    /* Razorpay's webhook for the same payment: the same, nothing new. */
    const once = snapshot();
    assert.equal((await webhookPaid(w1.options.order_id, pay)).status, 200);
    assert.equal(snapshot(), once);

    /* Tab A tapped again: the attempt was forgotten, so a fresh order —
       but tab A still shows the ₹100 the COD order took: refused with the
       server's figure, then placed at it. */
    toast.mock.resetCalls();
    const before = snapshot();
    await submit(tabA);
    assert.deepEqual([lastOrderPost().status, lastOrderPost().json.code, lastOrderPost().body.loyaltyDiscount], [409, 'LOYALTY_CHANGED', 100]);
    assert.equal(snapshot(), before);
    assert.deepEqual(toasts(), ['Your points discount is now ₹0. Please check your total and place the order again.']);
    assert.equal(buttonLabel(tabA.result), 'Place Order · ₹1,599');
    await submit(tabA);
    const [fresh] = newest([first.id, cod.id]);
    assert.equal(fresh.total, 1599);
    assert.equal(windows.at(-1).options.amount, 159900);
  });
});

/* ═════════════ C: "order confirmed" exactly once, only when paid ═════════════ */

describe('C: an online order’s "order confirmed" goes when it is paid — once, whichever path gets there', { skip }, () => {
  test('placed (nothing) → window closed (nothing) → paid on Pay again (one set) → the webhook, the clean-up and My Orders after it (nothing more)', async () => {
    signInAs(NEW);
    seedCart(PIECE, 1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    const [o] = allOrders();
    assert.deepEqual(confirmations(), [], 'not at creation');
    closeWindow();
    assert.deepEqual(confirmations(), []);
    await submit(page); // Pay again: the same order
    assert.equal(windows.length, 2);
    assert.equal(windows[1].options.order_id, o.payment.razorpayOrderId);
    const pay = await payInWindow(windows[1]);
    await settle();
    assert.equal(router.push.mock.calls.at(-1).arguments[0], `/order-success?orderNumber=${o.orderNumber}&email=new%40x.test`);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));

    assert.equal((await webhookPaid(o.payment.razorpayOrderId, pay)).status, 200);
    orderDoc(o.id).createdAt = ago(25 * HOUR);
    assert.deepEqual((await runCron()).json.checked, 0);
    assert.equal((await call(orderById, 'GET', undefined, { id: o.id })).status, 200);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
  });

  test('the tab closed before verify: the webhook confirms it (one set); a late verify from a second device adds nothing', async () => {
    signInAs(NEW);
    seedCart(PIECE, 1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    const [o] = allOrders();
    const w = windows[0];
    leavePage();
    const hook = await webhookPaid(o.payment.razorpayOrderId);
    assert.equal(hook.status, 200);
    assert.equal(orderDoc(o.id).status, 'confirmed');
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));

    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${w.options.order_id}|${hook.payment.id}`).digest('hex');
    const v = await call(verify, 'POST', { razorpayOrderId: w.options.order_id, razorpayPaymentId: hook.payment.id, razorpaySignature: signature, orderId: o.id });
    assert.deepEqual([v.status, v.json.success], [200, true]);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
  });

  test('the webhook missed: the daily clean-up finds it paid on Razorpay and confirms it (one set); the webhook arriving later adds nothing', async () => {
    const { first, w1 } = await abandonedAttempt({ code: null });
    const pay = payOnRazorpay(w1.options.order_id);
    orderDoc(first.id).createdAt = ago(25 * HOUR);
    const r = await runCron();
    assert.deepEqual([r.json.expired, r.json.settled], [[], [first.id]]);
    assert.equal(orderDoc(first.id).status, 'confirmed');
    assert.deepEqual(confirmations(), confirmedOnce(first.orderNumber));
    assert.equal((await webhookPaid(w1.options.order_id, pay)).status, 200);
    assert.deepEqual(confirmations(), confirmedOnce(first.orderNumber));
  });

  test('never paid: expired by the clean-up a day later — no "order confirmed", no "order cancelled", ever', async () => {
    const { first } = await abandonedAttempt();
    orderDoc(first.id).createdAt = ago(25 * HOUR);
    assert.deepEqual((await runCron()).json.expired, [first.id]);
    assert.deepEqual(sent, []);
  });

  test('a resend of "order confirmed" refuses an unpaid online attempt (vendor and store); once it is paid the store may resend it', async () => {
    db.store.get('orders').set('va1', {
      orderNumber: 'TBJ-VA1', userId: 'u-new', guestEmail: 'new@x.test', status: 'pending', vendorIds: ['vA'], vendorFees: { vA: 0 },
      items: [{ product: 'p1', name: 'Temple Jhumka', price: 1500, quantity: 1, vendorId: 'vA', supplyCost: 900 }],
      shippingAddress: { ...savedAddress, name: 'Priya R', email: 'new@x.test' }, total: 1500, createdAt: ago(HOUR),
      payment: { method: 'razorpay', status: 'pending', razorpayOrderId: 'order_va1', amountDue: 150000 },
    });
    rzp.orders.set('order_va1', { id: 'order_va1', amount: 150000, status: 'created' });

    const byVendor = await as(VENDOR, () => call(vendorResend, 'POST', undefined, { id: 'va1' }));
    assert.equal(byVendor.status, 409, byVendor.json.message);
    assert.match(byVendor.json.message, /hasn’t been paid/);
    const byStore = await as(OWNER, () => call(adminResend, 'POST', { orderId: 'va1', type: 'customer' }));
    assert.equal(byStore.json.success, false);
    assert.match(byStore.json.message, /hasn’t been paid yet/);
    /* Nor, once given up quietly (replaced by a newer order), an "order cancelled". */
    db.store.get('orders').set('va0', { ...orderDoc('va1'), orderNumber: 'TBJ-VA0', status: 'cancelled', cancelReason: 'replaced', replacedBy: 'va1' });
    assert.equal((await as(VENDOR, () => call(vendorResend, 'POST', undefined, { id: 'va0' }))).status, 409);
    assert.deepEqual(sent, []);
    assert.deepEqual(mailed, []);

    /* Paid: confirmed once by the webhook; a resend is the store's own choice. */
    await webhookPaid('order_va1');
    assert.deepEqual(confirmations(), confirmedOnce('TBJ-VA1'));
    const again = await as(OWNER, () => call(adminResend, 'POST', { orderId: 'va1', type: 'customer' }));
    assert.equal(again.json.success, true, again.json.message);
    assert.equal(mailed.length, 1);
    /* A COD order is placed when it is created: its confirmation may be resent. */
    db.store.get('orders').set('va2', { ...orderDoc('va1'), orderNumber: 'TBJ-VA2', status: 'pending', payment: { method: 'cod', status: 'pending' } });
    const cod = await as(VENDOR, () => call(vendorResend, 'POST', undefined, { id: 'va2' }));
    assert.equal(cod.status, 200, cod.json.message);
    assert.deepEqual(confirmations().at(-1), ['email:placed', 'TBJ-VA2']);
  });
});

/* ═════════════ D: the points discount shown, checked by the server ═════════════ */

describe('D: the points didn’t load → 409 LOYALTY_CHANGED, nothing written → the server’s figure is shown → the next tap is charged it', { skip }, () => {
  test('/checkout: ₹100 parked, the points request fails → ₹0 shown and sent → refused with ₹100 → shown → placed at ₹1,499', async () => {
    signInAs(NEW);
    seedCart(PIECE, 1);
    unreachable.add('GET /api/loyalty');
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,599', 'no points shown: they didn’t load');
    const before = snapshot();
    await submit(page);
    const refused = lastOrderPost();
    assert.equal(refused.body.loyaltyDiscount, 0, 'the ₹0 shown is sent');
    assert.deepEqual([refused.status, refused.json.code, refused.json.loyaltyDiscount, refused.json.parkedDiscount], [409, 'LOYALTY_CHANGED', 100, 100]);
    assert.equal(snapshot(), before, 'nothing written');
    assert.deepEqual(toasts(), ['Your points discount is now ₹100. Please check your total and place the order again.']);
    assert.equal(windows.length, 0);
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,499', 'the server’s figure, without asking for the points again');
    assert.match(textOf(page.result), /Points Discount-₹100/);

    await submit(page);
    const [o] = allOrders();
    assert.deepEqual([o.total, o.loyaltyDiscount], [rupees(label), 100]);
    assert.equal(windows[0].options.amount, rupees(label) * 100);
    await payInWindow();
    await settle();
    assert.deepEqual([orderDoc(o.id).status, captured().length], ['confirmed', 1]);
    assert.equal(userDoc().pendingLoyaltyDiscount, 0);
  });

  test('the points are held by an abandoned attempt: the tap asks Razorpay (never paid), is refused with no take-over, then the next tap takes the attempt over at the shown price', async () => {
    const { first } = await abandonedAttempt({ code: null });
    assert.equal(userDoc().pendingLoyaltyDiscount, 0, 'held by the attempt');
    unreachable.add('GET /api/loyalty');
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), 'Place Order · ₹1,599');
    const before = snapshot();
    await submit(page);
    assert.deepEqual([lastOrderPost().json.code, lastOrderPost().json.loyaltyDiscount, lastOrderPost().json.parkedDiscount], ['LOYALTY_CHANGED', 100, 100], 'parkedDiscount counts what the attempt would hand over');
    assert.equal(snapshot(), before, 'no order, the attempt not replaced');
    assert.equal(orderDoc(first.id).status, 'pending');
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,499');

    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    assert.equal(buttonLabel(page.result), label, 'no COD fee above ₹500');
    await submit(page);
    const [cod] = newest([first.id]);
    assert.deepEqual([cod.payment.method, cod.total, cod.loyaltyDiscount], ['cod', rupees(label), 100]);
    assert.deepEqual([orderDoc(first.id).cancelReason, orderDoc(first.id).replacedBy], ['replaced', cod.id]);
    assert.equal(userDoc().pendingLoyaltyDiscount, 0);
    assert.deepEqual(confirmations(), confirmedOnce(cod.orderNumber));
    assert.deepEqual(statusMessages(), []);
  });

  test('Buy Now: ₹1,000 parked on a ₹1,500 piece, the points don’t load → refused with ₹300 (the 20% cap) → the drawer shows ₹1,299 → placed at it; ₹700 stays parked', async () => {
    userDoc().pendingLoyaltyDiscount = 1000;
    signInAs(NEW);
    unreachable.add('GET /api/loyalty');
    const drawer = openDrawer(1);
    await settle();
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,599');
    const before = snapshot();
    await submit(drawer);
    assert.deepEqual([lastOrderPost().json.code, lastOrderPost().json.loyaltyDiscount, lastOrderPost().json.parkedDiscount], ['LOYALTY_CHANGED', 300, 1000]);
    assert.equal(snapshot(), before);
    assert.equal(textOf(drawerNote(drawer.result)), 'Your points discount is now ₹300. Please check your total and place the order again.');
    assert.equal(drawerNote(drawer.result).props.role, 'status');
    const label = buttonLabel(drawer.result);
    assert.equal(label, 'Place order · ₹1,299');
    await submit(drawer);
    const [o] = allOrders();
    assert.deepEqual([o.total, o.loyaltyDiscount], [rupees(label), 300]);
    assert.equal(windows[0].options.amount, rupees(label) * 100);
    assert.equal(userDoc().pendingLoyaltyDiscount, 700);
  });
});

/* ═════════════ E: COD at the ₹20,000 limit ═════════════ */

describe('E: COD at ₹20,000 — whenever the page offers COD the server accepts it, and whenever it doesn’t the server refuses it', { skip }, () => {
  /* Delivery is never free (₹99) and the COD fee (₹49) is never waived. */
  const ALWAYS_FEES = { ...DEFAULT_CHARGES, free_shipping_threshold: 0, cod_fee_waive_above: null };
  /* [label, price, coupon, points parked, charges, the COD note (null:
     offered)] — total before points = price − coupon + delivery + COD fee.
     The note spells that figure out when the total shown is under ₹20,000. */
  const NO = 'Not available above ₹20,000';
  const CASES = [
    ['₹19,852 + ₹99 + ₹49 = ₹20,000: offered', 19852, null, 0, ALWAYS_FEES, null],
    ['₹19,853 + ₹99 + ₹49 = ₹20,001: not offered', 19853, null, 0, ALWAYS_FEES, `${NO} — ₹20,001 with the COD fee`],
    ['₹19,900 + ₹99 = ₹19,999 online, ₹20,048 with the COD fee: not offered', 19900, null, 0, ALWAYS_FEES, `${NO} — ₹20,048 with the COD fee`],
    ['₹20,001 before ₹100 of points: not offered (points don’t count)', 19853, null, 100, ALWAYS_FEES, `${NO} — ₹20,001 with the COD fee, before points`],
    ['₹20,000 before ₹100 of points: offered, ₹19,900 to pay', 19852, null, 100, ALWAYS_FEES, null],
    ['₹19,952 − FEST100 + ₹148 = ₹20,000: offered', 19952, 'FEST100', 0, ALWAYS_FEES, null],
    ['₹19,953 − FEST100 + ₹148 = ₹20,001, ₹500 of points: not offered', 19953, 'FEST100', 500, ALWAYS_FEES, `${NO} — ₹20,001 with the COD fee, before points`],
    ['the store’s defaults (free delivery, no COD fee above ₹500): ₹20,000 offered', 20000, null, 0, DEFAULT_CHARGES, null],
    ['the store’s defaults: ₹20,001 not offered', 20001, null, 0, DEFAULT_CHARGES, NO],
  ];
  const piece = (price) => ({ _id: 'pc', id: 'pc', name: 'Bridal Set', sku: 'BS-01', price, discountPrice: price, stock: 5, images: [] });
  function stockThe(price, charges) {
    db.store.get('products').set('pc', { name: 'Bridal Set', sku: 'BS-01', price, discountPrice: price, stock: 5, isActive: true });
    db.store.get('settings').set('store_settings', { ...charges });
  }

  for (const surface of ['/checkout', 'Buy Now']) {
    for (const [label, price, code, parked, charges, note] of CASES) {
      const offered = note === null;
      if (surface === 'Buy Now' && code) continue; // the drawer's coupon box is its own flow; /checkout covers coupons
      test(`${surface}: ${label}`, async () => {
        stockThe(price, charges);
        userDoc().pendingLoyaltyDiscount = parked;
        signInAs(NEW);
        if (code) remember(code);
        let page;
        if (surface === '/checkout') {
          seedCart(piece(price), 1);
          page = mountPage(() => CheckoutPage());
        } else {
          page = openDrawer(1, piece(price));
        }
        await settle();
        const flow = flowOf(page.result);
        if (code) assert.equal(cart.coupon?.code, code);
        assert.equal(flow.codBlocked, !offered, 'the page’s verdict');
        assert.equal(codRadio(page.result).props.disabled, !offered);
        if (!offered) assert.ok(textOf(paymentFields(page.result)).endsWith(`Cash on Delivery${note}`), textOf(paymentFields(page.result)));

        if (offered) {
          /* The page offers it → COD through the page is accepted, at the button. */
          flow.setPaymentMethod('cod');
          await settle();
          assert.equal(flowOf(page.result).paymentMethod, 'cod');
          const button = buttonLabel(page.result);
          await submit(page);
          assert.equal(lastOrderPost().status, 201, lastOrderPost().json?.message);
          const [o] = allOrders();
          assert.deepEqual([o.payment.method, o.total], ['cod', rupees(button)]);
          assert.equal(o.loyaltyDiscount, parked ? Math.min(parked, Math.floor(price * 0.2)) : 0);
        } else {
          /* The page doesn't offer it (selecting it falls back to online) →
             the server refuses the same order as COD, with the page's own figures. */
          flow.setPaymentMethod('cod');
          await settle();
          assert.equal(flowOf(page.result).paymentMethod, 'razorpay');
          const shownFlow = flowOf(page.result);
          const r = await call(orders, 'POST', {
            items: [{ product: 'pc', quantity: 1 }], shippingAddress: savedAddress, payment: { method: 'cod' },
            shippingCost: shownFlow.shippingCost, codFee: shownFlow.codFeeIfSelected, loyaltyDiscount: shownFlow.loyaltyDiscount,
            ...(code && { couponCode: code, couponDiscount: cart.discount }),
          });
          assert.equal(r.status, 400, JSON.stringify(r.json));
          assert.match(r.json.message, COD_LIMIT);
          assert.deepEqual(allOrders(), []);
          /* …and the online order the page does offer goes through, at the button. */
          const button = buttonLabel(page.result);
          await submit(page);
          const [o] = allOrders();
          assert.deepEqual([o.payment.method, o.total], ['razorpay', rupees(button)]);
          assert.equal(windows.at(-1).options.amount, rupees(button) * 100);
        }
      });
    }
  }
});

/* ═════════════ F: the kept attempt was replaced by a newer order ═════════════ */

describe('F: Pay again on an attempt a newer order replaced → told, nothing placed in that tap; the next tap places a fresh order', { skip }, () => {
  test('Buy Now kept its attempt; /checkout in another tab placed COD (taking its points) → the drawer’s Pay again: the message, no order, no window; the next tap: a fresh order at the drawer’s new price', async () => {
    signInAs(NEW);
    const drawer = openDrawer(1);
    await settle();
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,499');
    await submit(drawer);
    const [first] = allOrders();
    closeWindow(); // kept for a retry

    seedCart(PIECE, 1);
    const other = mountPage(() => CheckoutPage());
    await settle();
    flowOf(other.result).setPaymentMethod('cod');
    await settle();
    await submit(other);
    unmount(other);
    const [cod] = newest([first.id]);
    assert.deepEqual([cod.loyaltyDiscount, orderDoc(first.id).replacedBy], [100, cod.id]);

    const before = snapshot();
    await submit(drawer); // Pay again
    const pay = calls('POST', '/api/payments/create-order').at(-1);
    assert.deepEqual([pay.body.orderId, pay.status, pay.json.code, pay.json.replaced], [first.id, 409, 'ORDER_CANCELLED', true]);
    assert.equal(textOf(drawerNote(drawer.result)), REPLACED);
    assert.equal(drawerNote(drawer.result).props.role, 'status');
    assert.deepEqual(newest([first.id, cod.id]), [], 'nothing placed in that tap');
    assert.equal(snapshot(), before);
    assert.equal(windows.length, 1, 'no payment window');
    assert.equal(buttonLabel(drawer.result), 'Place order · ₹1,599', 'the newer order took the points: the price is brought up to date');
    assert.equal(submitButton(drawer.result).props.disabled, false);

    await submit(drawer);
    const [fresh] = newest([first.id, cod.id]);
    assert.ok(fresh, 'the next tap places a fresh order');
    assert.equal(fresh.total, 1599);
    assert.equal(windows.at(-1).options.amount, 159900);
    assert.equal(calls('POST', '/api/payments/create-order').at(-1).body.orderId, fresh.id, 'never the replaced attempt again');
    await payInWindow();
    await settle();
    assert.deepEqual(confirmations(), [...confirmedOnce(cod.orderNumber), ...confirmedOnce(fresh.orderNumber)]);
    assert.deepEqual(statusMessages(), [], 'no "order cancelled" for the replaced attempt');
  });

  test('ORDER_CANCELLED without replaced (expired by the clean-up): a fresh order in the same tap, at the button’s price', async () => {
    signInAs(NEW);
    seedCart(PIECE, 1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    const label = buttonLabel(page.result);
    await submit(page);
    const [first] = allOrders();
    closeWindow();
    orderDoc(first.id).createdAt = ago(25 * HOUR);
    assert.deepEqual((await runCron()).json.expired, [first.id]);
    await submit(page);
    const pays = calls('POST', '/api/payments/create-order');
    assert.deepEqual([pays.at(-2).json.code, pays.at(-2).json.replaced], ['ORDER_CANCELLED', false]);
    const [fresh] = newest([first.id]);
    assert.equal(fresh.total, rupees(label));
    assert.equal(windows.at(-1).options.amount, rupees(label) * 100);
    assert.deepEqual(sent, []);
  });
});
