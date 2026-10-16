/* ─────────────────────────────────────────────
   Visitor analytics — pure classification helpers.

   Turns what a request carries (User-Agent, referrer, UTM tags, ad click
   ids, Vercel/Cloudflare geo headers, IP) into a small, BOUNDED set of
   labels the dashboard can group by. Every label set here is a fixed
   list, so a crafted request can't explode the daily rollup documents
   with millions of distinct keys.

   Pure module — no '@/…' imports, no DB, safe in the browser and tests.
   ───────────────────────────────────────────── */

/* ── Traffic channels (fixed list — rollup map keys) ── */
export const CHANNELS = Object.freeze({
  direct: 'Direct',
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  google_organic: 'Google Organic',
  google_ads: 'Google Ads',
  youtube: 'YouTube',
  other_search: 'Other Search',
  social_other: 'Other Social',
  email: 'Email',
  referral: 'Referral',
});

export const DEVICES = Object.freeze(['mobile', 'tablet', 'desktop']);
export const OSES = Object.freeze(['android', 'ios', 'windows', 'macos', 'linux', 'chromeos', 'other']);
export const BROWSERS = Object.freeze(['instagram', 'facebook', 'whatsapp', 'samsung', 'edge', 'opera', 'firefox', 'chrome', 'safari', 'other']);

/* ── Bots ── Server-side backstop: the client tracker never fires for
   navigator.webdriver, but a direct POST or a crawler that runs JS would
   still reach the endpoint. */
const BOT_UA = /bot\b|bot\/|crawler|spider|slurp|googlebot|bingbot|yandex|baiduspider|duckduckbot|facebookexternalhit|meta-externalagent|twitterbot|linkedinbot|applebot|petalbot|semrush|ahrefs|mj12bot|dotbot|gptbot|claudebot|anthropic-ai|perplexitybot|ccbot|bytespider|headlesschrome|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|pingdom|uptimerobot|statuscake|curl\/|wget\/|python-requests|python-urllib|go-http-client|okhttp|axios\/|node-fetch|httpclient|java\//i;

/**
 * True for crawlers, link-preview fetchers, uptime monitors, headless
 * browsers and plain HTTP libraries. A real browser always sends a
 * User-Agent and an Accept-Language header with fetch/sendBeacon.
 */
export function isBotLike({ ua, acceptLanguage }) {
  if (!ua) return true;
  /* Every mainstream browser's UA starts "Mozilla/"; link-preview fetchers
     (WhatsApp, Telegram), curl and HTTP libraries don't. */
  if (!/^Mozilla\/\d/.test(ua)) return true;
  if (BOT_UA.test(ua)) return true;
  if (!acceptLanguage) return true;
  return false;
}

/* ── User agent → device / OS / browser ── */
export function parseUserAgent(ua = '') {
  const s = String(ua);
  const isIPad = /iPad/.test(s) || (/Macintosh/.test(s) && /Mobile\//.test(s));
  const isTablet = isIPad || /Tablet|PlayBook|Silk/i.test(s) || (/Android/.test(s) && !/Mobile/.test(s));
  const isMobile = !isTablet && /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(s);
  const device = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

  let os = 'other';
  if (/Android/i.test(s)) os = 'android';
  else if (/iPhone|iPad|iPod/i.test(s) || isIPad) os = 'ios';
  else if (/CrOS/.test(s)) os = 'chromeos';
  else if (/Windows/i.test(s)) os = 'windows';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macos';
  else if (/Linux/i.test(s)) os = 'linux';

  /* In-app browsers first: they also say "Chrome"/"Safari". */
  let browser = 'other';
  if (/Instagram/i.test(s)) browser = 'instagram';
  else if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(s)) browser = 'facebook';
  else if (/WhatsApp/i.test(s)) browser = 'whatsapp';
  else if (/SamsungBrowser/i.test(s)) browser = 'samsung';
  else if (/Edg(e|A|iOS)?\//.test(s)) browser = 'edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'opera';
  else if (/Firefox|FxiOS/i.test(s)) browser = 'firefox';
  else if (/Chrome|CriOS/i.test(s)) browser = 'chrome';
  else if (/Safari/i.test(s)) browser = 'safari';

  return { device, os, browser };
}

/* ── UTM / referrer → channel ── */
const clean = (v, max = 60) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9._\-+ ]/g, '').replace(/\s+/g, '_').slice(0, max);

