/* ─────────────────────────────────────────────
   CRO round 4 — three regressions found in review, through the REAL route
   handlers (and, for A's convergence and B, the shopper's REAL /checkout
   page, as tests/cro-round4-e2e.test.mjs):

     R-A  A Razorpay outage must not block an order (COD included). An
          earlier attempt Razorpay can't be asked about is taken over as
          before (cancelled as replaced; its code and points move to this
          order), so the page's price and the charged price agree at once.
          Leaving it alive would turn a late payment on it into a second
          live order, and could cost a first-order code behind a false
          "already used" — cancelled, a late payment is recorded for a
          refund instead. A paid attempt is still settled
          (EARLIER_ORDER_PAID); one in progress still answers
          EARLIER_PAYMENT_PENDING.
     R-B  The two "already paid" answers (create-order on the kept attempt,
          the page's own give-up PUT /api/orders/[id]) confirm the order
          first, through settlePaidOrder — stock, points, the customer's
          "order confirmed" — instead of opening /order-success on a
          pending order. Paid but unreadable → EARLIER_PAYMENT_PENDING.
     R-C  The customer's "order confirmed" is claimed once in the settling
          transaction, sent AFTER the response (after()), inline where
          there is no request, released when a send fails (the next
          settlePaidOrder call sends it, nothing else redone), and bounded
          by timeouts (nodemailer, WhatsApp fetch).

   Only the edges are fakes: the NextAuth session, Firestore (in-memory,
   every transaction held to "all reads before any write"), email and
   WhatsApp (recorded, and made to fail or hang on demand), the Razorpay
   SDK and its checkout window. A request is simulated with Next's own
   request store (what after() reads), so after() is the real one.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { fakeFirestore, INC } from './helpers/fakeFirestore.mjs';

/* Next's request store needs this before 'next/server' is first loaded
   (the server sets it itself). */
globalThis.AsyncLocalStorage = AsyncLocalStorage;

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.CRON_SECRET = 'cron-test-secret';
process.env.SMTP_USER = 'shop@tulsi.test';
process.env.SMTP_PASS = 'smtp-test';
process.env.ULTRAMSG_INSTANCE_ID = 'instance1';
process.env.ULTRAMSG_TOKEN = 'token1';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;
delete process.env.SHIPROCKET_EMAIL;

const PENDING_IN_PROGRESS = 'Your earlier payment is still being processed. Please wait a few minutes and check My Orders before paying again.';
const PENDING_UNCHECKED = "We couldn't check your earlier payment just now. Please try again in a minute.";
const EARLIER_PAID = 'Your earlier payment went through — we have confirmed that order.';
const USED_MESSAGE = 'You have already used FEST100. Please check your total and place the order again.';

/* ═════════════ Server: real routes, fake edges ═════════════ */

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
const require = createRequire(import.meta.url);
let db;
let serverSession = null;
const getServerSession = async () => serverSession;

/* Razorpay's own ledger of orders and payments. down: unreachable (every
   order, or just those in downFor); hang: never answers; noPaymentsApi: the
   order can be read but not its payments. */
const rzp = { orders: new Map(), payments: new Map(), creates: 0, fetches: 0, down: false, downFor: new Set(), hang: null, noPaymentsApi: false, onFetch: null };
const unreachable = (id) => rzp.down || rzp.downFor.has(id);
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
        rzp.fetches += 1;
        if (rzp.hang) return rzp.hang();
        if (unreachable(id)) throw new Error('ETIMEDOUT');
        rzp.onFetch?.(id);
        if (!rzp.orders.has(id)) throw Object.assign(new Error('not found'), { error: { description: 'The id provided does not exist' } });
        return { ...rzp.orders.get(id) };
      },
      fetchPayments: async (id) => {
        if (rzp.noPaymentsApi || unreachable(id)) throw new Error('unavailable');
        return { items: [...rzp.payments.values()].filter((p) => p.order_id === id).map((p) => ({ ...p })) };
      },
    };
    this.payments = {
      fetch: async (id) => ({ ...rzp.payments.get(id) }),
      capture: async (id) => ({ ...rzp.payments.get(id), status: 'captured' }),
    };
  }
}

/* Every message the customer gets: [kind, orderNumber, status?]; every
   attempt to send one: [channel, orderNumber]. A channel in `senders` is
   made to fail (false / throw) or hang. */
const sent = [];
const attempts = [];
const senders = { email: null, wa: null };
const record = (kind) => async (o, status) => { sent.push([kind, o?.orderNumber, status]); };
const noop = async () => {};
/* Like the real sendOrderConfirmation: true when sent, false when refused. */
async function sendConfirmationEmail(o) {
  attempts.push(['email', o?.orderNumber]);
  if (senders.email && (await senders.email(o)) === false) return false;
  sent.push(['email:placed', o?.orderNumber]);
  return true;
}
async function sendConfirmationWhatsApp(o) {
  attempts.push(['wa', o?.orderNumber]);
  if (senders.wa) await senders.wa(o);
  sent.push(['wa:placed', o?.orderNumber]);
  return { success: true };
}

/* The SMTP transports the REAL email.js asks nodemailer for; fail: the server refuses. */
const transports = [];
const mailer = { fail: false };
mock.module('razorpay', { defaultExport: FakeRazorpay });
mock.module('nodemailer', { defaultExport: { createTransport: (options) => { transports.push(options); return { verify: async () => true, sendMail: async () => { if (mailer.fail) throw new Error('550 mailbox unavailable'); } }; } } });
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
    ...Object.fromEntries(['sendOTPEmail', 'sendReviewNotification', 'sendContactNotification', 'sendRentalConfirmation', 'sendRentalNotificationToAdmin', 'sendVendorOrderNotification', 'isConfigured'].map((n) => [n, noop])),
    sendOrderConfirmation: sendConfirmationEmail,
    sendOrderNotificationToAdmin: record('admin:email'),
    sendStatusUpdateEmail: record('email:status'),
    esc: (v) => String(v ?? ''),
  },
});
mock.module(src('lib/whatsapp.js'), {
  namedExports: {
    ...Object.fromEntries(['sendContactWhatsApp', 'sendReviewWhatsApp', 'sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer', 'isConfigured'].map((n) => [n, noop])),
    sendOrderWhatsAppToCustomer: sendConfirmationWhatsApp,
    sendOrderWhatsAppToAdmin: record('admin:wa'),
    sendStatusWhatsApp: record('wa:status'),
  },
});

const route = (p) => import(src(`app/api/${p}/route.js`));
const [orders, orderById, validate, createOrder, verify, webhookRoute, siteSettings, address, loyalty, storeCharges, expireCron] = await Promise.all([
  route('orders'), route('orders/[id]'), route('coupons/validate'), route('payments/create-order'), route('payments/verify'),
  route('payments/webhook'), route('admin/settings'), route('user/address'), route('loyalty'), route('store-charges'),
  route('cron/expire-unpaid-orders'),
]);
const { settlePaidOrder } = await import(src('lib/settlePayment.js'));
/* The real mail and WhatsApp senders (a query string keeps them apart from the recorded ones above). */
const realEmail = await import(`${src('lib/email.js')}?real`);
const realWhatsApp = await import(`${src('lib/whatsapp.js')}?real`);
const { workAsyncStorage } = require('next/dist/server/app-render/work-async-storage.external');

