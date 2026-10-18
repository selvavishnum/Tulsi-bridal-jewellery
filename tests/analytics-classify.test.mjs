/* ─────────────────────────────────────────────
   Visitor analytics — the pure helpers: bot filter, UA parsing, traffic
   channel classification, geo headers, IP masking, bounded route keys
   (src/lib/analytics/classify.js) and the batch contract between the
   browser tracker and the ingestion endpoint (src/lib/analytics/events.js).

   Run: npm test
   ───────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS, DEVICES, OSES, BROWSERS, isBotLike, parseUserAgent, classifySource, sanitizeUtm, referrerHost,
  geoFromHeaders, regionLabel, maskIp, cleanPath, routeKey, encodeKey, decodeKey, isProductId,
} from '@/lib/analytics/classify';
import { parseBatch, cartTotals, EVENT_TYPES, MAX_EVENTS, MAX_BODY_BYTES } from '@/lib/analytics/events';

/* Real-world User-Agent strings. */
const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 Instagram 309.1.0.41.113 Android (33/13; 450dpi; 1080x2177; samsung; SM-A536E; a53x; s5e8825; en_IN; 541635890)',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  facebookIab: 'Mozilla/5.0 (Linux; Android 13; RMX3630 Build/TP1A.220905.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/441.0.0.33.113;]',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  googlebotSmartphone: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.71 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  playwright: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.28 Safari/537.36 Playwright/1.40.0',
  facebookPreview: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  whatsappPreview: 'WhatsApp/2.23.20.0 A',
  curl: 'curl/7.88.1',
};
const LANG = 'en-IN,en;q=0.9,ta;q=0.8';

/* ── isBotLike ── */

test('isBotLike: crawlers, headless browsers, link previews and HTTP libraries are bots', () => {
  for (const [name, ua] of Object.entries({
    curl: UA.curl, googlebot: UA.googlebot, googlebotSmartphone: UA.googlebotSmartphone, headless: UA.headless,
    playwright: UA.playwright, whatsappPreview: UA.whatsappPreview, facebookPreview: UA.facebookPreview,
    pythonRequests: 'python-requests/2.31.0', axios: 'axios/1.6.2', wget: 'Wget/1.21.4',
    gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)',
    lighthouse: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  })) {
    assert.equal(isBotLike({ ua, acceptLanguage: LANG }), true, name);
  }
});

test('isBotLike: a real phone browser with Accept-Language is a person; without it, a bot', () => {
  assert.equal(isBotLike({ ua: UA.chromeAndroid, acceptLanguage: LANG }), false);
  assert.equal(isBotLike({ ua: UA.chromeAndroid, acceptLanguage: '' }), true, 'no Accept-Language');
  assert.equal(isBotLike({ ua: UA.chromeAndroid, acceptLanguage: null }), true, 'no Accept-Language header at all');
  assert.equal(isBotLike({ ua: '', acceptLanguage: LANG }), true, 'no User-Agent');
  assert.equal(isBotLike({ ua: undefined, acceptLanguage: LANG }), true);
  for (const ua of [UA.instagramAndroid, UA.iphoneSafari, UA.samsung, UA.edgeWindows, UA.facebookIab, UA.ipadDesktopMode]) {
    assert.equal(isBotLike({ ua, acceptLanguage: LANG }), false, ua);
  }
});

/* ── parseUserAgent ── */

test('parseUserAgent: in-app browsers, iPhone, iPad desktop mode, Samsung, Edge', () => {
  assert.deepEqual(parseUserAgent(UA.instagramAndroid), { device: 'mobile', os: 'android', browser: 'instagram' });
  assert.deepEqual(parseUserAgent(UA.iphoneSafari), { device: 'mobile', os: 'ios', browser: 'safari' });
  assert.deepEqual(parseUserAgent(UA.ipadDesktopMode), { device: 'tablet', os: 'ios', browser: 'safari' }, 'iPadOS desktop mode says Macintosh but keeps Mobile/');
  assert.deepEqual(parseUserAgent(UA.samsung), { device: 'mobile', os: 'android', browser: 'samsung' });
  assert.deepEqual(parseUserAgent(UA.edgeWindows), { device: 'desktop', os: 'windows', browser: 'edge' });
  assert.deepEqual(parseUserAgent(UA.facebookIab), { device: 'mobile', os: 'android', browser: 'facebook' });
  assert.deepEqual(parseUserAgent(UA.androidTablet), { device: 'tablet', os: 'android', browser: 'chrome' }, 'Android without "Mobile" is a tablet');
  assert.deepEqual(parseUserAgent(UA.macSafari), { device: 'desktop', os: 'macos', browser: 'safari' });
  assert.deepEqual(parseUserAgent(UA.firefoxLinux), { device: 'desktop', os: 'linux', browser: 'firefox' });
  assert.deepEqual(parseUserAgent(UA.chromeOs), { device: 'desktop', os: 'chromeos', browser: 'chrome' });
  assert.deepEqual(parseUserAgent(''), { device: 'desktop', os: 'other', browser: 'other' });
  assert.deepEqual(parseUserAgent(), { device: 'desktop', os: 'other', browser: 'other' });
});