export function sanitizeUtm(utm = {}) {
  return {
    source: clean(utm.source),
    medium: clean(utm.medium),
    campaign: clean(utm.campaign, 80),
    content: clean(utm.content, 80),
    term: clean(utm.term, 80),
  };
}

/** Host only (never the full URL: query strings can carry emails or tokens). */
export function referrerHost(referrer) {
  if (!referrer || typeof referrer !== 'string') return '';
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'android-app:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '').slice(0, 100);
  } catch {
    return '';
  }
}

const PAYMENT_HOSTS = /(^|\.)(razorpay\.com|rzp\.io|payu\.in|paytm\.com|phonepe\.com|cashfree\.com|ccavenue\.com)$/;

const SOURCE_ALIASES = [
  [/^(ig|insta|instagram)/, 'instagram'],
  [/^(fb|facebook|meta)/, 'facebook'],
  [/^(wa|whatsapp)/, 'whatsapp'],
  [/^(yt|youtube)/, 'youtube'],
  [/^(email|newsletter|mail)/, 'email'],
];

/**
 * Where this visit came from.
 * @param {{ utm?: object, referrer?: string, ua?: string, siteHost?: string, clickIds?: { gclid?: boolean, fbclid?: boolean } }} input
 * @returns {{ channel: string, source: string, medium: string, campaign: string, content: string, refHost: string }}
 */
export function classifySource({ utm = {}, referrer = '', ua = '', siteHost = '', clickIds = {} } = {}) {
  const u = sanitizeUtm(utm);
  const host = referrerHost(referrer);
  const site = String(siteHost || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  /* Our own pages and the payment gateway's return redirect are not a source. */
  const internal = host && ((site && (host === site || host.endsWith(`.${site}`))) || PAYMENT_HOSTS.test(host));
  const refHost = internal ? '' : host;
  const { browser } = parseUserAgent(ua);
  const out = (channel, source, medium) => ({ channel, source: source || channel, medium: medium || '', campaign: u.campaign, content: u.content, refHost });

  /* 1. Explicit UTM tags win. */
  if (u.source) {
    const alias = SOURCE_ALIASES.find(([re]) => re.test(u.source));
    const name = alias ? alias[1] : u.source;
    if (name === 'google') return out(/cpc|ppc|paid|ads?/.test(u.medium) || clickIds.gclid ? 'google_ads' : 'google_organic', 'google', u.medium);
    if (alias) return out(alias[1], alias[1], u.medium);
    if (/email/.test(u.medium)) return out('email', name, u.medium);
    if (/social/.test(u.medium)) return out('social_other', name, u.medium);
    return out('referral', name, u.medium || 'referral');
  }

  /* 2. Paid click ids. */
  if (clickIds.gclid) return out('google_ads', 'google', 'cpc');

  /* 3. In-app browsers: Instagram / Facebook / WhatsApp open links inside
     their own webview and often send no referrer at all. */
  if (browser === 'instagram' || /(^|\.)instagram\.com$/.test(host)) return out('instagram', 'instagram', 'social');
  if (browser === 'whatsapp' || /(^|\.)(whatsapp\.com|wa\.me)$/.test(host)) return out('whatsapp', 'whatsapp', 'social');
  if (browser === 'facebook' || clickIds.fbclid || /(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host)) return out('facebook', 'facebook', 'social');

  /* 4. Referrer host. */
  if (refHost) {
    if (/(^|\.)google\.[a-z.]+$/.test(refHost)) return out('google_organic', 'google', 'organic');
    if (/(^|\.)(bing\.com|yahoo\.com|duckduckgo\.com|yandex\.[a-z]+|ecosia\.org|baidu\.com)$/.test(refHost)) return out('other_search', refHost.split('.').slice(-2)[0], 'organic');
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(refHost)) return out('youtube', 'youtube', 'social');
    if (/(^|\.)(t\.co|twitter\.com|x\.com|pinterest\.[a-z.]+|linkedin\.com|reddit\.com|snapchat\.com|threads\.net|lnkd\.in)$/.test(refHost)) return out('social_other', refHost, 'social');
    if (/mail\./.test(refHost)) return out('email', refHost, 'email');
    return out('referral', refHost, 'referral');
  }
  return out('direct', 'direct', '');
}