/* A request, as Next has it while a route handler runs: after() queues the
   task for once the response has been sent. flushAfter() is "the response
   has gone": the queued work runs. */
const afterQueue = [];
const requestStore = { afterContext: { after: (task) => { afterQueue.push(task); } } };
const inRequest = (fn) => workAsyncStorage.run(requestStore, fn);
async function flushAfter() {
  while (afterQueue.length) {
    const task = afterQueue.shift();
    await (typeof task === 'function' ? task() : task);
  }
}

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
const nextIp = () => `10.17.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
let inflight = 0;
const browserFetch = async (url, init = {}) => {
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
    entry.json = await res.clone().json().catch(() => null);
    return res;
  } finally {
    inflight -= 1;
  }
};
globalThis.fetch = browserFetch;
const calls = (method, p) => wire.filter((c) => c.method === method && (p instanceof RegExp ? p.test(c.path) : c.path === p));
const lastOrderPost = () => calls('POST', '/api/orders').at(-1);

/* A route called directly, not from a page: the webhook, the cron, a script. */
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* `promise`'s answer — or, if it takes longer than `ms`, the answer a test gets for waiting on something that never comes. */
async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve('waited for the mail'), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

/* The shopper approves the payment in their UPI app (or pays in the
   window): Razorpay has it, nobody has told us. 'captured' → paid;
   'authorized' → still going through. */
function payOnRazorpay(rzpOrderId, status = 'captured', extra = {}) {
  const o = rzp.orders.get(rzpOrderId);
  const pay = { id: `pay_${rzp.payments.size + 1}`, order_id: o.id, status, amount: o.amount, currency: 'INR', ...extra };
  rzp.payments.set(pay.id, pay);
  o.status = status === 'captured' ? 'paid' : 'attempted';
  return pay;
}
const signedIds = (pay) => ({
  razorpayOrderId: pay.order_id,
  razorpayPaymentId: pay.id,
  razorpaySignature: crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${pay.order_id}|${pay.id}`).digest('hex'),
});
async function webhookPaid(pay) {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { ...pay, status: 'captured' } } } });
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  return quietly(() => call(webhookRoute, 'POST', body, {}, { 'x-razorpay-signature': signature }));
}
const verifyPayment = (pay, orderId) => call(verify, 'POST', { ...signedIds(pay), orderId });
const runCron = () => quietly(() => call(expireCron, 'GET', undefined, {}, { authorization: `Bearer ${process.env.CRON_SECRET}` }));
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

/* ═════════════ Client modules: sucrase + a tiny hook runner ═════════════ */

let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the pages and hooks cannot be transpiled for node --test';

const SRC = path.resolve('src');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const REAL = new Set(['react/jsx-runtime', 'date-fns']);
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
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const { code } = sucrase.transform(readFileSync(file, 'utf8'), { transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file });
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
  'react-icons/fi': new Proxy({}, { get: (_, name) => (typeof name === 'string' && /^Fi/.test(name) ? function Icon() { return null; } : undefined), has: () => true }),
  '@/context/CartContext': { useCart: () => cart },
  '@/lib/loadRazorpay': { loadRazorpayScript: async () => {} },
  '@/lib/analytics/tracker': { track() {} },
}) : null;
const CheckoutPage = sucrase ? loadApp('app/checkout/page.js').default : null;

