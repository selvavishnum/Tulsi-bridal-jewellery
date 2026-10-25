/* ─────────────────────────────────────────────
   The storefront header and the welcome strip for "Tulsi Fashion Jewellery":

   - src/components/layout/Navbar.js — brand, the eight links (no Shop
     dropdown, Catalogue or Rentals), the prominent search box, the phone
     row, the mobile menu — rendered to HTML with the real React, and driven
     through a tiny hook runner for search / Escape / the hamburger;
   - src/components/layout/navLinks.js — the shared list + active-link rule;
   - src/components/layout/WelcomeBar.jsx — the strip reads
     "✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code:
     TULSI100 | Free Delivery across India 🚚" (checked at desktop, tablet
     and phone widths), claims free delivery only when the shipping
     settings make every order free, copies the code and says so;
   - src/lib/welcomeOffer.js helpers: delivery line, clipboard, toast text.

   The JSX files are transpiled here with sucrase (already in node_modules
   via tailwindcss) and wired to stubs by hand; if sucrase is ever missing
   the file is skipped with that reason, never silently green.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as welcomeOffer from '../src/lib/welcomeOffer.js';
import * as navLinks from '../src/components/layout/navLinks.js';
import { DEFAULT_CHARGES } from '../src/lib/storeCharges.js';

const {
  DEFAULT_ANNOUNCEMENT, FREE_DELIVERY_LINE, deliveryFreeForAll, deliveryLine, copyToClipboard, codeTapToast, PENDING_COUPON_KEY, DISMISS_KEY,
} = welcomeOffer;
const { NAV_LINKS, isActiveLink } = navLinks;

const require = createRequire(import.meta.url);
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the header cannot be transpiled for node --test';
const React = require('react');
const { renderToString, renderToStaticMarkup } = require('react-dom/server');

/* ── Loading a client file with its imports wired by hand ── */
function load(rel, deps) {
  const file = path.resolve(rel);
  const { code } = sucrase.transform(readFileSync(file, 'utf8'), { transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file });
  const all = { 'react/jsx-runtime': require('react/jsx-runtime'), ...deps };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, (id) => {
    if (!Object.hasOwn(all, id)) throw new Error(`${rel} imports ${id}: add a stub for it in this test`);
    return all[id];
  }, mod);
  return mod.exports;
}
const icon = (name) => { const Icon = (props) => React.createElement('svg', { 'data-icon': name, ...props }); Icon.displayName = name; return Icon; };
const icons = new Proxy({}, { get: (_, name) => (typeof name === 'string' && name.startsWith('Fi') ? icon(name) : undefined) });
const Link = ({ href, children, prefetch: _p, ...rest }) => React.createElement('a', { href, ...rest }, children);
const esm = (value) => ({ __esModule: true, default: value });

/* ── A tiny hook runner: state / refs / effects, re-rendering synchronously ── */
let current = null;
const hooks = {
  useState(init) { return current.useState(init); },
  useRef(init) { return current.useRef(init); },
  useEffect(fn, deps) { current.useEffect(fn, deps); },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
};
const fakeReact = { ...React, ...hooks };
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

function mount(Component, props = {}) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let eCursor = 0;
  let queued = [];
  let rendering = false;
  let dirty = false;
  let alive = true;
  const h = { result: null };
  const self = {
    useState(init) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = { value: typeof init === 'function' ? init() : init };
        slot.set = (next) => {
          const v = typeof next === 'function' ? next(slot.value) : next;
          if (Object.is(v, slot.value)) return;
          slot.value = v;
          if (rendering) dirty = true; else if (alive) render();
        };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(init) { const i = cursor++; if (!slots[i]) slots[i] = { ref: { current: init } }; return slots[i].ref; },
    useEffect(fn, deps) {
      const i = eCursor++;
      const prev = effects[i];
      if (prev && sameDeps(deps, prev.deps)) return;
      queued.push(() => { prev?.cleanup?.(); const c = fn(); effects[i] = { deps, cleanup: typeof c === 'function' ? c : null }; });
    },
  };
  function render() {
    let passes = 0;
    do {
      dirty = false; cursor = 0; eCursor = 0; queued = [];
      rendering = true; current = self;
      try { h.result = Component(props); } finally { rendering = false; current = null; }
      if (++passes > 25) throw new Error('Too many re-renders');
    } while (dirty);
    const run = queued; queued = [];
    for (const f of run) f();
  }
  h.render = render;
  h.unmount = () => { alive = false; for (const e of effects) e?.cleanup?.(); };
  render();
  return h;
}
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };

/* ── Reading an element tree ── */
function find(el, pred) {
  if (el === null || el === undefined || typeof el !== 'object') return null;
  if (Array.isArray(el)) { for (const c of el) { const f = find(c, pred); if (f) return f; } return null; }
  if (pred(el)) return el;
  return find(el.props?.children, pred);
}
const named = (name) => (el) => typeof el.type === 'function' && el.type.name === name;
const byLabel = (tree, label) => find(tree, (el) => el.type === 'button' && el.props?.['aria-label'] === label);

