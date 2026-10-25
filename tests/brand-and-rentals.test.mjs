/* ─────────────────────────────────────────────
   "Tulsi Fashion Jewellery" — the rebrand from "Tulsi Bridal Jewellery" and the end of
   public jewellery rentals.

     · next.config.mjs: the three retired rental URLs redirect permanently; the other
       rules (security headers, the showcase preview frame, the font cache) are intact
     · sitemap, robots, llms.txt, the OG image and the root metadata: the new name and
       keywords, and not one rental URL
     · the pages are gone, and nothing in the storefront links to them or reads the
       rental fields of a product
     · /api/products still serves everything (the `rental` filter included) — and takes
       a comma-separated category for the "Chains & Necklaces" shelf
     · e-mail and WhatsApp carry the new name
     · SWEEP: no customer-facing source file reintroduces "Tulsi Bridal", bridal / bride /
       wedding wording or a rental link

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import * as seoSchema from '../src/lib/seoSchema.js';

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
const read = (rel) => readFileSync(path.resolve(rel), 'utf8');

let db;
let session = null;
const getServerSession = async () => session;
mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: {
    getDB: () => db,
    FieldValue: { increment: (n) => n, serverTimestamp: () => new Date().toISOString() },
    docToObj: (d) => (d.exists ? { id: d.id, ...d.data() } : null),
    snapshotToArr: (snap) => snap.docs.map((d) => ({ id: d.id, _id: d.id, ...d.data() })),
    toPublicProduct: (p) => { const { supplyCost: _drop, ...rest } = p; return rest; },
  },
});
/* seo.js carries a JSX component (JsonLd) that node can't load: hand the route the pure half. */
mock.module(src('lib/seo.js'), { namedExports: { ...seoSchema, getSiteSettings: async () => ({}) } });

const { default: nextConfig } = await import('../next.config.mjs');
const { default: sitemap } = await import(src('app/sitemap.js'));
const { default: robots } = await import(src('app/robots.js'));
const llms = await import(src('app/llms.txt/route.js'));
const productsRoute = await import(src('app/api/products/route.js'));

const PRODUCTS = {
  chain: { name: 'Layered Gold Chain', category: 'chain', price: 899, stock: 5, isActive: true, createdAt: '2026-10-03T00:00:00Z', supplyCost: 300 },
  neck: { name: 'Pearl Drop Necklace', category: 'necklace', price: 1299, stock: 2, isActive: true, createdAt: '2026-10-02T00:00:00Z', isAvailableForRent: true, rentalPrice: 400, rentalStock: 2 },
  ear: { name: 'Minimal Studs', category: 'earrings', price: 399, stock: 9, isActive: true, createdAt: '2026-10-01T00:00:00Z' },
  hidden: { name: 'Draft Anklet', category: 'anklet', price: 499, stock: 1, isActive: false, createdAt: '2026-09-30T00:00:00Z' },
};
beforeEach(() => {
  session = null;
  db = fakeFirestore({ products: structuredClone(PRODUCTS) });
});

/* ═════════════ next.config.mjs ═════════════ */

describe('next.config.mjs — the retired rental URLs', () => {
  test('/rentals and /rental-success → /shop, /rental-booking/:id → /product/:id — all permanent', async () => {
    const rules = await nextConfig.redirects();
    assert.deepEqual(rules, [
      { source: '/rentals', destination: '/shop', permanent: true },
      { source: '/rental-booking/:id', destination: '/product/:id', permanent: true },
      { source: '/rental-success', destination: '/shop', permanent: true },
    ]);
  });

  test('every destination is a page that still exists', async () => {
    for (const { destination } of await nextConfig.redirects()) {
      const page = destination.replace(/:id$/, '[id]');
      assert.ok(existsSync(path.resolve(`src/app${page}/page.js`)), `${destination} → src/app${page}/page.js`);
    }
  });

  test('the retired pages are deleted (a redirect runs before the file system, so they could never be served)', () => {
    for (const dir of ['src/app/rentals', 'src/app/rental-booking', 'src/app/rental-success']) assert.ok(!existsSync(path.resolve(dir)), dir);
  });

  test('the file’s other rules are intact: security headers everywhere, the preview frame, the immutable ₹ fonts, image hosts', async () => {
    const rules = await nextConfig.headers();
    const by = (source) => rules.find((r) => r.source === source)?.headers.map((h) => h.key);
    assert.deepEqual(by('/:path*'), ['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Permissions-Policy']);
    assert.deepEqual(by('/showcase-preview'), ['Content-Security-Policy', 'X-Frame-Options']);
    assert.deepEqual(rules.find((r) => r.source === '/fonts/:file*').headers, [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]);
    assert.deepEqual(nextConfig.images.formats, ['image/avif', 'image/webp']);
    assert.deepEqual(nextConfig.images.remotePatterns.map((p) => p.hostname), ['res.cloudinary.com', 'images.unsplash.com']);
  });
});