const mounted = new Set();
function mountPage(view) {
  const h = renderHook(() => {
    cart = CartProvider({ children: null }).props.value;
    return view();
  });
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
async function submit(page) {
  const form = find(page.result, (el) => el.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  await settle();
}

/* ═════════════ The shop ═════════════ */

const NEW = { id: 'u-new', email: 'new@x.test', emailVerified: true, name: 'Priya' };
const ADDRESS = { id: 'a1', fullName: 'Priya R', phone: '9876543210', street: '12 Temple St', city: 'Madurai', state: 'Tamil Nadu', pincode: '625001' };
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
/* Real Firestore runs two transactions on one document one after the other
   (the second re-reads what the first wrote); the fake interleaves them. */
function serialTransactions(fake) {
  const run = fake.runTransaction.bind(fake);
  let tail = Promise.resolve();
  fake.runTransaction = (fn) => {
    const turn = tail.then(() => run(fn));
    tail = turn.catch(() => {});
    return turn;
  };
  return fake;
}

const seedCart = (piece, qty = 1) => local.set('tulsi-cart', JSON.stringify({ items: [{ ...piece, quantity: qty }], coupon: null, discount: 0, discountAt: null }));
const remember = (code) => local.set('tj-pending-coupon', JSON.stringify({ code, at: Date.now() }));
const couponDoc = (id = 'fest') => db.store.get('coupons').get(id);
const orderDoc = (id) => db.store.get('orders').get(id);
const allOrders = () => [...db.store.get('orders').entries()].map(([id, o]) => ({ id, ...o }));
const newest = (known) => allOrders().filter((o) => !known.includes(o.id));
const userDoc = (id = 'u-new') => db.store.get('users').get(id);
const stock = (id = 'p1') => db.store.get('products').get(id).stock;
const confirmations = () => sent.filter(([k]) => k.endsWith(':placed')).map(([k, n]) => [k, n]);
const confirmedOnce = (orderNumber) => [['email:placed', orderNumber], ['wa:placed', orderNumber]];
const statusMessages = () => sent.filter(([k]) => k.endsWith(':status'));
const toasts = () => toast.mock.calls.map((c) => c.arguments[0]);
/* Every document but the rate-limit counters, for "nothing was written". */
const snapshot = () => {
  syncDotted();
  return JSON.stringify([...db.store.entries()].filter(([c, m]) => c !== 'rateLimits' && m.size > 0)
    .map(([c, m]) => [c, [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1))]));
};

function resetWorld() {
  leavePage();
  serverSession = null;
  sessionState.data = null; sessionState.status = 'unauthenticated';
  rzp.orders.clear(); rzp.payments.clear();
  Object.assign(rzp, { creates: 0, fetches: 0, down: false, hang: null, noPaymentsApi: false, onFetch: null });
  rzp.downFor.clear();
  wire = []; sent.length = 0; attempts.length = 0; transports.length = 0; afterQueue.length = 0;
  senders.email = null; senders.wa = null; mailer.fail = false;
  local.clear(); tab.clear(); listeners.clear(); windows.length = 0;
  router.push.mock.resetCalls(); router.replace.mock.resetCalls();
  toast.mock.resetCalls(); toast.error.mock.resetCalls(); toast.success.mock.resetCalls();
  db = strictTransactions(fakeFirestore({
    products: {
      p1: { name: 'Temple Jhumka', sku: 'TJ-ER-104', price: 2000, discountPrice: 1500, stock: 5, isActive: true },
    },
    coupons: {
      welcome: { ...COUPON, code: 'TULSI10', value: 10, firstOrderOnly: true },
      fest: { ...COUPON, code: 'FEST100', type: 'fixed', value: 100 },
    },
    orders: {},
    users: { 'u-new': { email: 'new@x.test', name: 'Priya', savedAddresses: [ADDRESS], pendingLoyaltyDiscount: 100, loyaltyPoints: 0 } },
    settings: { site: { onlinePaymentEnabled: true, loyaltyEnabled: true } },
  }));
}
beforeEach(resetWorld);
afterEach(leavePage);

/* What checkout posts: ₹1,500 piece, delivery ₹99, no COD fee above ₹500. */
const post = (body) => call(orders, 'POST', body);
const codOrder = (extra = {}) => ({ items: [{ product: 'p1', quantity: 1 }], shippingAddress: ADDRESS, payment: { method: 'cod' }, ...extra });
const onlineOrder = (extra = {}) => codOrder({ payment: { method: 'razorpay' }, ...extra });
const payFor = (orderId) => call(createOrder, 'POST', { orderId });
const cancel = (id, extra = {}) => call(orderById, 'PUT', { status: 'cancelled', ...extra }, { id });

/* An online order of the signed-in customer (with FEST100 and/or the ₹100
   parked points) whose payment window was opened and then abandoned. */
async function abandonedOnline({ code = 'FEST100', points = true, discount = 100 } = {}) {
  signInAs(NEW);
  if (!points) userDoc().pendingLoyaltyDiscount = 0;
  const a = await post(onlineOrder(code ? { couponCode: code, couponDiscount: discount } : {}));
  assert.equal(a.status, 201, a.json.message);
  const pay = await payFor(a.json.data.id);
  assert.equal(pay.status, 200, pay.json.message);
  sent.length = 0; attempts.length = 0;
  return { id: a.json.data.id, orderNumber: a.json.data.orderNumber, rzpOrderId: pay.json.data.id, total: a.json.data.total };
}
/* A second unpaid online attempt, seeded: holds ₹40 of points, its own Razorpay order. */
function seedAttempt(id, { holds = 40, status = 'created' } = {}) {
  db.store.get('orders').set(id, {
    orderNumber: `TBJ-${id}`, userId: 'u-new', guestEmail: 'new@x.test', status: 'pending', createdAt: ago(HOUR), total: 1500,
    items: [{ product: 'p1', name: 'Temple Jhumka', price: 1500, quantity: 1 }], loyaltyDiscount: holds,
    shippingAddress: { ...ADDRESS, name: 'Priya R', email: 'new@x.test' },
    payment: { method: 'razorpay', status: 'pending', razorpayOrderId: `order_${id}`, amountDue: 150000 },
  });
  rzp.orders.set(`order_${id}`, { id: `order_${id}`, amount: 150000, status });
  return `order_${id}`;
}
/* The attempt is still exactly as it was: not cancelled, not moved, still holding. */
function assertUntouched(id, { holdsPoints = 0 } = {}) {
  const A = orderDoc(id);
  assert.equal(A.status, 'pending');
  for (const f of ['cancelReason', 'replacedBy', 'couponMovedTo', 'loyaltyMovedTo', 'loyaltyRestored', 'couponReleased', 'paidAfterCancel']) assert.equal(A[f], undefined, `${id}.${f}`);
  if (holdsPoints) assert.equal(A.loyaltyDiscount, holdsPoints);
}

/* ═════════════ R-A: a Razorpay outage must not block an order ═════════════ */

describe('R-A: an earlier attempt Razorpay can’t be asked about is taken over as before — the order is placed, a late payment on it is refunded', () => {
  /* Cancelled as replaced, with what it held moved to this order. */
  const assertTakenOver = (id, newId) => {
    const A = orderDoc(id);
    assert.deepEqual([A.status, A.cancelReason, A.replacedBy], ['cancelled', 'replaced', newId]);
  };

  test('points only: Razorpay is down and the page shows ₹100 → placed at once at that price (no refusal); the attempt is replaced and its points move', async () => {
    const first = await abandonedOnline({ code: null });
    rzp.down = true;

    const r = await quietly(() => post(codOrder({ loyaltyDiscount: 100 })));
    assert.equal(r.status, 201, r.json.message);
    assert.deepEqual([r.json.data.loyaltyDiscount, r.json.data.total], [100, 1499], '₹1,500 − ₹100 + ₹99 delivery');
    assert.deepEqual(confirmations(), confirmedOnce(r.json.data.orderNumber), 'a COD order is told at once');
    assertTakenOver(first.id, r.json.data.id);
    assert.deepEqual(statusMessages(), [], 'no "order cancelled" for the attempt');
    assert.equal(userDoc().pendingLoyaltyDiscount, 0);
  });

  test('an older page (no figure sent) is placed the same way, never refused for the outage', async () => {
    const first = await abandonedOnline({ code: null });
    rzp.down = true;
    const r = await quietly(() => post(codOrder()));
    assert.equal(r.status, 201, r.json.message);
    assert.equal(r.json.data.total, 1499);
    assertTakenOver(first.id, r.json.data.id);
  });

  test('the code and the points are both held: both move to this order — the code counted once, no refusal', async () => {
    const first = await abandonedOnline();
    rzp.down = true;
    const r = await quietly(() => post(codOrder({ couponCode: 'FEST100', couponDiscount: 100, loyaltyDiscount: 100 })));
    assert.equal(r.status, 201, r.json.message);
    assert.equal(r.json.data.total, 1399, '₹1,500 − ₹100 − ₹100 + ₹99');
    assertTakenOver(first.id, r.json.data.id);
    assert.deepEqual([couponDoc().usedCount, couponDoc().usedBy], [1, ['u:u-new']], 'its use of the code moves, counted once');
  });

  test('a first-order code held by the attempt survives the outage — it is neither refused as "used" nor lost', async () => {
    const first = await abandonedOnline({ code: 'TULSI10', discount: 150, points: false });
    rzp.down = true;
    const r = await quietly(() => post(codOrder({ couponCode: 'TULSI10', couponDiscount: 150, loyaltyDiscount: 0 })));
    assert.equal(r.status, 201, r.json.message);
    assert.deepEqual([r.json.data.discount, r.json.data.total], [150, 1449], '₹1,500 − ₹150 + ₹99');
    assertTakenOver(first.id, r.json.data.id);
    assert.deepEqual([couponDoc('welcome').usedCount, couponDoc('welcome').usedBy], [1, ['u:u-new']]);
  });

  test('an online order is placed too, at the price of its own window', async () => {
    const first = await abandonedOnline({ code: null });
    rzp.down = true;
    const r = await quietly(() => post(onlineOrder({ loyaltyDiscount: 100 })));
    assert.equal(r.status, 201, r.json.message);
    const pay = await payFor(r.json.data.id);
    assert.equal(pay.status, 200, pay.json.message);
    assert.equal(pay.json.data.amount, 149900);
    assertTakenOver(first.id, r.json.data.id);
  });

  test('every attempt Razorpay can’t be asked about is taken over, a never-paid one beside it too', async () => {
    const left = await abandonedOnline({ code: null });
    seedAttempt('b1', { holds: 40, status: 'created' });
    rzp.downFor.add(left.rzpOrderId);
    const r = await quietly(() => post(codOrder({ loyaltyDiscount: 140 })));
    assert.equal(r.status, 201, r.json.message);
    assert.deepEqual([r.json.data.loyaltyDiscount, r.json.data.total], [140, 1459], '₹100 + ₹40 of points');
    assertTakenOver(left.id, r.json.data.id);
    assertTakenOver('b1', r.json.data.id);
  });

  test('a paid attempt is still settled and answered EARLIER_ORDER_PAID — nothing else is touched, the one Razorpay can’t be asked about beside it included', async () => {
    const paid = await abandonedOnline();
    seedAttempt('b1', { holds: 40 });
    rzp.downFor.add('order_b1');
    const pay = payOnRazorpay(paid.rzpOrderId);
    const r = await quietly(() => post(codOrder({ couponCode: 'FEST100', couponDiscount: 100, loyaltyDiscount: 140 })));
    assert.deepEqual([r.status, r.json.code, r.json.orderId, r.json.message], [409, 'EARLIER_ORDER_PAID', paid.id, EARLIER_PAID]);
    assert.deepEqual([orderDoc(paid.id).status, orderDoc(paid.id).payment.razorpayPaymentId], ['confirmed', pay.id]);
    assert.deepEqual(confirmations(), confirmedOnce(paid.orderNumber));
    assertUntouched('b1', { holdsPoints: 40 });
    assert.equal(allOrders().length, 2, 'no new order');
  });

  test('a payment in progress is still EARLIER_PAYMENT_PENDING with the in-progress wording — also beside one Razorpay can’t be asked about', async () => {
    const going = await abandonedOnline();
    seedAttempt('b1', { holds: 40 });
    rzp.downFor.add('order_b1');
    payOnRazorpay(going.rzpOrderId, 'authorized');
    const before = snapshot();
    const r = await quietly(() => post(codOrder({ couponCode: 'FEST100', couponDiscount: 100 })));
    assert.deepEqual(r.json, { success: false, code: 'EARLIER_PAYMENT_PENDING', orderId: going.id, message: PENDING_IN_PROGRESS });
    assert.equal(r.status, 409);
    assert.equal(snapshot(), before);
  });

  test('paid but unreadable still answers “couldn’t check” — it is not taken over, unlike an unreachable Razorpay', async () => {
    const first = await abandonedOnline({ code: null });
    payOnRazorpay(first.rzpOrderId);
    rzp.noPaymentsApi = true;
    const before = snapshot();
    const r = await quietly(() => post(codOrder({ loyaltyDiscount: 100 })));
    assert.deepEqual(r.json, { success: false, code: 'EARLIER_PAYMENT_PENDING', orderId: first.id, message: PENDING_UNCHECKED });
    assert.equal(snapshot(), before);
  });

  test('a payment that lands on the attempt after the outage is a refund, never a second live order: one order stands, the other is recorded as refund due', async () => {
    const first = await abandonedOnline();
    rzp.down = true;
    const placed = await quietly(() => post(codOrder({ loyaltyDiscount: 100, couponCode: 'FEST100', couponDiscount: 100 })));
    assert.equal(placed.status, 201);
    rzp.down = false;
    const stockBefore = stock();

    const pay = payOnRazorpay(first.rzpOrderId);
    assert.equal((await webhookPaid(pay)).status, 200);
    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.payment.status, A.paidAfterCancel, A.refundDue], ['cancelled', 'paid', true, true]);
    assert.equal(stock(), stockBefore, 'no stock for the attempt');
    assert.deepEqual([orderDoc(placed.json.data.id).status, orderDoc(placed.json.data.id).payment.status], ['pending', 'pending']);
    assert.deepEqual(confirmations().filter(([, n]) => n === first.orderNumber), [], 'no "order confirmed" for a payment being refunded');
    assert.deepEqual([couponDoc().usedCount, couponDoc().usedBy], [1, ['u:u-new']], 'the code is still counted once');
  });

  test('the taken-over attempt is not expired a second time by the clean-up: nothing is handed back twice', async () => {
    const first = await abandonedOnline();
    rzp.down = true;
    const placed = await quietly(() => post(codOrder({ loyaltyDiscount: 100, couponCode: 'FEST100', couponDiscount: 100 })));
    assert.equal(placed.status, 201);
    rzp.down = false;
    orderDoc(first.id).createdAt = ago(25 * HOUR);
    const r = await runCron();
    assert.deepEqual(r.json.expired, []);
    assert.deepEqual([couponDoc().usedCount, couponDoc().usedBy], [1, ['u:u-new']]);
    assert.equal(userDoc().pendingLoyaltyDiscount, 0);
  });
});