/* Which Tailwind visibility classes show an element at a given viewport width
   (base `hidden`; sm/md/lg: show-or-hide variants; `max-[359px]:hidden`). */
const BREAKPOINTS = [['sm', 640], ['md', 768], ['min-[820px]', 820], ['lg', 1024]];
function shownAt(className, width) {
  const t = String(className || '').split(/\s+/);
  let shown = !t.includes('hidden');
  for (const [bp, min] of BREAKPOINTS) {
    if (width < min) continue;
    if (t.includes(`${bp}:hidden`)) shown = false;
    if (['block', 'inline', 'flex', 'inline-flex'].some((d) => t.includes(`${bp}:${d}`))) shown = true;
  }
  const max = t.find((c) => /^max-\[(\d+)px\]:hidden$/.test(c));
  if (max && width <= Number(max.match(/\d+/)[0])) shown = false;
  return shown;
}
/* What a visitor reads in an element at that width: aria-hidden decoration
   (✨, "|", 🚚) is part of what they SEE, so it is included; hidden parts are not. */
function visibleText(el, width) {
  if (el === null || el === undefined || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map((c) => visibleText(c, width)).join(' ');
  if (el.props?.className !== undefined && !shownAt(el.props.className, width)) return '';
  if (typeof el.type === 'function' && !el.props?.children) return visibleText(el.type(el.props), width);
  return visibleText(el.props?.children, width);
}
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/* ═════════════ navLinks.js ═════════════ */

describe('the eight links', () => {
  test('exactly the brief’s labels and targets, in order — no Shop dropdown, Catalogue or Rentals', () => {
    assert.deepEqual(NAV_LINKS.map((l) => [l.label, l.href]), [
      ['Home', '/'],
      ['Chains & Necklaces', '/catalog?category=necklace'],
      ['Earrings', '/catalog?category=earrings'],
      ['Anklets', '/catalog?category=anklet'],
      ['Trending Now', '/shop?sort=ratings.average-desc'],
      ['About', '/about'],
      ['Contact', '/contact'],
      ['Track Order', '/track-order'],
    ]);
    assert.ok(Object.isFrozen(NAV_LINKS));
    assert.ok(!NAV_LINKS.some((l) => /rent|catalogue|^shop$/i.test(l.label) || /rental/.test(l.href)));
  });

  test('every target is a page that exists and a filter the page really reads', () => {
    const catalog = readFileSync('src/app/catalog/CatalogContent.js', 'utf8');
    const shop = readFileSync('src/app/shop/ShopContent.js', 'utf8');
    for (const l of NAV_LINKS) {
      const [p, q] = l.href.split('?');
      const dir = p === '/' ? 'src/app/page.js' : `src/app${p}/page.js`;
      assert.doesNotThrow(() => readFileSync(dir), `${l.href} → ${dir}`);
      if (p === '/catalog' && q) assert.match(catalog, new RegExp(`value: '${q.split('=')[1]}'`), `${q} is one of the catalogue's categories`);
    }
    assert.match(shop, /value: 'ratings\.average-desc'/, '"Trending Now" is the shop’s Most Popular sort');
    assert.match(shop, /searchParams\.get\('sort'\)/);
  });
});

describe('isActiveLink', () => {
  test('path links match their page only; query links also need their parameters', () => {
    assert.equal(isActiveLink('/', '/', ''), true);
    assert.equal(isActiveLink('/', '/about', ''), false);
    assert.equal(isActiveLink('/about', '/about/', ''), true, 'trailing slash');
    assert.equal(isActiveLink('/catalog?category=anklet', '/catalog', 'category=anklet'), true);
    assert.equal(isActiveLink('/catalog?category=anklet', '/catalog', 'category=anklet&page=2'), true);
    assert.equal(isActiveLink('/catalog?category=anklet', '/catalog', 'category=earrings'), false);
    assert.equal(isActiveLink('/catalog?category=anklet', '/catalog', ''), false);
    assert.equal(isActiveLink('/shop?sort=ratings.average-desc', '/shop', 'sort=ratings.average-desc'), true);
    assert.equal(isActiveLink('/shop?sort=ratings.average-desc', '/shop', 'sort=price-asc'), false);
    assert.equal(isActiveLink('/shop?sort=ratings.average-desc', '/catalog', 'sort=ratings.average-desc'), false);
  });

  test('before the browser has reported the address bar (query null) only links without a query can be active — server HTML = first client render', () => {
    assert.equal(isActiveLink('/catalog?category=anklet', '/catalog', null), false);
    assert.equal(isActiveLink('/catalog?category=anklet', '/catalog', undefined), false);
    assert.equal(isActiveLink('/about', '/about', null), true);
    assert.equal(isActiveLink('/about', null, null), false);
    assert.equal(isActiveLink('/about', undefined, ''), false);
  });
});

/* ═════════════ Navbar.js ═════════════ */

const cartState = { itemCount: 0, charges: DEFAULT_CHARGES };
const wishlistState = { items: [] };
const sessionState = { data: null };
const nav = { pathname: '/', query: '', push: mock.fn() };
const signOut = mock.fn();

function loadNavbar(react) {
  return load('src/components/layout/Navbar.js', {
    react,
    'next/link': esm(Link),
    'next/navigation': { usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push }), useSearchParams: () => new URLSearchParams(nav.query) },
    'next-auth/react': { useSession: () => sessionState, signOut },
    '@/context/CartContext': { useCart: () => cartState },
    '@/context/WishlistContext': { useWishlist: () => wishlistState },
    '@/components/layout/WelcomeBar': esm(function WelcomeBar() { return React.createElement('div', { 'data-welcome-bar': true }); }),
    '@/components/layout/navLinks': navLinks,
    'react-icons/fi': icons,
  }).default;
}
const Navbar = sucrase ? loadNavbar(React) : null;
const NavbarForRunner = sucrase ? loadNavbar(fakeReact) : null;

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const html = () => renderToString(React.createElement(Navbar));
/* The <a>s inside the element that starts at `marker` (up to its closing tag). */
function linksIn(markup, marker) {
  const start = markup.indexOf(marker);
  assert.ok(start >= 0, `${marker} is in the header`);
  const end = markup.indexOf('</nav>', start);
  return [...markup.slice(start, end).matchAll(/<a href="([^"]*)"([^>]*)>(.*?)<\/a>/gs)].map((m) => ({ href: decode(m[1]), attrs: m[2], label: decode(m[3].replace(/<[^>]*>/g, '').trim()) }));
}

