/* SEO / GEO: structured data, crawler access and FAQ content. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoreJsonLd, buildProductJsonLd, buildWebSiteJsonLd, describeProduct, productKeywords, SITE_URL, SITE_NAME,
} from '../src/lib/seoSchema.js';
import { buildFaqs, buildFaqJsonLd } from '../src/lib/faq.js';
import { DEFAULT_CHARGES } from '../src/lib/storeCharges.js';
import robots from '../src/app/robots.js';

const PRODUCT = {
  name: 'Temple Lakshmi Choker Set', category: 'set', material: 'gold-plated', color: 'Red', occasion: 'Wedding',
  price: 4999, discountPrice: 3999, stock: 3, sku: 'TL-001', images: ['https://res.cloudinary.com/x/a.jpg', 'https://res.cloudinary.com/x/b.jpg'],
  isAvailableForRent: true, rentalPrice: 499, rentalStock: 1, weight: '85',
};

test('JewelryStore: identity and contact; geo and address only when the admin entered them', () => {
  const bare = buildStoreJsonLd({ phone: '7695868787' });
  assert.deepEqual(bare['@type'], ['JewelryStore', 'Store']);
  assert.equal(SITE_NAME, 'Tulsi Fashion Jewellery');
  assert.equal(bare.name, 'Tulsi Fashion Jewellery');
  assert.equal(bare.legalName, 'Tulsi Fashion Jewellery');
  assert.deepEqual(bare.alternateName, ['Tulsi Jewels', 'Tulsi Fashion']);
  assert.ok(['Fashion jewellery', 'Trending chains', 'Necklaces', 'Earrings', 'Anklets'].every((t) => bare.knowsAbout.includes(t)), 'what the store knows about');
  assert.doesNotMatch(JSON.stringify(bare), /bridal|bride|wedding|\brent(al)?\b/i, 'nothing bridal or rental in the store identity');
  assert.equal(bare.telephone, '+917695868787');
  assert.equal(bare.priceRange, '₹₹');
  assert.ok(!bare.geo && !bare.address, 'nothing guessed');
  const full = buildStoreJsonLd({ legalName: 'Tulsi Fashion Jewellery Pvt Ltd', geoLat: '8.2447', geoLng: '77.304', addressLocality: 'Thuckalay', postalCode: '629175', priceRange: '₹500 – ₹25,000' });
  assert.deepEqual(full.geo, { '@type': 'GeoCoordinates', latitude: 8.2447, longitude: 77.304 });
  assert.equal(full.address.addressCountry, 'IN');
  assert.equal(full.legalName, 'Tulsi Fashion Jewellery Pvt Ltd');
  assert.equal(buildWebSiteJsonLd().potentialAction.target.urlTemplate, `${SITE_URL}/shop?search={search_term_string}`);
});

test('Product: image array, brand, SKU, INR offer with availability; live shipping; return policy; never a rental offer', () => {
  const ld = buildProductJsonLd(PRODUCT, 'p1', { charges: DEFAULT_CHARGES, reviews: [] });
  assert.equal(ld.image.length, 2);
  assert.equal(ld.brand.name, 'Tulsi Fashion Jewellery');
  assert.equal(ld.sku, 'TL-001');
  /* PRODUCT still carries the old rental fields (stored data): they must not become an offer. */
  const buy = ld.offers;
  assert.ok(!Array.isArray(buy), 'one offer: the sale');
  assert.deepEqual([buy.priceCurrency, buy.price, buy.availability], ['INR', '3999', 'https://schema.org/InStock']);
  assert.equal(buy.shippingDetails.shippingRate.value, '0', '₹3,999 ≥ free-shipping threshold');
  assert.equal(buy.hasMerchantReturnPolicy.merchantReturnDays, 7);
  assert.doesNotMatch(JSON.stringify(ld), /LeaseOut|rental-booking|UnitPriceSpecification|Rent for your function/, 'no rental offer, link or day-rate');
  assert.ok(!ld.aggregateRating && !ld.review, 'no rating markup without real reviews');

  const rated = buildProductJsonLd({ ...PRODUCT, ratings: { average: 4.8, count: 12 } }, 'p1', { reviews: [{ rating: 5, comment: 'Beautiful set', reviewerName: 'Priya Raman' }] });
  assert.equal(rated.aggregateRating.reviewCount, '12');
  assert.equal(rated.review[0].author.name, 'Priya', 'first name only');
});