/* ── R-A end to end: the real /checkout page against the real routes ── */

describe('R-A end to end: Razorpay is down → the page’s price and the charged price agree, on the first tap', { skip }, () => {
  /* /checkout: Place order (online, with the remembered code) → the window
     opens → closed without paying; the page is left (a reload). */
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
    closeWindow(windows.at(-1));
    leavePage();
    return { first, label };
  }

  test('COD with the code and the points held by the attempt: placed at exactly the button’s price on the first tap — the code and points move, nothing is refused', async () => {
    const { first, label } = await abandonedAttempt();
    assert.equal(label, 'Place Order · ₹1,349', '₹1,500 − ₹150 TULSI10 − ₹100 points + ₹99');
    rzp.down = true;
    const page = mountPage(() => CheckoutPage());
    await settle();
    assert.equal(buttonLabel(page.result), label, 'the reload shows what the attempt holds');
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    assert.equal(buttonLabel(page.result), label, 'no COD fee above ₹500');
    router.push.mock.resetCalls();
    toast.mock.resetCalls();

    await quietly(() => submit(page));
    assert.equal(lastOrderPost().status, 201);
    assert.equal(lastOrderPost().body.loyaltyDiscount, 100, 'the ₹100 the page showed was sent');
    const [cod] = newest([first.id]);
    assert.deepEqual([cod.payment.method, cod.total, cod.discount, cod.loyaltyDiscount], ['cod', rupees(label), 250, 100], 'discount = ₹150 code + ₹100 points');
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), [`/order-success?orderNumber=${cod.orderNumber}&email=new%40x.test`]);
    assert.deepEqual(confirmations(), confirmedOnce(cod.orderNumber));
    assert.deepEqual(statusMessages(), [], 'no "order cancelled" for the attempt');
    const A = orderDoc(first.id);
    assert.deepEqual([A.status, A.cancelReason, A.replacedBy], ['cancelled', 'replaced', cod.id]);
    assert.deepEqual([couponDoc('welcome').usedCount, couponDoc('welcome').usedBy], [1, ['u:u-new']], 'TULSI10 moved to the new order, counted once');
    assert.equal(userDoc().pendingLoyaltyDiscount, 0);
  });

  test('online with only points held: the very first tap opens a window at the button’s price', async () => {
    const { first } = await abandonedAttempt({ code: null });
    rzp.down = true;
    const page = mountPage(() => CheckoutPage());
    await settle();
    const label = buttonLabel(page.result);
    assert.equal(label, 'Place Order · ₹1,499');

    await quietly(() => submit(page));
    assert.equal(lastOrderPost().status, 201);
    const [fresh] = newest([first.id]);
    assert.equal(fresh.total, rupees(label));
    assert.equal(windows.at(-1).options.amount, rupees(label) * 100, 'the window charges what the button said');
    assert.equal(orderDoc(first.id).status, 'cancelled');
  });
});