describe('Navbar — what the server sends', { skip }, () => {
  beforeEach(() => {
    cartState.itemCount = 0; wishlistState.items = []; sessionState.data = null;
    nav.pathname = '/'; nav.query = ''; nav.push.mock.resetCalls();
  });

  test('brand: TULSI · FASHION JEWELLERY, linking home; nothing bridal or rental anywhere in the header', () => {
    const h = html();
    assert.match(h, /<p [^>]*>TULSI<\/p>/);
    assert.match(h, /<p [^>]*>Fashion Jewellery<\/p>/);
    assert.match(h, /<a href="\/"[^>]*>.*?TULSI/s);
    assert.doesNotMatch(h, /bridal|rental|catalogue|\brent\b/i);
    assert.doesNotMatch(h, /href="\/rentals/);
    assert.doesNotMatch(h, /href="\/shop"/, 'no plain Shop link: Trending Now is the only way in from the header');
  });

  test('computer width: the eight links on one row, as the brief lists them', () => {
    const links = linksIn(html(), '<nav aria-label="Main"');
    assert.deepEqual(links.map((l) => [l.label, l.href]), NAV_LINKS.map((l) => [l.label, l.href]));
  });

  test('phones: the same eight links in the menu, plus wishlist and sign-in (signed out)', () => {
    const links = linksIn(html(), '<nav aria-label="Mobile"');
    assert.deepEqual(links.slice(0, 8).map((l) => [l.label, l.href]), NAV_LINKS.map((l) => [l.label, l.href]));
    assert.deepEqual(links.slice(8).map((l) => l.href), ['/wishlist', '/login']);
    sessionState.data = { user: { email: 'a@b.test', role: 'customer' } };
    const signedIn = linksIn(html(), '<nav aria-label="Mobile"');
    assert.deepEqual(signedIn.slice(8).map((l) => l.href), ['/wishlist', '/account']);
    sessionState.data = { user: { email: 'v@b.test', role: 'vendor' } };
    assert.ok(linksIn(html(), '<nav aria-label="Mobile"').some((l) => l.href === '/vendor/dashboard'));
  });

  test('search: a visible text box with the exact placeholder, named, in a search landmark, from computer width up', () => {
    const h = html();
    const inputs = [...h.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
    assert.equal(inputs.length, 1, 'one box in the server HTML (the phone row opens on a tap)');
    assert.match(inputs[0], /type="text"/);
    assert.match(inputs[0], /placeholder="Search necklaces, chains, earrings\.\.\."/);
    assert.match(inputs[0], /aria-label="Search products"/);
    assert.match(h, /<form role="search"[^>]*>/);
    assert.match(h, /<div class="hidden lg:flex flex-1 min-w-0 justify-center"><form role="search"[^>]*class="w-full max-w-\[560px\]"/);
    assert.match(h, /<button type="submit" aria-label="Search"/);
  });

  test('phones: menu · brand · search · cart, in that order; search opens a row, so it is not in the server HTML', () => {
    const h = html();
    const at = (s) => h.indexOf(s);
    assert.ok(at('aria-label="Open menu"') < at('>TULSI<'), 'hamburger first');
    assert.ok(at('>TULSI<') < at('aria-label="Search"'), 'then the brand');
    assert.ok(at('aria-label="Search"') < at('aria-label="Cart"'), 'then search, then the cart');
    assert.doesNotMatch(h, /id="mobile-search"/);
    assert.match(h, /aria-expanded="false" aria-controls="mobile-search"/);
  });

  test('the closed menu is inert and hidden from a screen reader; it holds its place without a height of its own', () => {
    const h = html();
    assert.match(h, /<div id="mobile-menu" aria-hidden="true" inert=""[^>]*class="lg:hidden [^"]*max-h-0 /);
  });

  test('every button and link has a name; every touch target is at least 44px (icon buttons) or text', () => {
    cartState.itemCount = 3; wishlistState.items = [{}, {}];
    const h = html();
    for (const m of h.matchAll(/<(button|a)\b([^>]*)>(.*?)<\/\1>/gs)) {
      const [, tag, attrs, inner] = m;
      const name = /aria-label="([^"]+)"/.exec(attrs)?.[1] || inner.replace(/<[^>]*>/g, '').trim();
      assert.ok(name, `${tag} without a name: ${m[0].slice(0, 120)}`);
    }
    assert.match(h, /aria-label="Cart, 3 items"/);
    assert.match(h, /aria-label="Wishlist, 2 saved"/);
    for (const [label, extra] of [['Open menu', ''], ['Search', ' aria-expanded="false" aria-controls="mobile-search"'], ['Cart, 3 items', ''], ['Wishlist, 2 saved', '']]) {
      const tag = new RegExp(`<(?:button|a) [^>]*aria-label="${label}"${extra}[^>]*>|<(?:button|a) [^>]*aria-label="${label}"[^>]*${extra.trim()}[^>]*>`).exec(h)?.[0];
      assert.match(tag, /min-w-11 min-h-11/, label);
    }
  });

  test('fixed heights: announcement strip, main row (h-16) and links row (h-11) never depend on what loads later', () => {
    const h = html();
    assert.match(h, /<div class="flex items-center h-16 gap-1 lg:gap-6">/);
    assert.match(h, /<ul class="flex items-center justify-center gap-8 h-11">/);
    assert.match(h, /<header class="sticky top-0 [^"]*border-b /, 'always a border (transparent until scrolled), so scrolling never adds a pixel');
  });

  test('the account icon is the same size signed in or out, so the session arriving moves nothing', () => {
    const out = html();
    sessionState.data = { user: { email: 'a@b.test' } };
    const inn = html();
    const cls = (h, label) => /class="([^"]*)"/.exec(new RegExp(`<(?:button|a) [^>]*aria-label="${label}"[^>]*>`).exec(h)[0])[1];
    assert.equal(cls(out, 'Sign in or register'), cls(inn, 'Account menu'));
  });

  test('active link: the page you are on is marked (aria-current) in both menus; no query link is marked in the server HTML', () => {
    nav.pathname = '/about';
    const h = html();
    const current = [...h.matchAll(/<a href="([^"]*)"[^>]*aria-current="page"/g)].map((m) => m[1]);
    assert.deepEqual(current, ['/about', '/about'], 'desktop row + mobile menu');
    nav.pathname = '/catalog';
    nav.query = 'category=anklet';
    assert.doesNotMatch(html(), /aria-current/, 'the address bar’s query is unknown to the server and to the first client render');
  });

  test('hydration: the HTML does not depend on the address-bar query at all (it is reported after mount)', () => {
    nav.pathname = '/catalog';
    nav.query = '';
    const plain = html();
    nav.query = 'category=anklet';
    assert.equal(html(), plain);
    nav.query = 'sort=ratings.average-desc&search=x';
    assert.equal(html(), plain);
  });
});

