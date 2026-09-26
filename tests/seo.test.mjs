/* SEO / GEO: structured data, crawler access and FAQ content. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoreJsonLd, buildProductJsonLd, buildWebSiteJsonLd, describeProduct, productKeywords, SITE_URL,
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
  assert.equal(bare.telephone, '+917695868787');
  assert.equal(bare.priceRange, '₹₹');
  assert.ok(!bare.geo && !bare.address, 'nothing guessed');
  const full = buildStoreJsonLd({ legalName: 'Tulsi Bridal Jewellery Pvt Ltd', geoLat: '8.2447', geoLng: '77.304', addressLocality: 'Thuckalay', postalCode: '629175', priceRange: '₹500 – ₹25,000' });
  assert.deepEqual(full.geo, { '@type': 'GeoCoordinates', latitude: 8.2447, longitude: 77.304 });
  assert.equal(full.address.addressCountry, 'IN');
  assert.equal(full.legalName, 'Tulsi Bridal Jewellery Pvt Ltd');
  assert.equal(buildWebSiteJsonLd().potentialAction.target.urlTemplate, `${SITE_URL}/shop?search={search_term_string}`);
});

test('Product: image array, brand, SKU, INR offer with availability; rental offer; live shipping; return policy', () => {
  const ld = buildProductJsonLd(PRODUCT, 'p1', { charges: DEFAULT_CHARGES, reviews: [] });
  assert.equal(ld.image.length, 2);
  assert.equal(ld.brand.name, 'Tulsi Bridal Jewellery');
  assert.equal(ld.sku, 'TL-001');
  const [buy, rent] = ld.offers;
  assert.deepEqual([buy.priceCurrency, buy.price, buy.availability], ['INR', '3999', 'https://schema.org/InStock']);
  assert.equal(buy.shippingDetails.shippingRate.value, '0', '₹3,999 ≥ free-shipping threshold');
  assert.equal(buy.hasMerchantReturnPolicy.merchantReturnDays, 7);
  assert.equal(rent.businessFunction, 'http://purl.org/goodrelations/v1#LeaseOut');
  assert.equal(rent.priceSpecification.unitCode, 'DAY');
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
  assert.match(d, /rent/i);
  assert.ok(!/matte|antique|kundan/.test(d), 'no claims the listing doesn’t make');
  assert.ok(productKeywords(PRODUCT).includes('bridal jewellery rental'));
});

test('robots: search and AI crawlers named and allowed on product pages; private areas closed', () => {
  const r = robots();
  const named = r.rules[0];
  for (const bot of ['Googlebot', 'Bingbot', 'PerplexityBot', 'GPTBot', 'ClaudeBot', 'OAI-SearchBot']) assert.ok(named.userAgent.includes(bot), bot);
  assert.ok(named.allow.includes('/product/'));
  for (const p of ['/admin', '/vendor', '/checkout', '/api/']) assert.ok(named.disallow.includes(p), p);
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