test('parseUserAgent: every label is from the fixed lists (rollup keys stay bounded)', () => {
  for (const ua of [...Object.values(UA), 'x'.repeat(5000), '<script>', 'Mozilla/5.0 (Evil; .;/) Foo/1']) {
    const r = parseUserAgent(ua);
    assert.ok(DEVICES.includes(r.device), r.device);
    assert.ok(OSES.includes(r.os), r.os);
    assert.ok(BROWSERS.includes(r.browser), r.browser);
  }
});

/* ── classifySource ── */

const SITE = 'www.tulsi.test:3000';
const src = (input) => classifySource({ ua: UA.chromeAndroid, siteHost: SITE, ...input });

test('classifySource: UTM tags win, with source aliases', () => {
  const ig = src({ utm: { source: 'ig', medium: 'story', campaign: 'Diwali Sale' } });
  assert.equal(ig.channel, 'instagram');
  assert.equal(ig.source, 'instagram');
  assert.equal(ig.medium, 'story');
  assert.equal(ig.campaign, 'diwali_sale', 'campaign lower-cased, spaces → _');
  assert.equal(src({ utm: { source: 'google', medium: 'cpc' } }).channel, 'google_ads');
  assert.equal(src({ utm: { source: 'google', medium: 'paid_search' } }).channel, 'google_ads');
  assert.equal(src({ utm: { source: 'google', medium: 'organic' } }).channel, 'google_organic');
  assert.equal(src({ utm: { source: 'google' }, clickIds: { gclid: true } }).channel, 'google_ads', 'utm google + gclid is paid');
  assert.equal(src({ utm: { source: 'fb' } }).channel, 'facebook');
  assert.equal(src({ utm: { source: 'whatsapp', medium: 'broadcast' } }).channel, 'whatsapp');
  assert.equal(src({ utm: { source: 'yt' } }).channel, 'youtube');
  assert.equal(src({ utm: { source: 'newsletter' } }).channel, 'email');
  assert.equal(src({ utm: { source: 'mailchimp', medium: 'email' } }).channel, 'email');
  assert.equal(src({ utm: { source: 'pinterest', medium: 'social' } }).channel, 'social_other');
  const partner = src({ utm: { source: 'WeddingBazaar' } });
  assert.deepEqual([partner.channel, partner.source, partner.medium], ['referral', 'weddingbazaar', 'referral']);
  /* UTM beats the referrer and the in-app browser. */
  assert.equal(src({ utm: { source: 'ig' }, referrer: 'https://www.google.com/' }).channel, 'instagram');
  assert.equal(classifySource({ ua: UA.facebookIab, utm: { source: 'google', medium: 'cpc' } }).channel, 'google_ads');
});

test('classifySource: ad click ids without UTM', () => {
  const g = src({ clickIds: { gclid: true } });
  assert.deepEqual([g.channel, g.source, g.medium], ['google_ads', 'google', 'cpc']);
  const f = src({ clickIds: { fbclid: true } });
  assert.deepEqual([f.channel, f.source], ['facebook', 'facebook']);
  assert.equal(src({ clickIds: { fbclid: true }, referrer: 'https://l.instagram.com/' }).channel, 'instagram', 'Instagram links carry fbclid too');
});

test('classifySource: in-app browsers with no referrer', () => {
  assert.equal(classifySource({ ua: UA.instagramAndroid }).channel, 'instagram');
  assert.equal(classifySource({ ua: UA.facebookIab }).channel, 'facebook');
});