describe('Navbar — in the browser', { skip }, () => {
  const listeners = new Map();
  const realFetch = globalThis.fetch;
  let h;
  beforeEach(() => {
    listeners.clear();
    const on = (t, f) => { (listeners.get(t) || listeners.set(t, new Set()).get(t)).add(f); };
    const off = (t, f) => { listeners.get(t)?.delete(f); };
    globalThis.window = { scrollY: 0, addEventListener: on, removeEventListener: off };
    globalThis.document = { addEventListener: on, removeEventListener: off };
    globalThis.fetch = async () => ({ json: async () => ({ success: false }) });
    cartState.itemCount = 0; wishlistState.items = []; sessionState.data = null;
    nav.pathname = '/'; nav.query = ''; nav.push.mock.resetCalls();
    h = mount(NavbarForRunner);
  });
  afterEach(() => {
    h.unmount();
    delete globalThis.window; delete globalThis.document;
    globalThis.fetch = realFetch;
  });
  const press = (key) => { for (const f of [...(listeners.get('keydown') || [])]) f({ key }); };
  const field = () => find(h.result, named('SearchField'));
  const submit = () => { let prevented = false; field().props.onSubmit({ preventDefault: () => { prevented = true; } }); return prevented; };
  const menu = () => find(h.result, (el) => el.props?.id === 'mobile-menu');

  test('search goes to the catalogue’s search, trimmed and encoded; an empty box goes nowhere', () => {
    assert.equal(submit(), true);
    assert.equal(nav.push.mock.callCount(), 0, 'empty');
    field().props.onChange('   ');
    submit();
    assert.equal(nav.push.mock.callCount(), 0, 'blank');
    field().props.onChange('  gold chain & anklet ');
    assert.equal(field().props.value, '  gold chain & anklet ');
    submit();
    assert.deepEqual(nav.push.mock.calls.map((c) => c.arguments[0]), ['/catalog?search=gold%20chain%20%26%20anklet']);
  });

  test('the phone search row opens from the icon and closes with it; the box is focused when it opens', () => {
    assert.equal(find(h.result, (el) => el.props?.id === 'mobile-search'), null);
    byLabel(h.result, 'Search').props.onClick();
    const row = find(h.result, (el) => el.props?.id === 'mobile-search');
    assert.ok(row, 'opened');
    assert.ok(row.props.className.includes('lg:hidden'), 'phones and tablets only');
    assert.equal(byLabel(h.result, 'Close search').props['aria-expanded'], true);
    byLabel(h.result, 'Close search').props.onClick();
    assert.equal(find(h.result, (el) => el.props?.id === 'mobile-search'), null);
  });

  test('the hamburger opens the menu (no longer inert); a link closes it; Escape closes it', () => {
    assert.equal(menu().props.inert, true);
    byLabel(h.result, 'Open menu').props.onClick();
    assert.equal(menu().props.inert, false);
    assert.equal(menu().props['aria-hidden'], false);
    assert.match(menu().props.className, /max-h-\[calc\(100dvh-6rem\)\] overflow-y-auto/, 'never taller than the screen: it scrolls');
    press('Escape');
    assert.equal(menu().props.inert, true);
    byLabel(h.result, 'Open menu').props.onClick();
    const link = find(menu().props.children, (el) => el.type === Link && el.props.href === '/about');
    link.props.onClick();
    assert.equal(menu().props.inert, true);
  });

  test('Escape also closes the search row; other keys do nothing', () => {
    byLabel(h.result, 'Search').props.onClick();
    press('a');
    assert.ok(find(h.result, (el) => el.props?.id === 'mobile-search'));
    press('Escape');
    assert.equal(find(h.result, (el) => el.props?.id === 'mobile-search'), null);
  });

  test('the query watcher reports the address bar; its links light up only then', async () => {
    const watcher = find(h.result, named('QueryWatcher'));
    assert.ok(watcher, 'inside a Suspense boundary');
    const links = () => find(h.result, (el) => el.props?.['aria-label'] === 'Main');
    const anklets = () => find(links(), (el) => el.type === Link && el.props.href === '/catalog?category=anklet');
    nav.pathname = '/catalog';
    h.render();
    assert.equal(anklets().props['aria-current'], undefined, 'unknown yet');
    watcher.props.onChange('category=anklet');
    assert.equal(anklets().props['aria-current'], 'page');
    assert.equal(find(links(), (el) => el.type === Link && el.props.href === '/catalog?category=earrings').props['aria-current'], undefined);
    watcher.props.onChange('');
    assert.equal(anklets().props['aria-current'], undefined);
  });
});