/* ═════════════ sitemap · robots · llms.txt · OG · root metadata ═════════════ */

describe('crawlers and AI engines', () => {
  test('sitemap: the shop, the catalogue and the info pages — no rental URL, one URL per live product', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    assert.ok(urls.includes(`${seoSchema.SITE_URL}/shop`) && urls.includes(`${seoSchema.SITE_URL}/catalog`));
    assert.ok(urls.includes(`${seoSchema.SITE_URL}/product/chain`) && urls.includes(`${seoSchema.SITE_URL}/product/neck`), 'a product that is also flagged rentable is just a product');
    assert.ok(!urls.some((u) => u.endsWith('/product/hidden')), 'inactive products stay out');
    assert.deepEqual(urls.filter((u) => /rental/i.test(u)), []);
  });

  test('sitemap still builds the page routes when the database is unreachable', async () => {
    db = { collection: () => { throw new Error('unreachable'); } };
    const urls = (await sitemap()).map((e) => e.url);
    assert.ok(urls.includes(seoSchema.SITE_URL) && urls.includes(`${seoSchema.SITE_URL}/faq`));
    assert.deepEqual(urls.filter((u) => /rental/i.test(u)), []);
  });

  test('robots: no rental path is listed, allowed or disallowed (the 301 must stay crawlable)', () => {
    const r = robots();
    for (const rule of r.rules) {
      for (const p of [].concat(rule.allow || [], rule.disallow || [])) assert.doesNotMatch(p, /rental/i, p);
    }
    assert.ok(r.rules[0].allow.includes('/shop') && r.rules[0].allow.includes('/catalog'));
  });

  test('llms.txt: the new name and range; no rentals page, no "available to rent", nothing bridal', async () => {
    const res = await llms.GET();
    const text = await res.text();
    assert.match(text, /^# Tulsi Fashion Jewellery\n/);
    assert.match(text, /modern minimalist fashion jewellery — trending chains, necklaces, earrings and anklets/);
    assert.match(text, /\[Shop all jewellery\]\(https:\/\/tulsijewels\.in\/shop\)/);
    assert.match(text, /\[Layered Gold Chain\]\(.*\/product\/chain\): ₹899/);
    assert.match(text, /### Chain/);
    assert.match(text, /### Necklace/);
    assert.doesNotMatch(text.replaceAll('tulsibridaljewellery@gmail.com', ''), /\brent(al|als|ed)?\b|bridal|bride|wedding|available to rent/i);
  });

  test('OG image: the brief’s two lines', () => {
    const og = read('src/app/opengraph-image.js');
    assert.match(og, />\s*TULSI FASHION JEWELLERY\s*</);
    assert.match(og, />\s*FASHION JEWELLERY · TRENDING CHAINS, NECKLACES, EARRINGS & ANKLETS\s*</);
    assert.doesNotMatch(og, /BRIDAL|BUY OR RENT/i);
  });

  test('root metadata: the name, the description and the new keyword set — no bridal, no rent', () => {
    const layout = read('src/app/layout.js');
    const description = layout.match(/const DESCRIPTION = '([^']*)'/)[1];
    const keywords = [...layout.match(/keywords: \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.match(description, /fashion jewellery/i);
    for (const piece of ['chains', 'necklaces', 'earrings', 'anklets']) assert.match(description, new RegExp(piece));
    assert.doesNotMatch(description, /bridal|wedding|rent|free delivery/i, 'the static description can’t promise what the shipping settings may not');
    for (const k of ['fashion jewellery online India', 'trending chains', 'necklaces', 'earrings', 'anklets', 'daily-wear jewellery', 'casual jewellery', 'festive jewellery', 'anti-tarnish jewellery']) {
      assert.ok(keywords.includes(k), k);
    }
    assert.ok(!keywords.some((k) => /bridal|bride|wedding|rent/i.test(k)), keywords.join(' | '));
    assert.match(layout, /title: \{ default: SITE_NAME, template: `%s \| \$\{SITE_NAME\}` \}/);
    assert.equal(seoSchema.SITE_NAME, 'Tulsi Fashion Jewellery');
  });

  test('the FAQ page’s metadata and the policy / info page titles use the new name', () => {
    /* These four set only the page's own name: the root layout's template (`%s | Tulsi Fashion Jewellery`,
       asserted above) adds the brand — spelling it here too printed it twice in the browser tab. */
    for (const [file, name] of Object.entries({
      'src/app/about/page.js': 'About Us', 'src/app/terms/page.js': 'Terms & Conditions',
      'src/app/privacy/page.js': 'Privacy Policy', 'src/app/refunds/page.js': 'Refund & Return Policy',
    })) {
      const text = read(file);
      assert.ok(text.includes(`title: '${name}',`), `${file}: title is just "${name}"`);
      assert.doesNotMatch(text, /title: '[^']*Tulsi/, `${file}: the template adds the brand`);
    }
    const titles = {
      'src/app/faq/page.js': 'FAQ | Tulsi Fashion Jewellery',
      'src/app/shop/page.js': 'Shop | Tulsi Fashion Jewellery',
      'src/app/catalog/page.js': 'Jewellery Catalogue | Tulsi Fashion Jewellery',
      'src/app/contact/layout.js': 'Contact Us | Tulsi Fashion Jewellery',
      'src/app/track-order/layout.js': 'Track Your Order | Tulsi Fashion Jewellery',
      'src/app/become-a-vendor/page.js': 'Become a Vendor | Tulsi Fashion Jewellery',
    };
    for (const [file, title] of Object.entries(titles)) assert.ok(read(file).includes(`'${title}'`), `${file}: ${title}`);
    assert.doesNotMatch(read('src/app/faq/page.js'), /Rentals/);
  });
});

/* ═════════════ the legal pages ═════════════ */

describe('legal pages — rental clauses removed, nothing added', () => {
  const headings = (file) => [...read(file).matchAll(/<h2 className="[^"]*">([^<]+)<\/h2>/g)].map((m) => m[1]);

  test('terms: the Rental Terms section is gone and the sections are renumbered 1–9', () => {
    const h = headings('src/app/terms/page.js');
    assert.deepEqual(h.map((t) => t.replace(/&amp;/g, '&')), [
      '1. Acceptance of Terms', '2. Products & Pricing', '3. Orders & Payment', '4. Delivery', '5. Intellectual Property',
      '6. User Accounts', '7. Limitation of Liability', '8. Governing Law', '9. Contact',
    ]);
    assert.doesNotMatch(read('src/app/terms/page.js'), /rental|security deposit/i);
  });

  test('refunds: no rental returns / deposits section; "Return Eligibility" no longer says "(Purchase Orders)"', () => {
    const h = headings('src/app/refunds/page.js');
    assert.deepEqual(h.map((t) => t.replace(/&amp;/g, '&')), ['1. Return Eligibility', '2. How to Initiate a Return', '3. Refund Timeline', '4. Order Cancellations (Before Dispatch)', 'Need Help?']);
    assert.doesNotMatch(read('src/app/refunds/page.js'), /rental|security deposit|late returns/i);
  });

  test('privacy: purchases only; the sentence "we do not … rent your personal data" is about data, so it stays', () => {
    const privacy = read('src/app/privacy/page.js');
    assert.doesNotMatch(privacy, /rentals|rental bookings/i);
    assert.match(privacy, /We do not sell, trade, or rent your personal data to third parties/);
    assert.match(privacy, /Tulsi Fashion Jewellery \("we", "our", "us"\)/);
  });

  test('contact: no "Rental Enquiries?" card; about: no rental count or bride wording', () => {
    assert.doesNotMatch(read('src/app/contact/page.js'), /Rental Enquiries|wedding package/i);
    assert.doesNotMatch(read('src/app/about/page.js'), /rental|brides?\b|bridal/i);
  });
});

/* ═════════════ the storefront ═════════════ */

describe('storefront — no rent UI', () => {
  test('product page: no "Available to Rent" badge, rental price, WhatsApp rental enquiry or rental state', () => {
    const page = read('src/app/product/[id]/ProductDetail.js');
    assert.doesNotMatch(page, /\brent(al)?\b|isAvailableForRent|rentalPrice|rentalStock|FiCalendar/i);
    assert.match(page, /Buy Now/, 'the buy button is still there');
  });

  test('shop and catalogue: no rental filter, toggle or request parameter', () => {
    for (const file of ['src/app/shop/ShopContent.js', 'src/app/catalog/CatalogContent.js']) {
      assert.doesNotMatch(read(file), /rental|Rental Only/i, file);
    }
  });

  test('the catalogue’s "Chains & Necklaces" shelf asks for both categories; the others ask for one', () => {
    const catalog = read('src/app/catalog/CatalogContent.js');
    assert.match(catalog, /const CATEGORY_SHELVES = \{ necklace: \['necklace', 'chain'\] \};/);
    assert.match(catalog, /params\.set\('category', \(CATEGORY_SHELVES\[category\] \|\| \[category\]\)\.join\(','\)\)/);
    assert.match(catalog, /label: 'Chains & Necklaces', value: 'necklace'/);
    assert.match(catalog, /label: 'Jewellery Sets',\s+value: 'set'/);
    assert.doesNotMatch(catalog, /Bridal/);
    assert.match(read('src/app/shop/ShopContent.js'), /'necklace', 'chain', 'earrings', 'anklet'/, 'the shop can filter on chains too');
  });

  test('product grids key each card by id — /api/products sends `id`, never `_id`, so `key={p._id}` alone left every card without a key (React warns on /shop)', () => {
    for (const f of ['src/app/shop/ShopContent.js', 'src/app/catalog/CatalogContent.js', 'src/components/shop/FeaturedProducts.js']) {
      const code = read(f);
      assert.match(code, /<ProductCard key=\{p\._id \|\| p\.id\}/, f);
      assert.doesNotMatch(code, /<ProductCard key=\{p\._id\}/, f);
    }
  });

  test('"Trending Now" opens the shop under a heading that says so', () => {
    const shop = read('src/app/shop/ShopContent.js');
    assert.match(shop, /sort === TRENDING_SORT \? 'Trending Now' : 'All Jewellery'/);
    assert.match(shop, /const TRENDING_SORT = 'ratings\.average-desc';/);
  });

  test('the unused bridal / rental components are gone; the ones kept carry no bridal wording', () => {
    for (const f of ['shop/HeroBanner', 'shop/RentalBanner', 'shop/Testimonials', 'shop/CategoryGrid', 'catalog/WelcomeSection', 'catalog/CatalogHero', 'catalog/CatalogProductItem', 'catalog/OrderingProcess']) {
      assert.ok(!existsSync(path.resolve(`src/components/${f}.js`)), f);
    }
    assert.match(read('src/components/shop/FeaturedProducts.js'), /Our most loved pieces/);
  });

  test('home category showcase: six fashion cards led by Chains & Necklaces, Earrings, Anklets — and no link to /rentals', async () => {
    const { SHOWCASE_CARDS } = await import(src('lib/categoryShowcase.js'));
    assert.deepEqual(SHOWCASE_CARDS.map((c) => c.label), ['Chains & Necklaces', 'Earrings', 'Anklets', 'Bracelets', 'Bangles', 'Jewellery Sets']);
    assert.ok(SHOWCASE_CARDS.every((c) => /^\/catalog\?category=[a-z-]+$/.test(c.href)), 'every card opens the catalogue on a category');
    assert.ok(!SHOWCASE_CARDS.some((c) => /rental|bridal/i.test(`${c.key} ${c.label} ${c.href}`)));
  });

  test('home category showcase: a stored doc that still has the retired maang-tikka / rentals items just stops showing them', async () => {
    const { normalizeShowcase, visibleItems, CARD_KEYS } = await import(src('lib/categoryShowcase.js'));
    const stored = {
      categoryShowcase: {
        layout: { layoutVariant: 'circle', displayMode: 'grid', size: 'small' },
        items: [
          { key: 'rentals', isActive: true, isFeatured: true, displayOrder: 0, image: 'https://res.cloudinary.com/tulsi/image/upload/v1/tulsi-bridal/categories/rentals.jpg' },
          { key: 'maang-tikka', isActive: true, displayOrder: 1 },
          { key: 'necklace', isActive: true, displayOrder: 2, image: 'https://res.cloudinary.com/tulsi/image/upload/v1/tulsi-bridal/categories/necklace.jpg' },
        ],
      },
    };
    const showcase = normalizeShowcase(stored);
    assert.deepEqual(showcase.items.map((i) => i.key).sort(), [...CARD_KEYS].sort(), 'exactly the six current cards');
    assert.ok(!visibleItems(showcase).some((i) => i.key === 'rentals' || i.key === 'maang-tikka'));
    assert.match(showcase.items.find((i) => i.key === 'necklace').image, /necklace\.jpg$/, 'a photo that is still valid is kept');
    assert.ok(showcase.items.every((i) => i.isFeatured === false), 'the featured flag of a retired card goes with it');
  });
});

/* ═════════════ /api/products ═════════════ */

describe('GET /api/products', () => {
  const get = async (query = '') => {
    const res = await productsRoute.GET(new Request(`https://tulsi.test/api/products${query}`));
    return res.json();
  };
  const names = (json) => json.data.products.map((p) => p.name);

  test('still serves everything it served: active products, newest first, supplier cost never public', async () => {
    const json = await get('?limit=50');
    assert.equal(json.success, true);
    assert.equal(json.data.total, 3);
    assert.ok(json.data.products.every((p) => !('supplyCost' in p)));
  });

  test('the `rental` filter still works for existing callers (true → rentable only, false → the rest)', async () => {
    assert.deepEqual(names(await get('?rental=true')), ['Pearl Drop Necklace']);
    assert.deepEqual(names(await get('?rental=false&sort=name&order=asc')), ['Layered Gold Chain', 'Minimal Studs']);
  });

  test('a single category filters exactly as before; a comma-separated list is a shelf of several', async () => {
    assert.deepEqual(names(await get('?category=necklace')), ['Pearl Drop Necklace']);
    assert.deepEqual(names(await get('?category=chain')), ['Layered Gold Chain']);
    assert.deepEqual(names(await get('?category=necklace,chain&sort=name&order=asc')), ['Layered Gold Chain', 'Pearl Drop Necklace']);
    assert.deepEqual(names(await get('?category=necklace%2C%20earrings&sort=name&order=asc')), ['Minimal Studs', 'Pearl Drop Necklace'], 'spaces around a comma are ignored');
    assert.deepEqual(names(await get('?category=anklet')), [], 'an inactive product stays hidden');
    assert.deepEqual(names(await get('?category=nothing')), []);
  });

  test('search understands plurals, categories and several words; an unknown word finds nothing', async () => {
    assert.deepEqual(names(await get('?search=necklaces')), ['Pearl Drop Necklace']);
    assert.deepEqual(names(await get('?search=earring')), ['Minimal Studs']);
    assert.deepEqual(names(await get('?search=Layered%20chains')), ['Layered Gold Chain']);
    assert.deepEqual(names(await get('?search=chains%20%26%20necklaces&sort=name&order=asc')), ['Layered Gold Chain', 'Pearl Drop Necklace']);
    assert.deepEqual(names(await get('?search=minimal')), ['Minimal Studs'], 'a name still matches as before');
    assert.deepEqual(names(await get('?search=zzz')), []);
    assert.deepEqual(names(await get('?search=anklet')), [], 'an inactive product stays hidden');
  });
});

describe('POST /api/rentals', () => {
  test('new bookings are closed: 410, nothing is read or written', async () => {
    const rentalsRoute = await import(`${src('app/api/rentals/route.js')}?closed`);
    const res = await rentalsRoute.POST(new Request('https://tulsi.test/api/rentals', { method: 'POST', body: JSON.stringify({ productId: 'p1' }) }));
    assert.equal(res.status, 410);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.message, /no longer available/i);
  });
});

/* ═════════════ e-mail and WhatsApp ═════════════ */

describe('customer messages carry the new name', () => {
  test('e-mail: sender, subjects and the branded header / footer say Tulsi Fashion Jewellery', async () => {
    const sent = [];
    mock.module('nodemailer', { defaultExport: { createTransport: () => ({ sendMail: async (m) => { sent.push(m); } }) } });
    process.env.SMTP_USER = 'shop@tulsi.test';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://tulsijewels.in';
    const email = await import(`${src('lib/email.js')}?brand`);
    const order = {
      orderNumber: 'TJ1001', guestEmail: 'buyer@example.test', total: 1299, subtotal: 1299, status: 'confirmed',
      items: [{ name: 'Pearl Drop Necklace', quantity: 1, price: 1299 }],
      shippingAddress: { name: 'Asha', address: '1 Main Rd', city: 'Chennai', state: 'TN', pincode: '600001', phone: '9876543210' },
      payment: { method: 'cod' },
    };
    assert.equal(await email.sendOrderConfirmation(order), true);
    await email.sendOTPEmail('buyer@example.test', '123456');
    assert.equal(sent.length, 2);
    const [confirmation, otp] = sent;
    assert.equal(confirmation.from, '"Tulsi Fashion Jewellery" <shop@tulsi.test>');
    assert.equal(confirmation.subject, 'Order Confirmed #TJ1001 | Tulsi Fashion Jewellery');
    assert.match(confirmation.html, />Fashion Jewellery<\/p>/, 'the header sub-line');
    assert.match(confirmation.html, /Thank you for shopping with Tulsi Fashion Jewellery/);
    assert.match(confirmation.html, /© \d{4} Tulsi Fashion Jewellery\. All rights reserved\./);
    assert.equal(otp.subject, '123456 is your Tulsi Fashion Jewellery login code');
    for (const m of sent) assert.doesNotMatch(`${m.from} ${m.subject} ${m.html}`, /bridal|bride|wedding|\brent(al)?\b/i);
  });

  test('WhatsApp: order messages are signed Tulsi Fashion Jewellery; admin alerts say Tulsi Fashion', async () => {
    const bodies = [];
    process.env.ULTRAMSG_INSTANCE_ID = 'instance1';
    process.env.ULTRAMSG_TOKEN = 'token';
    process.env.ADMIN_WHATSAPP = '+917695868787';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => { bodies.push(new URLSearchParams(init.body).get('body')); return { json: async () => ({ sent: 'true' }) }; };
    try {
      const wa = await import(`${src('lib/whatsapp.js')}?brand`);
      const order = {
        orderNumber: 'TJ1001', total: 1299, items: [{ name: 'Pearl Drop Necklace', quantity: 1, price: 1299 }],
        shippingAddress: { name: 'Asha', phone: '9876543210', address: '1 Main Rd', city: 'Chennai', state: 'TN', pincode: '600001' }, payment: { method: 'cod' },
      };
      await wa.sendOrderWhatsAppToAdmin(order);
      await wa.sendOrderWhatsAppToCustomer(order);
      await wa.sendStatusWhatsApp(order, 'shipped');
      await wa.sendContactWhatsApp({ name: 'Asha', email: 'a@x.test', message: 'hi' });
      await wa.sendReviewWhatsApp({ productName: 'Pearl Drop Necklace', reviewerName: 'Asha', rating: 5, comment: 'Lovely' });
    } finally { globalThis.fetch = realFetch; }
    assert.ok(bodies.length >= 5, `sent ${bodies.length}`);
    for (const body of bodies) assert.doesNotMatch(body, /bridal/i, body);
    assert.ok(bodies.some((b) => b.includes('*New Order — Tulsi Fashion Jewellery*')));
    assert.ok(bodies.some((b) => b.includes('*Order Confirmed — Tulsi Fashion Jewellery*')));
    assert.ok(bodies.some((b) => b.includes('*Tulsi Fashion Jewellery — Order Update* ✨')));
    assert.ok(bodies.some((b) => b.includes('*New Contact Message — Tulsi Fashion*')));
    assert.ok(bodies.some((b) => b.includes('*New Review — Tulsi Fashion*')));
  });

  test('the server still has its rental e-mail / WhatsApp senders (existing bookings keep working)', async () => {
    const email = await import(`${src('lib/email.js')}?brand`);
    const wa = await import(`${src('lib/whatsapp.js')}?brand`);
    for (const fn of ['sendRentalConfirmation', 'sendRentalNotificationToAdmin']) assert.equal(typeof email[fn], 'function', fn);
    for (const fn of ['sendRentalWhatsAppToAdmin', 'sendRentalWhatsAppToCustomer']) assert.equal(typeof wa[fn], 'function', fn);
  });
});

/* ═════════════ the sweep ═════════════ */

/* Every .js / .jsx under src/, relative paths with forward slashes. */
function sourceFiles(dir = 'src') {
  return readdirSync(path.resolve(dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(path.resolve(rel)).isDirectory()) return sourceFiles(rel);
    return /\.(js|jsx|mjs)$/.test(name) ? [rel] : [];
  });
}
/* Prose in comments may talk about the old store ("a gift sent to a bride …"); only code and copy count. */
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* Not storefront: the admin console (rental management for bookings already made lives there), the API
   (the rental routes stay, so does the data), the seller portal and the admin-only preview frame. */
const NOT_STOREFRONT = /^src\/app\/(admin|admin-portal|api|vendor|showcase-preview)\/|^src\/components\/(admin|vendor)\//;
/* Server code that keeps serving existing rentals — it may name them (and send their e-mails / messages). */
const RENTAL_SERVER = new Set([
  'src/lib/email.js', 'src/lib/whatsapp.js', // sendRental* — for bookings already made
  'src/lib/access.js', 'src/lib/data/scopedDb.js', 'src/lib/utils.js', // permission / collection / day-count names
  'src/lib/analytics/classify.js', // route names, so old inbound traffic is still classified
]);

describe('sweep — nothing customer-facing goes back to the old store', () => {
  const files = sourceFiles();
  const code = new Map(files.map((f) => [f, stripComments(read(f))]));

  test('the sweep sees the whole of src/', () => {
    assert.ok(files.length > 300, `only ${files.length} files`);
    for (const f of ['src/app/layout.js', 'src/lib/seoSchema.js', 'src/components/shop/ProductCard.js', 'src/app/api/products/route.js']) assert.ok(code.has(f), f);
  });

  test('"Tulsi Bridal" appears nowhere in src/ — not in a page, an e-mail, a message, an invoice or an admin screen', () => {
    const hits = files.filter((f) => /tulsi\s+bridal/i.test(read(f)));
    assert.deepEqual(hits, []);
  });

  test('"Tulsi Bridal" appears nowhere in scripts/ either — the platform-vendor migration would otherwise create the old name on a fresh database', () => {
    const hits = sourceFiles('scripts').filter((f) => /tulsi\s+bridal/i.test(read(f)));
    assert.deepEqual(hits, []);
    assert.match(read('scripts/migrations/001-create-platform-vendor.mjs'), /name: 'Tulsi Fashion Jewellery'/);
  });

  test('no storefront file says bridal, bride or wedding (the data field weddingDate and the "tulsi-bridal/…" Cloudinary folders are not wording)', () => {
    const word = /(?<![\w/-])(bridal|brides?|weddings?)(?![\w/-])/i;
    const hits = [];
    for (const [f, text] of code) {
      if (NOT_STOREFRONT.test(f)) continue;
      const m = word.exec(text.replaceAll('tulsibridaljewellery@gmail.com', ''));
      if (m) hits.push(`${f}: …${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ')}…`);
    }
    assert.deepEqual(hits, []);
  });

  test('no storefront file links to /rentals, /rental-booking or /rental-success, or filters on ?rental=', () => {
    const link = /(?<!admin)\/rentals?\b|\/rental-(booking|success)\b|[?&]rental=|['"`]rental['"`]\s*,\s*['"`](true|false)/;
    const hits = [];
    for (const [f, text] of code) {
      if (NOT_STOREFRONT.test(f) || RENTAL_SERVER.has(f)) continue;
      const m = link.exec(text);
      if (m) hits.push(`${f}: ${m[0]}`);
    }
    assert.deepEqual(hits, []);
  });

  test('no storefront file reads a product’s rental fields or says "Rent" / "Book Rental"', () => {
    const rental = /isAvailableForRent|rentalPrice|rentalStock|rentalDays|Book Rental|Rent Jewellery|Available to Rent|Rent for your function/;
    const hits = [];
    for (const [f, text] of code) {
      if (NOT_STOREFRONT.test(f) || RENTAL_SERVER.has(f)) continue;
      const m = rental.exec(text);
      if (m) hits.push(`${f}: ${m[0]}`);
    }
    assert.deepEqual(hits, []);
  });

  test('the rental server code the sweep leaves alone is still there: the API routes and the admin screen', () => {
    for (const f of ['src/app/api/rentals/route.js', 'src/app/api/rentals/[id]/route.js', 'src/app/admin/rentals/page.js']) assert.ok(code.has(f), f);
    assert.match(read('src/app/admin/layout.js'), /href: '\/admin\/rentals'/);
  });
});