test('classifySource: referrers', () => {
  const g = src({ referrer: 'https://www.google.co.in/' });
  assert.deepEqual([g.channel, g.source, g.medium, g.refHost], ['google_organic', 'google', 'organic', 'google.co.in']);
  assert.equal(src({ referrer: 'https://www.google.com/search?q=bridal+sets' }).channel, 'google_organic');
  const own = src({ referrer: 'https://www.tulsi.test:3000/shop/necklaces?sort=new' });
  assert.deepEqual([own.channel, own.refHost], ['direct', ''], 'own domain (www + port) is not a source');
  assert.equal(src({ referrer: 'https://shop.tulsi.test/x' }).channel, 'direct', 'own sub-domain');
  const pay = src({ referrer: 'https://api.razorpay.com/v1/checkout/embedded' });
  assert.deepEqual([pay.channel, pay.refHost], ['direct', ''], 'payment gateway return is not a source');
  assert.equal(src({ referrer: 'https://wa.me/919876543210' }).channel, 'whatsapp');
  assert.equal(src({ referrer: 'https://web.whatsapp.com/' }).channel, 'whatsapp');
  assert.equal(src({ referrer: 'https://l.facebook.com/l.php?u=x' }).channel, 'facebook');
  const bing = src({ referrer: 'https://www.bing.com/search?q=temple+jewellery' });
  assert.deepEqual([bing.channel, bing.source, bing.medium], ['other_search', 'bing', 'organic']);
  assert.equal(src({ referrer: 'https://duckduckgo.com/' }).channel, 'other_search');
  assert.equal(src({ referrer: 'https://m.youtube.com/watch?v=abc' }).channel, 'youtube');
  assert.equal(src({ referrer: 'https://t.co/xyz' }).channel, 'social_other');
  assert.equal(src({ referrer: 'https://in.pinterest.com/pin/1' }).channel, 'social_other');
  assert.equal(src({ referrer: '' }).channel, 'direct');
  assert.equal(src({ referrer: 'not a url' }).channel, 'direct');
  assert.equal(src({ referrer: 'javascript:alert(1)' }).channel, 'direct', 'non-http referrer ignored');
});

test('classifySource: webmail referrers are Email, not organic search', () => {
  assert.equal(src({ referrer: 'https://mail.google.com/' }).channel, 'email');
  assert.equal(src({ referrer: 'https://mail.yahoo.com/d/folders/1' }).channel, 'email');
});

test('classifySource: an unknown site is a referral, keeping the host only (never path or query)', () => {
  const r = src({ referrer: 'https://www.myweddingblog.in/2026/10/best-temple-jewellery?email=priya@example.com&token=secret#top' });
  assert.equal(r.channel, 'referral');
  assert.equal(r.refHost, 'myweddingblog.in');
  assert.equal(r.source, 'myweddingblog.in');
  const all = JSON.stringify(r);
  for (const leak of ['priya', 'secret', '2026/10', 'best-temple']) assert.ok(!all.includes(leak), `leaked ${leak}`);
});