/* ═════════════ WelcomeBar.jsx ═════════════ */

function stubBrowser() {
  const store = new Map();
  const events = [];
  const clipboard = { written: [], fail: false };
  globalThis.window = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent: (e) => { events.push(e); return true; },
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (t) => { if (clipboard.fail) throw new Error('NotAllowedError'); clipboard.written.push(t); } } },
  });
  return { store, events, clipboard };
}

describe('WelcomeBar', { skip }, () => {
  const toast = Object.assign(mock.fn(), { success: mock.fn() });
  const realFetch = globalThis.fetch;
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let browser;
  let announced;
  let bar;

  const WelcomeBar = sucrase ? load('src/components/layout/WelcomeBar.jsx', {
    react: fakeReact,
    'react-hot-toast': esm(toast),
    'react-icons/fi': icons,
    '@/lib/welcomeOffer': welcomeOffer,
  }) : null;

  async function open(charges = DEFAULT_CHARGES, settings = null) {
    bar = mount(WelcomeBar.default, { settings, charges });
    await settle();
    return bar;
  }
  /* The strip's one line at a viewport width. */
  const line = (width) => squash(visibleText(find(bar.result, (el) => el.type === 'p'), width));

  beforeEach(() => {
    browser = stubBrowser();
    toast.mock.resetCalls(); toast.success.mock.resetCalls();
    announced = { success: true, enabled: true, message: DEFAULT_ANNOUNCEMENT.message, code: 'TULSI100', active: true };
    globalThis.fetch = async () => ({ json: async () => announced });
  });
  afterEach(() => {
    bar?.unmount();
    delete globalThis.window;
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    globalThis.fetch = realFetch;
  });

  const FREE_FOR_ALL = { ...DEFAULT_CHARGES, enable_shipping_fee: false };

  test('desktop: exactly the brief’s line when delivery is free for every order', async () => {
    await open(FREE_FOR_ALL);
    assert.equal(line(1280), '✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code: TULSI100 | Free Delivery across India 🚚');
    assert.equal(line(820), '✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code: TULSI100 | Free Delivery across India 🚚', 'from 820px there is room for the delivery clause');
  });

  test('tablet portrait (an iPad upright is 768px) drops the delivery clause so the offer is never cut short; phones get the short offer', async () => {
    await open(FREE_FOR_ALL);
    assert.equal(line(768), '✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code: TULSI100');
    assert.equal(line(819), '✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code: TULSI100');
    assert.equal(line(700), '✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code: TULSI100');
    assert.equal(line(390), '✨ ₹100 OFF first order | Code: TULSI100');
    assert.equal(line(320), '✨ ₹100 OFF first order | TULSI100', 'the “Code:” label gives way on the smallest phones');
  });

  test('delivery clause tells the truth: "Free Delivery across India" only when shipping is free for every order, otherwise no clause (never "free above ₹N")', async () => {
    await open(DEFAULT_CHARGES);
    assert.equal(line(1280), '✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code: TULSI100');
    bar.unmount();
    await open({ ...DEFAULT_CHARGES, free_shipping_threshold: 0 });
    assert.equal(line(1280), '✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code: TULSI100', 'a flat fee is not advertised either');
    bar.unmount();
    await open({ ...DEFAULT_CHARGES, enable_shipping_fee: false });
    assert.match(line(1280), /\| Free Delivery across India 🚚$/);
  });

  test('the separators and the emoji are decoration: hidden from a screen reader', async () => {
    await open(FREE_FOR_ALL);
    const p = find(bar.result, (el) => el.type === 'p');
    const hidden = [];
    (function walk(el) {
      if (el === null || typeof el !== 'object') return;
      if (Array.isArray(el)) { el.forEach(walk); return; }
      if (typeof el.type === 'function' && !el.props?.children) { walk(el.type(el.props)); return; }
      if (el.props?.['aria-hidden'] === 'true') hidden.push(squash(visibleText(el, 1280)));
      walk(el.props?.children);
    }(p));
    assert.deepEqual(hidden.filter((t) => t === '|').length, 2, 'both pipes');
    assert.ok(hidden.includes('✨') && hidden.includes('🚚'));
  });

  test('before the server vouches for the offer (and when it says no) the strip shows the fashion tagline, never the offer', async () => {
    announced = { ...announced, active: false };
    await open(FREE_FOR_ALL);
    const text = squash(visibleText(bar.result, 1280));
    assert.match(text, /✦ Modern Fashion Jewellery — Made for Every Day ✦/);
    assert.match(text, /Free Delivery across India/);
    assert.doesNotMatch(text, /TULSI100|Bridal|Handcrafted/);
    assert.equal(byLabel(bar.result, 'Apply code TULSI100 at checkout'), null);
  });

  test('the whole strip is the tap target: the code button stretches over it, and carries no transform or filter that would shrink that', async () => {
    await open(FREE_FOR_ALL);
    const chip = byLabel(bar.result, 'Apply code TULSI100 at checkout');
    assert.ok(chip);
    assert.match(chip.props.className, /after:absolute after:inset-0/);
    assert.doesNotMatch(chip.props.className, /scale|brightness|blur|filter|transform|translate|rotate|will-change|relative/, 'a transform or filter makes the button the ::after’s containing block');
    const strip = bar.result;
    assert.match(strip.props.className, /\brelative\b/, 'the strip is what the ::after is sized to');
    const dismiss = byLabel(bar.result, 'Dismiss offer');
    assert.match(dismiss.props.className, /relative z-10/, 'the ✕ stays above the stretched button');
    assert.match(find(bar.result, (el) => el.type === 'a').props.className, /relative z-10/, 'and so does the phone');
  });

  test('clicking copies the code, remembers it for checkout, tells an open cart, and says so', async () => {
    await open(FREE_FOR_ALL);
    await byLabel(bar.result, 'Apply code TULSI100 at checkout').props.onClick();
    assert.deepEqual(browser.clipboard.written, ['TULSI100']);
    assert.equal(JSON.parse(browser.store.get(PENDING_COUPON_KEY)).code, 'TULSI100');
    assert.deepEqual(browser.events.map((e) => [e.type, e.detail]), [['tj:pending-coupon', { code: 'TULSI100' }]]);
    assert.equal(toast.success.mock.callCount(), 1);
    assert.deepEqual(toast.success.mock.calls[0].arguments, ['TULSI100 copied — applied at checkout on your first order', { id: 'welcome-code', position: 'bottom-center' }]);
  });

  test('without a clipboard (http, in-app browsers) it still saves the code and does not claim to have copied it', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await open(FREE_FOR_ALL);
    await byLabel(bar.result, 'Apply code TULSI100 at checkout').props.onClick();
    assert.deepEqual(toast.success.mock.calls[0].arguments, ['TULSI100 will be applied at checkout', { id: 'welcome-code', position: 'bottom-center' }]);
    assert.ok(browser.store.has(PENDING_COUPON_KEY));
  });

  test('a refused copy (permission) reads the same as no clipboard', async () => {
    browser.clipboard.fail = true;
    await open(FREE_FOR_ALL);
    await byLabel(bar.result, 'Apply code TULSI100 at checkout').props.onClick();
    assert.match(toast.success.mock.calls[0].arguments[0], /^TULSI100 will be applied at checkout$/);
  });

  test('no clipboard and no storage (private mode): just tells the shopper the code', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    globalThis.window.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    await open(FREE_FOR_ALL);
    await byLabel(bar.result, 'Apply code TULSI100 at checkout').props.onClick();
    assert.equal(toast.success.mock.callCount(), 0);
    assert.deepEqual(toast.mock.calls[0].arguments, ['Use code TULSI100 at checkout', { id: 'welcome-code', icon: '✨', position: 'bottom-center' }]);
  });

  test('✕ puts the tagline back and remembers the dismissal for this offer', async () => {
    await open(FREE_FOR_ALL);
    byLabel(bar.result, 'Dismiss offer').props.onClick();
    assert.equal(browser.store.get(DISMISS_KEY), 'TULSI100|Welcome Offer: Flat ₹100 OFF on your first order');
    assert.match(squash(visibleText(bar.result, 1280)), /Modern Fashion Jewellery/);
    assert.equal(byLabel(bar.result, 'Apply code TULSI100 at checkout'), null);
  });

  test('the owner can still set their own offer; the phone short form follows it', async () => {
    announced = { ...announced, message: 'Diwali Special: Flat 20% OFF on all necklaces', code: 'DIWALI20' };
    await open(FREE_FOR_ALL);
    assert.equal(line(1280), '✨ Diwali Special: Flat 20% OFF on all necklaces | Use Code: DIWALI20 | Free Delivery across India 🚚');
    assert.equal(line(390), '✨ 20% OFF | Code: DIWALI20');
  });
});