test('semantic description uses only the product’s own facts', () => {
  const d = describeProduct(PRODUCT);
  assert.match(d, /temple/);
  assert.match(d, /choker/);
  assert.match(d, /gold-plated/);
  assert.match(d, /by Tulsi Fashion Jewellery/);
  assert.doesNotMatch(d, /rent|bridal|buy or/i, 'a rentable product is described as an ordinary sale piece');
  assert.ok(!/matte|antique|kundan/.test(d), 'no claims the listing doesn’t make');
  const keywords = productKeywords(PRODUCT);
  assert.ok(keywords.includes('fashion jewellery') && keywords.includes('fashion jewellery online India'));
  assert.ok(!keywords.some((k) => /bridal|wedding|rent/i.test(k)), keywords.join(', '));
  assert.equal(describeProduct({ name: 'Plain piece', category: 'other' }), 'Plain piece — jewellery by Tulsi Fashion Jewellery. Delivered across India.');
  assert.match(describeProduct({ name: 'x', category: 'necklace', tags: ['layered'] }), /layered necklace/);
});

test('robots: search and AI crawlers named and allowed on product pages; private areas closed', () => {
  const r = robots();
  const named = r.rules[0];
  for (const bot of ['Googlebot', 'Bingbot', 'PerplexityBot', 'GPTBot', 'ClaudeBot', 'OAI-SearchBot']) assert.ok(named.userAgent.includes(bot), bot);
  assert.ok(named.allow.includes('/product/'));
  for (const p of ['/admin', '/vendor', '/checkout', '/api/']) assert.ok(named.disallow.includes(p), p);
  /* The retired rental URLs 301 to the shop: a crawler that robots.txt shuts out would never see the redirect. */
  for (const p of ['/rentals', '/rental-booking', '/rental-success']) assert.ok(!named.allow.includes(p) && !named.disallow.includes(p) && !r.rules[1].disallow.includes(p), p);
  assert.equal(r.sitemap, `${SITE_URL}/sitemap.xml`);
});

test('FAQ covers shipping, returns, materials and COD — and follows the live settings', () => {
  const faqs = buildFaqs({ charges: { ...DEFAULT_CHARGES, cod_fee_amount: 60, cod_fee_waive_above: null } });
  const text = faqs.map((f) => `${f.q} ${f.a}`).join(' ');
  for (const topic of [/2–4 business days/, /7 days of delivery/, /kundan/, /Cash on Delivery/]) assert.match(text, topic);
  assert.match(text, /₹60 COD handling fee applies\./);
  const ld = buildFaqJsonLd(faqs);
  assert.equal(ld['@type'], 'FAQPage');
  assert.equal(ld.mainEntity[0]['@type'], 'Question');
  assert.ok(ld.mainEntity.every((q) => q.acceptedAnswer.text.length > 20));
});

test('FAQ: nothing about renting or brides; "what do you sell" names the fashion range', () => {
  const faqs = buildFaqs({ charges: DEFAULT_CHARGES });
  assert.ok(!faqs.some((f) => f.group === 'Rentals'));
  /* The shop's mailbox is tulsibridaljewellery@gmail.com (a real address — not renamed). */
  assert.doesNotMatch(JSON.stringify(faqs).replaceAll('tulsibridaljewellery@gmail.com', ''), /\brent(al|ed|ing)?\b|bridal|bride|wedding|security deposit/i);
  const sells = faqs.find((f) => f.q === 'What kind of jewellery do you sell?');
  assert.match(sells.a, /fashion jewellery/);
  for (const piece of ['chains', 'necklaces', 'earrings', 'anklets']) assert.match(sells.a, new RegExp(piece));
  assert.equal(faqs.at(-1).q, 'How can I contact Tulsi Fashion Jewellery?');
  assert.match(faqs.at(-1).a, /tulsibridaljewellery@gmail\.com/, 'the mailbox address is not renamed');
});