/* ── Geo (trusted proxy headers, never client input) ── */
export const INDIA_REGIONS = Object.freeze({
  AN: 'Andaman & Nicobar', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh',
  CT: 'Chhattisgarh', CG: 'Chhattisgarh', DN: 'Dadra & Nagar Haveli and Daman & Diu', DD: 'Dadra & Nagar Haveli and Daman & Diu',
  DH: 'Dadra & Nagar Haveli and Daman & Diu', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana', HP: 'Himachal Pradesh',
  JK: 'Jammu & Kashmir', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep', MP: 'Madhya Pradesh',
  MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland', OR: 'Odisha', OD: 'Odisha',
  PY: 'Puducherry', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu', TG: 'Telangana', TS: 'Telangana',
  TR: 'Tripura', UP: 'Uttar Pradesh', UT: 'Uttarakhand', UK: 'Uttarakhand', WB: 'West Bengal',
});

const decode = (v) => { try { return decodeURIComponent(String(v)); } catch { return String(v); } };
const plain = (v, max) => decode(v ?? '').replace(/[^\p{L}\p{N} .,'()-]/gu, '').trim().slice(0, max);

/**
 * City / state / country from Vercel (x-vercel-ip-*) or Cloudflare (cf-*)
 * headers. `regionKey` is bounded: an Indian state code, or the country
 * code for visitors abroad — safe as a rollup map key.
 */
export function geoFromHeaders(get) {
  const country = String(get('x-vercel-ip-country') || get('cf-ipcountry') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  const regionCode = String(get('x-vercel-ip-country-region') || get('cf-region-code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  const city = plain(get('x-vercel-ip-city') || get('cf-ipcity') || '', 60);
  const regionName = country === 'IN' && INDIA_REGIONS[regionCode] ? INDIA_REGIONS[regionCode] : plain(get('cf-region') || '', 60) || regionCode;
  const regionKey = !country ? 'unknown' : country === 'IN' ? (INDIA_REGIONS[regionCode] ? `IN-${regionCode === 'CG' ? 'CT' : regionCode === 'OD' ? 'OR' : regionCode === 'TS' ? 'TG' : regionCode === 'UK' ? 'UT' : regionCode}` : 'IN-other') : country;
  return { country, regionCode, region: regionName, city, regionKey };
}

/** Readable label for a rollup region key. */
export function regionLabel(key) {
  if (!key || key === 'unknown') return 'Unknown';
  if (key === 'IN-other') return 'India (other)';
  if (key.startsWith('IN-')) return INDIA_REGIONS[key.slice(3)] || key;
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(key) || key; } catch { return key; }
}

/** First IP in x-forwarded-for, masked: 49.37.x.x / 2401:4900:1c3a::x. */
export function maskIp(ip) {
  const s = String(ip || '').split(',')[0].trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split('.').slice(0, 2).join('.') + '.x.x';
  if (s.includes(':')) return s.split(':').filter(Boolean).slice(0, 3).join(':') + '::x';
  return '';
}

/* ── Page paths → bounded route keys ── */
const ROUTE_ROOTS = new Set([
  'shop', 'catalog', 'rentals', 'cart', 'checkout', 'order-success', 'track-order', 'account', 'wishlist', 'login',
  'about', 'contact', 'faq', 'privacy', 'terms', 'refunds', 'become-a-vendor', 'rental-booking', 'rental-success',
]);

/** Visible path, validated: starts with "/", no query/hash, ≤ 200 chars. */
export function cleanPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) return '';
  const path = p.split(/[?#]/)[0].replace(/\/{2,}/g, '/').slice(0, 200);
  return /^[\w\-/.~%]*$/.test(path) ? path : '';
}

/** "/product/abc123" → "/product/[id]"; unknown roots → "(other)". */
export function routeKey(p) {
  const path = cleanPath(p);
  if (!path) return '(other)';
  if (path === '/') return '/';
  const [root, second] = path.split('/').filter(Boolean);
  if (root === 'product') return '/product/[id]';
  if (root === 'shop' && second) return '/shop/[category]';
  if (ROUTE_ROOTS.has(root)) return `/${root}`;
  return '(other)';
}

/* Firestore map keys can't contain "." or "/" safely in update paths —
   encode route keys for storage and decode for display. */
export const encodeKey = (k) => String(k).replace(/\//g, '|').replace(/\./g, ',').replace(/\[/g, '(').replace(/\]/g, ')');
export const decodeKey = (k) => String(k).replace(/\|/g, '/').replace(/,/g, '.').replace(/\(id\)/g, '[id]').replace(/\(category\)/g, '[category]');

export const isProductId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