/* ═════════════ AnnouncementSettingsPanel.jsx (the admin's card + preview) ═════════════ */

describe('AnnouncementSettingsPanel', { skip }, () => {
  const panelCart = { charges: DEFAULT_CHARGES };
  const loadPanel = () => {
    const WelcomeBarModule = load('src/components/layout/WelcomeBar.jsx', {
      react: React, 'react-hot-toast': esm(() => {}), 'react-icons/fi': icons, '@/lib/welcomeOffer': welcomeOffer,
    });
    return load('src/components/admin/AnnouncementSettingsPanel.jsx', {
      react: React,
      'next/link': esm(Link),
      'react-icons/fi': icons,
      '@/context/CartContext': { useCart: () => panelCart },
      '@/lib/welcomeOffer': welcomeOffer,
      '@/components/layout/WelcomeBar': WelcomeBarModule,
    }).default;
  };
  const Panel = sucrase ? loadPanel() : null;
  const render = (props) => renderToStaticMarkup(React.createElement(Panel, { onChange() {}, ...props }));
  const textOfHtml = (h) => squash(h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;|&ldquo;|&rdquo;/g, '"'));
  const previews = (h) => [...h.matchAll(/<div class="relative h-8 overflow-hidden rounded-md[^"]*">(.*?)<\/div><\/div>/gs)].map((m) => textOfHtml(m[1]));

  test('nothing saved yet: the fields show the new default offer', () => {
    const h = render({ value: undefined });
    assert.match(h, /placeholder="Welcome Offer: Flat ₹100 OFF on your first order"/);
    assert.match(h, /placeholder="TULSI100"/);
    assert.match(h, /value="Welcome Offer: Flat ₹100 OFF on your first order"/);
    assert.match(h, /value="TULSI100"/);
    assert.doesNotMatch(h, /TULSI10[^0]|10% OFF|bridal/i);
  });

  test('the previews are the strip: computer and phone, with the delivery clause only when delivery is free for everyone', () => {
    panelCart.charges = { ...DEFAULT_CHARGES, enable_shipping_fee: false };
    const [desktop, phone] = previews(render({ value: undefined }));
    assert.equal(desktop, '✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code: TULSI100 | Free Delivery across India 🚚');
    assert.equal(phone, '✨ ₹100 OFF first order | Code: TULSI100');
    panelCart.charges = DEFAULT_CHARGES;
    assert.equal(previews(render({ value: undefined }))[0], '✨ Welcome Offer: Flat ₹100 OFF on your first order | Use Code: TULSI100', 'no "free above ₹N" clause');
  });

  test('switched off: the previews show the fashion tagline and the phone (and the delivery line only when delivery is free for everyone)', () => {
    const [desktop, phone] = previews(render({ value: { enabled: false, message: 'x', code: 'TULSI100' }, phone: '+91 99999 11111' }));
    assert.match(desktop, /^✦ Modern Fashion Jewellery — Made for Every Day ✦ .*\+91 99999 11111$/);
    assert.doesNotMatch(desktop, /Free delivery above|Delivery ₹/);
    assert.match(phone, /^.*\+91 99999 11111$/);
    assert.doesNotMatch(desktop, /Bridal|Handcrafted/);
    panelCart.charges = { ...DEFAULT_CHARGES, enable_shipping_fee: false };
    const [freeDesktop] = previews(render({ value: { enabled: false, message: 'x', code: 'TULSI100' }, phone: '+91 99999 11111' }));
    assert.match(freeDesktop, /Free Delivery across India · .*\+91 99999 11111$/);
    panelCart.charges = DEFAULT_CHARGES;
  });

  test('the help text says what clicking does and where the delivery line comes from', () => {
    const t = textOfHtml(render({ value: undefined }));
    assert.match(t, /Clicking it copies the code and saves it for checkout/);
    assert.match(t, /First order only/);
    assert.match(t, /[“"]Free Delivery across India[”"] appears only when shipping is switched off for every order/);
  });
});