/* ═════════════ R-B: the two "already paid" answers confirm the order first ═════════════ */

describe('R-B: Razorpay says an unpaid attempt is paid → it is settled (confirmed, stock, points, one "order confirmed"), then ALREADY_PAID', () => {
  test('create-order on the kept attempt: confirmed on the way; the webhook, verify and the clean-up after it add nothing', async () => {
    const a = await abandonedOnline({ code: null });
    const pay = payOnRazorpay(a.rzpOrderId); // approved in the UPI app after the window closed; no webhook yet
    const r = await payFor(a.id);
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'ALREADY_PAID');
    const A = orderDoc(a.id);
    assert.deepEqual([A.status, A.payment.status, A.payment.razorpayPaymentId, A.stockDeducted], ['confirmed', 'paid', pay.id, true]);
    assert.equal(stock(), 4);
    assert.equal(A.pointsAwarded, true);
    assert.deepEqual(confirmations(), confirmedOnce(a.orderNumber), 'one "order confirmed", at once');
    assert.equal(rzp.creates, 1, 'no second Razorpay order');

    assert.equal((await webhookPaid(pay)).status, 200);
    assert.equal((await verifyPayment(pay, a.id)).status, 200);
    orderDoc(a.id).createdAt = ago(25 * HOUR);
    assert.deepEqual((await runCron()).json.checked, 0);
    assert.equal((await payFor(a.id)).json.code, 'ALREADY_PAID');
    assert.equal(stock(), 4);
    assert.deepEqual(confirmations(), confirmedOnce(a.orderNumber));
  });

  test('create-order: paid but the payment can’t be read, or is short → EARLIER_PAYMENT_PENDING (couldn’t check), nothing written; the webhook then settles it', async () => {
    const a = await abandonedOnline({ code: null });
    const pay = payOnRazorpay(a.rzpOrderId);
    rzp.noPaymentsApi = true;
    const before = snapshot();
    const unread = await quietly(() => payFor(a.id));
    assert.deepEqual([unread.status, unread.json], [409, { success: false, code: 'EARLIER_PAYMENT_PENDING', orderId: a.id, message: PENDING_UNCHECKED }]);
    assert.equal(snapshot(), before);
    assert.deepEqual(sent, []);

    rzp.noPaymentsApi = false;
    pay.amount = 100; // a payment short of the order's amount
    const short = await quietly(() => payFor(a.id));
    assert.equal(short.json.code, 'EARLIER_PAYMENT_PENDING');
    assert.equal(snapshot(), before);

    pay.amount = 150000;
    assert.equal((await webhookPaid(pay)).status, 200);
    assert.equal(orderDoc(a.id).status, 'confirmed');
    assert.deepEqual(confirmations(), confirmedOnce(a.orderNumber));
  });

  test('create-order: the attempt was cancelled just before it settled → ORDER_CANCELLED, recorded for a refund, no "order confirmed"', async () => {
    const a = await abandonedOnline({ code: null });
    payOnRazorpay(a.rzpOrderId);
    /* The store cancels it while Razorpay is being asked the second time. */
    let asked = 0;
    rzp.onFetch = () => { asked += 1; if (asked === 2) Object.assign(orderDoc(a.id), { status: 'cancelled' }); };
    const r = await quietly(() => payFor(a.id));
    assert.deepEqual([r.status, r.json.code, r.json.replaced], [409, 'ORDER_CANCELLED', false]);
    assert.deepEqual([orderDoc(a.id).paidAfterCancel, orderDoc(a.id).refundDue], [true, true]);
    assert.equal(stock(), 5);
    assert.deepEqual(sent, []);
  });

  test('create-order: unchanged answers — unpaid → the same Razorpay order again; Razorpay unreachable → the same again', async () => {
    const a = await abandonedOnline({ code: null });
    const again = await payFor(a.id);
    assert.deepEqual([again.status, again.json.data.id], [200, a.rzpOrderId]);
    rzp.down = true;
    const down = await quietly(() => payFor(a.id));
    assert.deepEqual([down.status, down.json.data.id], [200, a.rzpOrderId]);
    assert.deepEqual(sent, []);
  });

  for (const extra of [{ unpaidOnly: true }, {}]) {
    test(`the page’s give-up (PUT cancel${extra.unpaidOnly ? ', unpaidOnly' : ''}): confirmed instead of cancelled, 409 ALREADY_PAID, one "order confirmed", the code and points stay`, async () => {
      const a = await abandonedOnline();
      const pay = payOnRazorpay(a.rzpOrderId);
      const r = await cancel(a.id, extra);
      assert.equal(r.status, 409);
      assert.equal(r.json.code, 'ALREADY_PAID');
      assert.match(r.json.message, /has just come through/);
      const A = orderDoc(a.id);
      assert.deepEqual([A.status, A.payment.status, A.payment.razorpayPaymentId, A.stockDeducted, A.cancelReason], ['confirmed', 'paid', pay.id, true, undefined]);
      assert.equal(stock(), 4);
      assert.deepEqual([couponDoc().usedCount, couponDoc().usedBy], [1, ['u:u-new']]);
      assert.equal(userDoc().pendingLoyaltyDiscount, 0);
      assert.deepEqual(confirmations(), confirmedOnce(a.orderNumber));
      assert.deepEqual(statusMessages(), []);

      assert.equal((await webhookPaid(pay)).status, 200);
      if (extra.unpaidOnly) assert.equal((await cancel(a.id, extra)).json.code, 'ALREADY_PAID', 'a repeat: already paid here');
      assert.equal(stock(), 4);
      assert.deepEqual(confirmations(), confirmedOnce(a.orderNumber));
    });
  }

  test('the page’s give-up: paid but unreadable → EARLIER_PAYMENT_PENDING (couldn’t check), the order stays as it is; never paid → cancelled as before', async () => {
    const a = await abandonedOnline();
    const pay = payOnRazorpay(a.rzpOrderId);
    rzp.noPaymentsApi = true;
    const before = snapshot();
    const r = await quietly(() => cancel(a.id, { unpaidOnly: true }));
    assert.deepEqual([r.status, r.json], [409, { success: false, code: 'EARLIER_PAYMENT_PENDING', orderId: a.id, message: PENDING_UNCHECKED }]);
    assert.equal(snapshot(), before);
    assert.equal(orderDoc(a.id).status, 'pending');

    rzp.noPaymentsApi = false;
    assert.equal((await webhookPaid(pay)).status, 200);
    assert.equal(orderDoc(a.id).status, 'confirmed');
  });

  test('the page’s give-up: unchanged where Razorpay doesn’t say paid — unreachable, created or a payment in progress → cancelled quietly, the code and points handed back', async () => {
    for (const setup of [() => { rzp.down = true; }, () => {}, null]) {
      resetWorld();
      const a = await abandonedOnline();
      if (setup) setup();
      else payOnRazorpay(a.rzpOrderId, 'authorized');
      const r = await quietly(() => cancel(a.id, { unpaidOnly: true }));
      assert.equal(r.status, 200, r.json.message);
      assert.equal(orderDoc(a.id).status, 'cancelled');
      assert.deepEqual([couponDoc().usedCount, userDoc().pendingLoyaltyDiscount], [0, 100]);
      assert.deepEqual(sent, [], 'quiet');
    }
  });

  test('one shared check: create-order, the page’s give-up and checkout settle through settleIfPaid (src/lib/razorpayState.js)', () => {
    for (const p of ['src/app/api/payments/create-order/route.js', 'src/app/api/orders/[id]/route.js', 'src/app/api/orders/route.js']) {
      const s = readFileSync(path.resolve(p), 'utf8');
      assert.match(s, /settleIfPaid/, p);
      assert.match(s, /from '@\/lib\/razorpayState'/, p);
      assert.doesNotMatch(s, /new Razorpay\(\{[^}]*\}\)\)\)\?\.status === 'paid'/, p);
    }
  });
});