test('classifySource: crafted UTM values are sanitised and the channel is always a known one', () => {
  const crafted = [
    { utm: { source: '<script>alert(1)</script>', medium: 'x.y/z', campaign: '=HYPERLINK("http://evil")' } },
    { utm: { source: 'a.b.c', campaign: 'x'.repeat(500) } },
    { utm: { source: '$$$' }, referrer: 'https://evil.example/' },
    { utm: { source: '   ' } },
    { referrer: 'https://' + 'a'.repeat(300) + '.com/' },
  ];
  for (const input of crafted) {
    const r = src(input);
    assert.ok(Object.hasOwn(CHANNELS, r.channel), r.channel);
    assert.ok(r.campaign.length <= 80);
    assert.ok(r.source.length <= 100);
    assert.ok(!/[<>"=()/]/.test(r.source + r.medium + r.campaign), JSON.stringify(r));
  }
  assert.equal(src({ utm: { source: '$$$' }, referrer: 'https://evil.example/' }).channel, 'referral', 'empty after sanitising → falls through to the referrer');
  assert.deepEqual(sanitizeUtm({ source: ' Insta Gram ', medium: 'CPC', campaign: null }), { source: 'insta_gram', medium: 'cpc', campaign: '', content: '', term: '' });
  assert.equal(referrerHost('https://WWW.Example.COM:8443/a'), 'example.com');
  assert.equal(referrerHost(42), '');
});

/* ── geoFromHeaders ── */

const headers = (h) => (name) => h[name] ?? null;

test('geoFromHeaders: Vercel headers for an Indian visitor', () => {
  assert.deepEqual(
    geoFromHeaders(headers({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'TN', 'x-vercel-ip-city': 'Madurai' })),
    { country: 'IN', regionCode: 'TN', region: 'Tamil Nadu', city: 'Madurai', regionKey: 'IN-TN' },
  );
  const tg = geoFromHeaders(headers({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'TS', 'x-vercel-ip-city': 'Hyderabad' }));
  assert.equal(tg.regionKey, 'IN-TG', 'old Telangana code TS normalised to TG');
  assert.equal(tg.region, 'Telangana');
  assert.equal(geoFromHeaders(headers({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'OD' })).regionKey, 'IN-OR');
  assert.equal(geoFromHeaders(headers({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'CG' })).regionKey, 'IN-CT');
  assert.equal(geoFromHeaders(headers({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'UK' })).regionKey, 'IN-UT');
  assert.equal(geoFromHeaders(headers({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'ZZ' })).regionKey, 'IN-other');
  assert.equal(geoFromHeaders(headers({ 'x-vercel-ip-country': 'in', 'x-vercel-ip-country-region': 'ka' })).regionKey, 'IN-KA', 'case-insensitive');
});

test('geoFromHeaders: Cloudflare, nothing, hostile and URL-encoded values', () => {
  const us = geoFromHeaders(headers({ 'cf-ipcountry': 'US', 'cf-region-code': 'CA', 'cf-region': 'California', 'cf-ipcity': 'San Jose' }));
  assert.deepEqual(us, { country: 'US', regionCode: 'CA', region: 'California', city: 'San Jose', regionKey: 'US' });
  assert.deepEqual(geoFromHeaders(headers({})), { country: '', regionCode: '', region: '', city: '', regionKey: 'unknown' });
  const evil = geoFromHeaders(headers({ 'x-vercel-ip-country': 'IN"><', 'x-vercel-ip-country-region': 'TN', 'x-vercel-ip-city': 'Chen<script>alert(1)</script>nai' }));
  assert.equal(evil.country, 'IN');
  assert.ok(!/[<>/]/.test(evil.city), evil.city);
  assert.ok(evil.city.length <= 60);
  assert.equal(geoFromHeaders(headers({ 'x-vercel-ip-country': 'BR', 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' })).city, 'São Paulo', 'Vercel URL-encodes the city');
  assert.equal(geoFromHeaders(headers({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-city': 'Tiruchirappalli%' })).city, 'Tiruchirappalli', 'bad escape: raw value, still cleaned');
  assert.equal(geoFromHeaders(headers({ 'x-vercel-ip-country': 'USA-evil' })).regionKey, 'US', 'country is at most two letters');
});

test('regionLabel: readable names for rollup keys', () => {
  assert.equal(regionLabel('IN-TN'), 'Tamil Nadu');
  assert.equal(regionLabel('IN-TG'), 'Telangana');
  assert.equal(regionLabel('IN-other'), 'India (other)');
  assert.equal(regionLabel('unknown'), 'Unknown');
  assert.equal(regionLabel(''), 'Unknown');
  assert.equal(regionLabel('US'), 'United States');
  assert.equal(regionLabel('T'), 'T', 'invalid code → the key itself, no throw');
});

/* ── maskIp ── */

test('maskIp: IPv4 and IPv6 keep only the network part; garbage → empty', () => {
  assert.equal(maskIp('49.37.12.34'), '49.37.x.x');
  assert.equal(maskIp('49.37.12.34, 10.0.0.1, 172.16.0.1'), '49.37.x.x', 'first x-forwarded-for hop');
  assert.equal(maskIp(' 103.21.244.7 '), '103.21.x.x');
  assert.equal(maskIp('2401:4900:1c3a:abcd:1234:5678:9abc:def0'), '2401:4900:1c3a::x');
  assert.equal(maskIp('unknown'), '');
  assert.equal(maskIp(''), '');
  assert.equal(maskIp(null), '');
  assert.equal(maskIp('999.1.1'), '');
  assert.equal(maskIp('<script>'), '');
});

test('maskIp: compressed and IPv4-mapped IPv6 never reveal the host part', () => {
  /* '::' hides zero groups: the interface id must not slide into the prefix. */
  const short = maskIp('2401:4900::abcd:1234');
  assert.ok(!short.includes('abcd') && !short.includes('1234'), short);
  assert.ok(short.startsWith('2401:4900'), short);
  /* A dual-stack proxy may report an IPv4 client as ::ffff:a.b.c.d. */
  assert.equal(maskIp('::ffff:49.37.12.34'), '49.37.x.x');
  assert.equal(maskIp('::FFFF:49.37.12.34'), '49.37.x.x');
  assert.equal(maskIp('::1'), '::x');
});

/* ── Paths and route keys ── */

test('cleanPath: only a visible same-site path survives', () => {
  assert.equal(cleanPath('/shop/necklaces?sort=new#top'), '/shop/necklaces');
  assert.equal(cleanPath('/product/abc123'), '/product/abc123');
  assert.equal(cleanPath('//evil.example/x'), '/evil.example/x', 'protocol-relative collapsed to a path');
  assert.equal(cleanPath('/' + 'a'.repeat(400)).length, 200);
  for (const bad of ['https://evil.example/x', 'javascript:alert(1)', 'shop', '', null, undefined, 42, {}, ['/'], '/<script>', '/a b', '/a"b', "/a'b"]) {
    assert.equal(cleanPath(bad), '', String(bad));
  }
});

test('routeKey: page paths map to a small fixed set', () => {
  assert.equal(routeKey('/'), '/');
  assert.equal(routeKey('/product/abc123'), '/product/[id]');
  assert.equal(routeKey('/product/abc123?ref=x'), '/product/[id]');
  assert.equal(routeKey('/shop'), '/shop');
  assert.equal(routeKey('/shop/necklaces'), '/shop/[category]');
  assert.equal(routeKey('/cart'), '/cart');
  assert.equal(routeKey('/order-success'), '/order-success');
  assert.equal(routeKey('/a.b/c'), '(other)');
  assert.equal(routeKey('/admin/analytics'), '(other)');
  assert.equal(routeKey('/random-' + Math.random()), '(other)');
  assert.equal(routeKey('https://evil.example/'), '(other)');
  assert.equal(routeKey(''), '(other)');
});

test('encodeKey/decodeKey: round trip, and stored keys never contain "." or "/"', () => {
  const keys = ['/', '/product/[id]', '/shop/[category]', '/shop', '/order-success', '/track-order', '(other)', '/rental-booking'];
  for (const k of keys) {
    const enc = encodeKey(k);
    assert.ok(!enc.includes('/') && !enc.includes('.'), enc);
    assert.equal(decodeKey(enc), k);
  }
  for (const p of ['/a.b/c', '/x/y/z', '/product/1.2.3', '/../../etc/passwd', '/%2e%2e/']) {
    const enc = encodeKey(routeKey(p));
    assert.ok(!enc.includes('/') && !enc.includes('.'), enc);
  }
  assert.ok(!encodeKey('a.b/c.d').includes('.'));
  assert.equal(isProductId('abc_DEF-123'), true);
  assert.equal(isProductId('a/b'), false);
  assert.equal(isProductId('a'.repeat(65)), false);
  assert.equal(isProductId(123), false);
});

/* ── events.js: the batch contract ── */

const ev = (type, seq, extra = {}) => ({ type, seq, ...extra });

test('parseBatch: keeps valid events and drops invalid ones', () => {
  const r = parseBatch({
    tab: 'k3j9x2', n: 4,
    events: [
      ev('page_view', 0, { path: '/shop' }),
      ev('teleport', 1),
      { seq: 2 },
      ev('product_view', 3, { productId: 'bad id!' }),
      ev('heartbeat', 4, { active: 15 }),
      ev('heartbeat', 5, { active: 99999 }),
      ev('tryon_mode', 6, { mode: 'ai' }),
      ev('tryon_mode', 7, { mode: 'hologram' }),
      ev('tryon_tone', 8, { tone: 'dusky' }),
      ev('add_to_cart', 9, { productId: 'p1', qty: 2 }),
      ev('add_to_cart', 10, { productId: 'p1', qty: 0 }),
      ev('page_view', -1),
      ev('page_view', 1.5),
      'not an object',
      null,
    ],
  });
  assert.ok(r.batch, r.error);
  assert.deepEqual(r.batch.events.map((e) => e.seq), [0, 4, 6, 8, 9]);
  assert.equal(r.batch.tab, 'k3j9x2');
  assert.equal(r.batch.n, 4);
  assert.equal(r.batch.cart, null);
});

test('parseBatch: rejects bad batch shapes', () => {
  const ok = { tab: 'abcd12', n: 0, events: [ev('page_view', 0)] };
  assert.ok(parseBatch(ok).batch);
  assert.deepEqual(parseBatch({ ...ok, events: Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ev('heartbeat', i, { active: 1 })) }), { error: 'invalid batch' });
  assert.ok(parseBatch({ ...ok, events: Array.from({ length: MAX_EVENTS }, (_, i) => ev('heartbeat', i, { active: 1 })) }).batch, 'exactly 30 is fine');
  for (const tab of ['ABCD', 'ab', 'a'.repeat(17), 'ab-cd', '', undefined, 42]) {
    assert.deepEqual(parseBatch({ ...ok, tab }), { error: 'invalid batch' }, `tab ${tab}`);
  }
  const { n, ...noN } = ok; void n;
  assert.deepEqual(parseBatch(noN), { error: 'invalid batch' }, 'missing n');
  assert.deepEqual(parseBatch({ ...ok, n: -1 }), { error: 'invalid batch' });
  assert.deepEqual(parseBatch({ ...ok, n: '1' }), { error: 'invalid batch' });
  assert.deepEqual(parseBatch({ ...ok, events: [] }), { error: 'invalid batch' });
  assert.deepEqual(parseBatch({ ...ok, events: 'page_view' }), { error: 'invalid batch' });
  assert.deepEqual(parseBatch({ ...ok, events: [ev('nope', 0)] }), { error: 'no valid events' });
  for (const bad of [null, undefined, 'x', 42, [], [ok]]) assert.ok(parseBatch(bad).error, String(bad));
});

test('parseBatch: unknown fields are stripped at every level', () => {
  const r = parseBatch({
    tab: 'abcd12', n: 1, admin: true,
    cart: { items: [{ id: 'p1', name: 'Jhumka', qty: 1, price: 10, cost: 5 }], owner: 'x' },
    events: [ev('page_view', 0, {
      path: '/', userId: 'u-admin', vid: 'tj_vid_forged', role: 'admin',
      utm: { source: 'ig', evil: '1' }, clickIds: { gclid: true, other: true },
    })],
  });
  assert.deepEqual(Object.keys(r.batch).sort(), ['cart', 'events', 'final', 'n', 'tab']);
  assert.equal(r.batch.final, false, 'final only when the tracker says so');
  assert.deepEqual(r.batch.events[0], { type: 'page_view', seq: 0, path: '/', utm: { source: 'ig' }, clickIds: { gclid: true } });
  assert.deepEqual(r.batch.cart, { items: [{ id: 'p1', name: 'Jhumka', qty: 1, price: 10 }] });
});

test('parseBatch: cart item names lose < and >; a malformed item is dropped, the batch is kept', () => {
  const r = parseBatch({ tab: 'abcd12', n: 1, cart: { items: [{ id: 'p1', name: '<img src=x onerror=alert(1)>Kundan Set', qty: 2, price: 1500 }, { id: 'p2', qty: 1, price: 0 }] }, events: [ev('page_view', 0)] });
  assert.equal(r.batch.cart.items[0].name, 'img src=x onerror=alert(1)Kundan Set');
  assert.equal(r.batch.cart.items[1].name, '', 'missing name → empty string');
  const mixed = parseBatch({
    tab: 'abcd12', n: 1,
    cart: { items: [{ id: 'a/b', qty: 1, price: 1 }, { id: 'p1', qty: 100, price: 1 }, { id: 'p1', qty: 1, price: -1 }, { id: 'p3', qty: 1, price: 2_00_00_001 }, { id: 'ok1', qty: 1, price: 999 }] },
    events: [ev('page_view', 0)],
  });
  assert.equal(mixed.error, undefined, 'odd cart items never cost the events');
  assert.deepEqual(mixed.batch.cart.items.map((i) => i.id), ['ok1']);
  assert.equal(mixed.batch.events.length, 1);
  assert.ok(parseBatch({ tab: 'abcd12', n: 1, cart: { items: Array.from({ length: 31 }, () => ({ id: 'p1', qty: 1, price: 1 })) }, events: [ev('page_view', 0)] }).error, 'more than 30 items is still a bad batch');
});

test('parseBatch: orderNumber must look like a real order number', () => {
  const one = (orderNumber) => parseBatch({ tab: 'abcd12', n: 0, events: [ev('purchase', 0, { orderNumber })] });
  assert.equal(one('TBJ1760600000000123').batch.events[0].orderNumber, 'TBJ1760600000000123');
  assert.ok(one('TBJ1234567890').batch, '10 digits');
  for (const bad of ['TBJ123', 'TBJ-A', 'tbj1234567890', 'TBJ1234567890X', 'TBJ' + '1'.repeat(25), "TBJ1234567890' OR 1=1", 1234567890]) {
    assert.equal(one(bad).error, 'no valid events', String(bad));
  }
});

test('cartTotals: pieces and rupee value', () => {
  assert.equal(cartTotals(null), null);
  assert.deepEqual(cartTotals({ items: [] }), { items: 0, value: 0 });
  assert.deepEqual(cartTotals({ items: [{ qty: 2, price: 1499.995 }, { qty: 1, price: 0.1 }, { qty: 3, price: 0.2 }] }), { items: 6, value: 3000.69 });
});

test('events.js constants', () => {
  assert.equal(MAX_BODY_BYTES, 16 * 1024);
  assert.equal(MAX_EVENTS, 30);
  for (const t of ['page_view', 'heartbeat', 'product_view', 'product_engagement', 'tryon_open', 'tryon_mode', 'tryon_tone', 'add_to_cart', 'remove_from_cart', 'checkout_start', 'purchase']) {
    assert.ok(EVENT_TYPES.includes(t), t);
  }
});

test('classifySource: Android app referrers, whole-word UTM aliases, Google Ads sources', () => {
  const ch = (x) => classifySource({ siteHost: 'tulsijewels.in', ...x }).channel;
  assert.equal(ch({ referrer: 'android-app://com.whatsapp/' }), 'whatsapp');
  assert.equal(ch({ referrer: 'android-app://com.whatsapp.w4b/' }), 'whatsapp');
  assert.equal(ch({ referrer: 'android-app://com.instagram.android/' }), 'instagram');
  assert.equal(ch({ referrer: 'android-app://com.google.android.gm/' }), 'email', 'Gmail app is email, not Google search');
  assert.equal(ch({ referrer: 'android-app://com.google.android.googlequicksearchbox/' }), 'google_organic');
  const unknownApp = classifySource({ siteHost: 'tulsijewels.in', referrer: 'android-app://com.example.reader/' });
  assert.deepEqual([unknownApp.channel, unknownApp.source, unknownApp.medium], ['referral', 'com.example.reader', 'app']);

  assert.equal(ch({ utm: { source: 'walmart' } }), 'referral', '"wa" is a word, not a prefix');
  assert.equal(ch({ utm: { source: 'instagrammer' } }), 'referral');
  assert.equal(ch({ utm: { source: 'wa' } }), 'whatsapp');
  assert.equal(ch({ utm: { source: 'WhatsApp Status' } }), 'whatsapp');
  assert.equal(ch({ utm: { source: 'ig_story' } }), 'instagram');
  assert.equal(ch({ utm: { source: 'mailchimp' } }), 'email');

  assert.equal(ch({ utm: { source: 'google', medium: 'broadcast' } }), 'google_organic', '"broadcast" contains "ad" but is not paid');
  assert.equal(ch({ utm: { source: 'google', medium: 'cpc' } }), 'google_ads');
  assert.equal(ch({ utm: { source: 'google', medium: 'paid_search' } }), 'google_ads');
  assert.equal(ch({ utm: { source: 'google_ads' } }), 'google_ads');
  assert.equal(ch({ utm: { source: 'adwords' } }), 'google_ads');
  assert.equal(ch({ utm: { source: 'google' } }), 'google_organic');
});

test('isBotLike: Cubot phones are people; bots named "…bot" are still bots', () => {
  const lang = 'en-IN,en;q=0.9';
  assert.equal(isBotLike({ ua: 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', acceptLanguage: lang }), false);
  assert.equal(isBotLike({ ua: 'Mozilla/5.0 (Linux; Android 11; CUBOT_NOTE_20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36', acceptLanguage: lang }), false);
  for (const ua of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 (Linux; Android 7.0;) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
  ]) assert.equal(isBotLike({ ua, acceptLanguage: lang }), true, ua);
});