/* ═════════════ welcomeOffer.js helpers ═════════════ */

describe('delivery line', () => {
  test('"Free Delivery across India" only when shipping is free for every order', () => {
    assert.equal(FREE_DELIVERY_LINE, 'Free Delivery across India');
    assert.equal(deliveryFreeForAll({ ...DEFAULT_CHARGES, enable_shipping_fee: false }), true);
    assert.equal(deliveryFreeForAll({ enable_shipping_fee: false }), true);
    assert.equal(deliveryFreeForAll({ ...DEFAULT_CHARGES, shipping_fee_amount: 0 }), true, 'a ₹0 fee is free delivery too');
    assert.equal(deliveryFreeForAll({ ...DEFAULT_CHARGES, free_shipping_threshold: 1 }), true, 'free from ₹1 up = every order');
    assert.equal(deliveryFreeForAll(DEFAULT_CHARGES), false);
    assert.equal(deliveryFreeForAll({ ...DEFAULT_CHARGES, free_shipping_threshold: 0 }), false, 'never free');
    for (const junk of [undefined, null, {}, 'x']) assert.equal(deliveryFreeForAll(junk), false, String(junk));
  });

  test('otherwise nothing: a "free above ₹N" condition or a flat fee is not advertised (the cart and checkout show how much more unlocks free delivery)', () => {
    assert.equal(deliveryLine(DEFAULT_CHARGES), '');
    assert.equal(deliveryLine({ ...DEFAULT_CHARGES, free_shipping_threshold: 1500 }), '');
    assert.equal(deliveryLine({ ...DEFAULT_CHARGES, free_shipping_threshold: 0, shipping_fee_amount: 79 }), '');
    assert.equal(deliveryLine({ ...DEFAULT_CHARGES, enable_shipping_fee: false }), 'Free Delivery across India');
  });
});