/* ── R-B end to end: the real page ── */

describe('R-B end to end: the real /checkout page opens /order-success only on a confirmed order', { skip }, () => {
  test('Pay again on the kept attempt after a late UPI payment: ALREADY_PAID → the confirmation page, and the order is confirmed with one "order confirmed"', async () => {
    signInAs(NEW);
    seedCart(PIECE, 1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    const [o] = allOrders();
    const w = windows[0];
    closeWindow(w);
    const pay = payOnRazorpay(w.options.order_id); // approved in the UPI app; nobody has told us
    router.push.mock.resetCalls();
    await submit(page); // Pay again: the same order
    const answer = calls('POST', '/api/payments/create-order').at(-1);
    assert.deepEqual([answer.status, answer.json.code], [409, 'ALREADY_PAID']);
    assert.equal(windows.length, 1, 'no second window');
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), [`/order-success?orderNumber=${o.orderNumber}&email=new%40x.test`]);
    const A = orderDoc(o.id);
    assert.deepEqual([A.status, A.payment.status, A.payment.razorpayPaymentId], ['confirmed', 'paid', pay.id]);
    assert.equal(stock(), 4);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    assert.equal(allOrders().length, 1);
    assert.equal((await webhookPaid(pay)).status, 200);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
  });

  test('the shopper switches to COD while the first window’s UPI payment is on its way: the give-up is refused with ALREADY_PAID after confirming it — no COD order on top', async () => {
    signInAs(NEW);
    seedCart(PIECE, 1);
    const page = mountPage(() => CheckoutPage());
    await settle();
    await submit(page);
    const [o] = allOrders();
    const w = windows[0];
    closeWindow(w);
    payOnRazorpay(w.options.order_id);
    flowOf(page.result).setPaymentMethod('cod');
    await settle();
    router.push.mock.resetCalls();
    await submit(page);
    const put = calls('PUT', /^\/api\/orders\//).at(-1);
    assert.deepEqual([put.status, put.json.code], [409, 'ALREADY_PAID']);
    assert.equal(allOrders().length, 1, 'no COD order on top of the paid one');
    assert.equal(orderDoc(o.id).status, 'confirmed');
    assert.deepEqual(router.push.mock.calls.map((c) => c.arguments[0]), [`/order-success?orderNumber=${o.orderNumber}&email=new%40x.test`]);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    assert.deepEqual(statusMessages(), []);
  });
});

/* ═════════════ R-C: the customer's "order confirmed" ═════════════ */

/* An online order of the signed-in customer and the payment Razorpay is
   about to report. */
async function paying() {
  const a = await abandonedOnline({ code: null });
  const pay = payOnRazorpay(a.rzpOrderId);
  return { ...a, pay };
}
const claimOf = (id) => {
  const o = orderDoc(id);
  return { claimed: o.customerConfirmClaimedAt, confirmed: o.customerConfirmedAt, via: o.customerConfirmedVia };
};

describe('R-C: exactly one "order confirmed" (email + WhatsApp) per paid online order, whichever calls come', () => {
  test('verify → webhook → verify again → the clean-up: one set, one claim', async () => {
    const o = await paying();
    assert.equal((await verifyPayment(o.pay, o.id)).status, 200);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    const c = claimOf(o.id);
    assert.ok(c.claimed && c.confirmed, 'claimed when confirmed, marked sent after');
    assert.equal((await webhookPaid(o.pay)).status, 200);
    assert.equal((await verifyPayment(o.pay, o.id)).json.message, 'Payment already verified');
    orderDoc(o.id).createdAt = ago(25 * HOUR);
    assert.deepEqual((await runCron()).json.checked, 0);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    assert.deepEqual(attempts, [['email', o.orderNumber], ['wa', o.orderNumber]], 'attempted once each');
    assert.deepEqual(claimOf(o.id), c, 'the claim is not touched again');
  });

  test('the webhook missed: the clean-up confirms it (one set); the late webhook and verify add nothing', async () => {
    const o = await paying();
    orderDoc(o.id).createdAt = ago(25 * HOUR);
    const r = await runCron();
    assert.deepEqual([r.json.expired, r.json.settled], [[], [o.id]]);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    assert.equal((await webhookPaid(o.pay)).status, 200);
    assert.equal((await verifyPayment(o.pay, o.id)).status, 200);
    assert.deepEqual((await runCron()).json.settled, []);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
  });

  test('none for a payment being refunded (paid after the cancel / replace): no message, no claim', async () => {
    const o = await paying();
    Object.assign(orderDoc(o.id), { status: 'cancelled' });
    const v = await quietly(() => verifyPayment(o.pay, o.id));
    assert.equal(v.status, 409);
    assert.equal((await webhookPaid(o.pay)).status, 200);
    assert.equal((await quietly(() => verifyPayment(o.pay, o.id))).status, 409);
    assert.deepEqual(sent, []);
    assert.deepEqual(attempts, []);
    assert.deepEqual(claimOf(o.id), { claimed: undefined, confirmed: undefined, via: undefined });
  });

  test('none for COD when settled; COD is still told when it is placed, once', async () => {
    signInAs(NEW);
    const cod = await post(codOrder({ loyaltyDiscount: 100 }));
    assert.equal(cod.status, 201);
    assert.deepEqual(confirmations(), confirmedOnce(cod.json.data.orderNumber), 'at creation');
    sent.length = 0; attempts.length = 0;
    await settlePaidOrder(db, db.collection('orders').doc(cod.json.data.id), { razorpayPaymentId: 'pay_x' });
    await settlePaidOrder(db, db.collection('orders').doc(cod.json.data.id), { razorpayPaymentId: 'pay_x' });
    assert.deepEqual(confirmations(), [], 'nothing more for COD');
    assert.deepEqual(attempts, []);
    assert.equal(orderDoc(cod.json.data.id).customerConfirmClaimedAt, undefined);
  });

  test('two settlers at once (verify, the webhook, the clean-up): one claim, one set — the claim is taken inside the settling transaction', async () => {
    const o = await paying();
    db = serialTransactions(db);
    const results = await Promise.all([
      verifyPayment(o.pay, o.id),
      webhookPaid(o.pay),
      settlePaidOrder(db, db.collection('orders').doc(o.id), { razorpayPaymentId: o.pay.id }),
      settlePaidOrder(db, db.collection('orders').doc(o.id), { razorpayPaymentId: o.pay.id }),
    ]);
    assert.equal(results[0].status, 200);
    assert.equal(stock(), 4, 'stock taken once');
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    assert.deepEqual(attempts, [['email', o.orderNumber], ['wa', o.orderNumber]]);
  });
});

describe('R-C: sent after the response — verify and the webhook never wait for the mail', () => {
  test('inside a request: verify answers while nothing has been sent, even if the senders would hang forever', async () => {
    const o = await paying();
    senders.email = () => new Promise(() => {}); // a mail server that never answers
    senders.wa = () => new Promise(() => {});
    const v = await within(inRequest(() => verifyPayment(o.pay, o.id)), 3000);
    assert.equal(v.status, 200, 'answered');
    assert.deepEqual(attempts, [], 'not even started: it waits for the response to go');
    assert.equal(afterQueue.length, 1, 'queued with after()');
    const c = claimOf(o.id);
    assert.ok(c.claimed, 'but claimed already, in the settling transaction');
    assert.equal(c.confirmed, undefined);
    assert.equal(orderDoc(o.id).status, 'confirmed');
    assert.equal(stock(), 4);
  });

  test('inside a request: the webhook answers at once too; a second call while the first is still to send adds no second message', async () => {
    const o = await paying();
    senders.email = () => new Promise(() => {});
    const hook = await within(inRequest(() => webhookPaid(o.pay)), 3000);
    assert.equal(hook.status, 200);
    const v = await inRequest(() => verifyPayment(o.pay, o.id));
    assert.equal(v.status, 200);
    assert.equal(afterQueue.length, 1, 'one send queued, by the call that confirmed it');
    senders.email = null;
    await flushAfter();
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    assert.ok(claimOf(o.id).confirmed);
  });

  test('cancelled between the claim and the send: the queued "order confirmed" is dropped — nothing is sent after the cancellation, and it is not retried', async () => {
    const o = await paying();
    await inRequest(() => verifyPayment(o.pay, o.id));
    assert.equal(afterQueue.length, 1);
    orderDoc(o.id).status = 'cancelled'; // cancelled before the queued send ran
    await flushAfter();
    assert.deepEqual(confirmations(), [], 'no "order confirmed" for a cancelled order');
    assert.equal(claimOf(o.id).confirmed, undefined);
    await inRequest(() => webhookPaid(o.pay));
    await flushAfter();
    assert.deepEqual(confirmations(), [], 'and a later settle call does not send it either');
  });
  test('once the response has gone the queued send runs: one email, one WhatsApp', async () => {
    const o = await paying();
    await inRequest(() => verifyPayment(o.pay, o.id));
    assert.deepEqual(sent, []);
    await flushAfter();
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    await inRequest(() => webhookPaid(o.pay));
    await flushAfter();
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
  });

  test('where there is no request (tests, scripts) it is sent inline, before settlePaidOrder returns', async () => {
    const o = await paying();
    senders.wa = () => delay(40);
    const v = await verifyPayment(o.pay, o.id);
    assert.equal(v.status, 200);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber), 'already sent');
    assert.equal(afterQueue.length, 0);
  });
});

describe('R-C: a failed send releases the claim — the next call sends it, once, and redoes nothing else', () => {
  test('the mail server refuses: WhatsApp is out, the claim is released; the webhook sends only the email; stock, points and vendors are not redone', async () => {
    const o = await paying();
    senders.email = async () => false;
    const v = await quietly(() => verifyPayment(o.pay, o.id));
    assert.equal(v.status, 200, 'the payment is verified whatever the mail does');
    assert.deepEqual(sent, [['wa:placed', o.orderNumber]]);
    assert.deepEqual(claimOf(o.id), { claimed: null, confirmed: undefined, via: ['whatsapp'] }, 'released; WhatsApp remembered');
    const held = { stock: stock(), points: userDoc().loyaltyPoints, order: structuredClone(orderDoc(o.id)) };
    assert.equal(held.stock, 4);

    senders.email = null;
    assert.equal((await webhookPaid(o.pay)).status, 200);
    assert.deepEqual(confirmations(), [['wa:placed', o.orderNumber], ['email:placed', o.orderNumber]], 'the email now; WhatsApp not again');
    assert.deepEqual(attempts, [['email', o.orderNumber], ['wa', o.orderNumber], ['email', o.orderNumber]]);
    const done = claimOf(o.id);
    assert.ok(done.confirmed);
    assert.equal(stock(), held.stock, 'stock not taken again');
    assert.equal(userDoc().loyaltyPoints, held.points, 'points not awarded again');
    const O = orderDoc(o.id);
    for (const f of ['status', 'stockDeducted', 'pointsAwarded', 'vendorsNotifiedAt', 'updatedAt']) assert.equal(O[f], held.order[f], f);
    assert.equal(O.payment.paidAt, held.order.payment.paidAt, 'paidAt not rewritten');

    /* And never again. */
    await webhookPaid(o.pay);
    await verifyPayment(o.pay, o.id);
    assert.deepEqual(attempts.length, 3);
  });

  test('WhatsApp times out (it throws): the email went, the claim is released; a repeat verify sends only WhatsApp', async () => {
    const o = await paying();
    senders.wa = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
    const v = await quietly(() => verifyPayment(o.pay, o.id));
    assert.equal(v.status, 200);
    assert.deepEqual(claimOf(o.id), { claimed: null, confirmed: undefined, via: ['email'] });
    senders.wa = null;
    const again = await verifyPayment(o.pay, o.id);
    assert.equal(again.json.message, 'Payment already verified');
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    assert.deepEqual(attempts, [['email', o.orderNumber], ['wa', o.orderNumber], ['wa', o.orderNumber]]);
    assert.ok(claimOf(o.id).confirmed);
  });

  test('both fail: both are sent by the next call; a call that fails again releases it again', async () => {
    const o = await paying();
    senders.email = async () => false;
    senders.wa = async () => { throw new Error('socket hang up'); };
    await quietly(() => verifyPayment(o.pay, o.id));
    assert.deepEqual(confirmations(), []);
    assert.deepEqual(claimOf(o.id), { claimed: null, confirmed: undefined, via: [] });
    await quietly(() => webhookPaid(o.pay));
    assert.equal(attempts.length, 4, 'tried again, once each');
    assert.deepEqual(claimOf(o.id), { claimed: null, confirmed: undefined, via: [] });
    senders.email = null; senders.wa = null;
    await webhookPaid(o.pay);
    assert.deepEqual(confirmations(), confirmedOnce(o.orderNumber));
    assert.ok(claimOf(o.id).confirmed);
  });

  test('a failed send inside a request is retried by the next request (after the response)', async () => {
    const o = await paying();
    senders.email = async () => false;
    await quietly(async () => { await inRequest(() => verifyPayment(o.pay, o.id)); await flushAfter(); });
    assert.deepEqual(claimOf(o.id).claimed, null);
    senders.email = null;
    await inRequest(() => webhookPaid(o.pay));
    assert.deepEqual(sent.map(([k]) => k), ['wa:placed'], 'queued, not sent yet');
    await flushAfter();
    assert.deepEqual(confirmations(), [['wa:placed', o.orderNumber], ['email:placed', o.orderNumber]]);
  });
});