describe('copyToClipboard / codeTapToast', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  afterEach(() => { if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator); });
  const withClipboard = (writeText) => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: writeText ? { clipboard: { writeText } } : {} });

  test('copies and says so; false when there is no Clipboard API or the browser refuses', async () => {
    const written = [];
    withClipboard(async (t) => { written.push(t); });
    assert.equal(await copyToClipboard('TULSI100'), true);
    assert.deepEqual(written, ['TULSI100']);
    withClipboard(null);
    assert.equal(await copyToClipboard('TULSI100'), false);
    withClipboard(async () => { throw new Error('NotAllowedError'); });
    assert.equal(await copyToClipboard('TULSI100'), false);
    withClipboard(() => { throw new Error('sync failure'); });
    assert.equal(await copyToClipboard('TULSI100'), false);
  });

  test('a browser that never answers does not hold the toast back', async () => {
    withClipboard(() => new Promise(() => {}));
    const t0 = Date.now();
    assert.equal(await copyToClipboard('TULSI100', 30), false);
    assert.ok(Date.now() - t0 < 1000);
  });

  test('the toast only claims what happened', () => {
    assert.deepEqual(codeTapToast('TULSI100', { copied: true, saved: true }), { kind: 'success', message: 'TULSI100 copied — applied at checkout on your first order' });
    assert.deepEqual(codeTapToast('TULSI100', { copied: true, saved: false }), { kind: 'success', message: 'TULSI100 copied — paste it at checkout' });
    assert.deepEqual(codeTapToast('TULSI100', { copied: false, saved: true }), { kind: 'success', message: 'TULSI100 will be applied at checkout' });
    assert.deepEqual(codeTapToast('TULSI100', { copied: false, saved: false }), { kind: 'info', message: 'Use code TULSI100 at checkout' });
  });
});

describe('the default offer', () => {
  test('is the brief’s: flat ₹100 off the first order, code TULSI100', () => {
    assert.equal(DEFAULT_ANNOUNCEMENT.message, 'Welcome Offer: Flat ₹100 OFF on your first order');
    assert.equal(DEFAULT_ANNOUNCEMENT.code, 'TULSI100');
    assert.equal(DEFAULT_ANNOUNCEMENT.enabled, true);
  });
});