describe('R-C: who may send — the claim’s lease, orders paid before claims existed, cancelled orders', () => {
  const settleAgain = (id) => settlePaidOrder(db, db.collection('orders').doc(id), { razorpayPaymentId: 'pay_again' });
  /* A paid, confirmed online order whose customer fields are as given. */
  function paidOrder(id, extra = {}) {
    db.store.get('orders').set(id, {
      orderNumber: `TBJ-${id}`, userId: 'u-new', guestEmail: 'new@x.test', status: 'confirmed', total: 1599, createdAt: ago(HOUR),
      items: [{ product: 'p1', name: 'Temple Jhumka', price: 1500, quantity: 1 }], stockDeducted: true,
      shippingAddress: { ...ADDRESS, name: 'Priya R', email: 'new@x.test' },
      payment: { method: 'razorpay', status: 'paid', razorpayOrderId: `order_${id}`, amountDue: 159900, razorpayPaymentId: 'pay_1' },
      ...extra,
    });
  }

  test('a claim taken a minute ago is respected (its holder is sending); one older than the lease (its request died) is taken over', async () => {
    paidOrder('fresh', { customerConfirmClaimedAt: ago(60_000) });
    paidOrder('dead', { customerConfirmClaimedAt: ago(10 * 60_000) });
    const r = await settleAgain('fresh');
    assert.deepEqual([r.alreadySettled, r.paidAfterCancel], [true, false]);
    assert.deepEqual(sent, [], 'its holder is still sending');
    await settleAgain('dead');
    assert.deepEqual(confirmations(), confirmedOnce('TBJ-dead'));
    assert.ok(claimOf('dead').confirmed);
    assert.ok(Date.now() - Date.parse(claimOf('dead').claimed) < 60_000, 'the new claim is stamped');
    assert.equal(stock(), 5, 'only the send was redone');
  });

  test('an order paid before claims existed was told when it was placed: left alone, nothing written', async () => {
    paidOrder('old');
    const before = snapshot();
    await settleAgain('old');
    assert.deepEqual(sent, []);
    assert.equal(snapshot(), before);
  });

  test('already told, cancelled after paying, or a refund: never', async () => {
    paidOrder('told', { customerConfirmClaimedAt: ago(HOUR), customerConfirmedAt: ago(HOUR) });
    paidOrder('cancelled', { customerConfirmClaimedAt: null, status: 'cancelled' });
    paidOrder('refund', { customerConfirmClaimedAt: null, paidAfterCancel: true, refundDue: true, status: 'cancelled' });
    for (const id of ['told', 'cancelled', 'refund']) await settleAgain(id);
    assert.deepEqual(sent, []);
  });

  test('a released claim on a confirmed order is taken by the next call', async () => {
    paidOrder('released', { customerConfirmClaimedAt: null, customerConfirmedVia: ['email'] });
    await settleAgain('released');
    assert.deepEqual(sent, [['wa:placed', 'TBJ-released']], 'only the channel that had not gone out');
    assert.ok(claimOf('released').confirmed);
  });
});

describe('R-C: timeouts — a mail or WhatsApp server that never answers can’t hold anything for ever', () => {
  test('nodemailer: connection, greeting and socket timeouts of 10 s; a refused send answers false, a sent one true', async () => {
    const order = { orderNumber: 'TBJ1', guestEmail: 'new@x.test', createdAt: ago(0), total: 100, items: [], shippingAddress: { name: 'P' }, payment: { method: 'razorpay' } };
    assert.equal(await realEmail.sendOrderConfirmation(order), true);
    assert.equal(transports.length, 1);
    mailer.fail = true;
    assert.equal(await quietly(() => realEmail.sendOrderConfirmation(order)), false, 'refused: false, never thrown');
    mailer.fail = false;
    assert.equal(await realEmail.sendOrderConfirmation({ ...order, guestEmail: '', shippingAddress: {} }), true, 'nobody to send to: nothing to retry');
    transports.length = 1;
    assert.deepEqual([transports[0].connectionTimeout, transports[0].greetingTimeout, transports[0].socketTimeout], [10_000, 10_000, 10_000]);
    await quietly(() => realEmail.sendOTPEmail('a@b.test', '123456'));
    assert.ok(transports.every((t) => t.connectionTimeout === 10_000 && t.greetingTimeout === 10_000 && t.socketTimeout === 10_000), 'every mail the shop sends');
  });

  test('WhatsApp: the fetch carries an AbortSignal.timeout(10000); a timeout rejects', async () => {
    const customer = { orderNumber: 'TBJ1', total: 100, items: [], shippingAddress: { name: 'P', phone: '9876543210' } };
    const asked = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    const spy = mock.method(AbortSignal, 'timeout', (ms) => { asked.push(ms); return real(ms); });
    const was = globalThis.fetch;
    let init;
    globalThis.fetch = async (_url, i) => { init = i; return { json: async () => ({ sent: 'true' }) }; };
    try {
      assert.deepEqual(await realWhatsApp.sendOrderWhatsAppToCustomer(customer), { success: true });
      assert.deepEqual(asked, [10_000]);
      assert.ok(init.signal instanceof AbortSignal, 'the signal is passed to fetch');
    } finally {
      spy.mock.restore();
    }
    /* A server that never answers: fetch rejects when the signal fires. */
    const fired = mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
    globalThis.fetch = (_url, i) => new Promise((_, reject) => { i.signal.addEventListener('abort', () => reject(i.signal.reason)); if (i.signal.aborted) reject(i.signal.reason); });
    try {
      await assert.rejects(() => realWhatsApp.sendOrderWhatsAppToCustomer(customer), { name: 'TimeoutError' });
    } finally {
      fired.mock.restore();
      globalThis.fetch = was;
    }
  });

  test('the clean-up runs at 10:00 IST (04:30 UTC) now that it can message a customer', () => {
    const { crons } = JSON.parse(readFileSync(path.resolve('vercel.json'), 'utf8'));
    assert.deepEqual(crons.find((c) => c.path === '/api/cron/expire-unpaid-orders'), { path: '/api/cron/expire-unpaid-orders', schedule: '30 4 * * *' });
    assert.equal(crons.find((c) => c.path === '/api/cron/shipment-sync').schedule, '30 3 * * *', 'the other cron is untouched');
  });
});
