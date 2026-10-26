/* ─────────────────────────────────────────────
   The Marketing tab's data model (Admin → Settings → Marketing), shared by
   the admin panels, their live previews, the storefront and the settings API.
   Everything below is stored as fields of the public site settings doc
   (settings/site) and written by the settings page's "Save Settings":

     heroSlides            [{ id, imageUrl, isActive?, focus? }]            ≤ 6
     heroLayout            { layoutVariant, displayMode, size }
     testimonials          [{ name, location, rating, review, photo,
                              isActive?, focus? }]                         ≤ 50
     testimonialsLayout    { layoutVariant, displayMode, size }
     instagramFeed         [{ imageUrl, caption, postUrl, isActive?, focus? }] ≤ 6
     instagramLayout       { layoutVariant, displayMode, size }
     advertisements        { layout: { layoutVariant, displayMode, size },
                             items: [{ id, isActive, image, focus, link, title,
                                       buttonText, placements: [...] }] }  ≤ 12

   (The category showcase keeps its own model and endpoint: categoryShowcase.js.)

   The shared rules:
   - Array order is display order. `isActive` (default true) hides a photo
     without deleting it; `focus` is the crop (same shape and checks as the
     category showcase).
   - Nothing stored is trusted. Every normaliser takes whatever is there
     (missing, partial, a legacy shape, garbage, hostile) and returns the
     complete, valid value — never throws, a fresh JSON-safe object each time,
     keys in a fixed order (so two results compare equal as text), unknown keys
     dropped, texts plain (no `<` `>`, no invisible characters, clamped),
     links and photos https (or, for the two legacy photo lists, a path on this
     site). Reading is idempotent: normalising a normalised value changes nothing.
   - With none of the new fields stored, the result reproduces TODAY's homepage:
     the defaults below are what the hero, the testimonials and the Instagram
     strip already look like, and size 'large' is always "as it is today".
   - A photo that is not valid is '' (the card stays in the list so the admin
     can fix it; the storefront skips it through visible()).
   - What the settings API keeps (sanitizeMarketingSettings) is the same data,
     cleaned by the same rules, except that nothing is made up: an `isActive` or
     `focus` the form did not send stays absent (readers fill in the defaults), and
     a hero slide keeps the old slider fields it was saved with.

   Pure module: no React, no zod, no admin copy, no '@/…' imports — it is in
   the storefront's bundle. (The owner-facing words live in src/components/admin.)
   ───────────────────────────────────────────── */
import { normalizeFocus, DEFAULT_LAYOUT as SHOWCASE_LAYOUT, CARD_KEYS } from './categoryShowcase.js';
import { isUsableImageUrl } from './avatar.js';
import { stripInvisible, hasVisibleText } from './deliveryMessage.js';

export { normalizeFocus };

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/* ── What each section allows ── */

/* Width : height of each shape lives in categoryShowcase.ASPECTS; the four shapes are
   the same everywhere. */
const SHAPES = ['circle', 'square', 'king_size', 'wide'];
const SIZE_LIST = ['small', 'medium', 'large'];

/**
 * Per section: the shapes, display modes and sizes an admin may pick, the layout a
 * section has until they pick one, how many photos it holds, and which field of an item is
 * its photo (`photoField`) and which one it cannot be shown without (`requiredField`).
 *
 *   hero          single photo (today) or a slider; king_size = today's 4:5 box
 *   showcase      the category cards (categoryShowcase.js); listed so generic code can ask
 *   testimonials  `layoutVariant` is the shape of the reviewer's photo frame; the round avatar today
 *   instagram     the tiles; square today
 *   ads           banners; wide 16:9; a slider by default (one banner is just one banner)
 *
 * `size` is a density (cards per row, tile / box width, banner height) and 'large' is
 * always what the page looks like today, so a section nobody has touched renders as before.
 */
export const SECTIONS = deepFreeze({
  hero: {
    shapes: SHAPES,
    modes: ['single', 'slider'],
    sizes: SIZE_LIST,
    defaultLayout: { layoutVariant: 'king_size', displayMode: 'single', size: 'large' },
    maxItems: 6,
    photoField: 'imageUrl',
    requiredField: 'imageUrl',
  },
  showcase: {
    shapes: SHAPES,
    modes: ['grid', 'slider'],
    sizes: SIZE_LIST,
    defaultLayout: { ...SHOWCASE_LAYOUT },
    maxItems: CARD_KEYS.length,
    photoField: 'image',
    requiredField: null,
  },
  testimonials: {
    shapes: SHAPES,
    modes: ['grid', 'slider'],
    sizes: SIZE_LIST,
    defaultLayout: { layoutVariant: 'circle', displayMode: 'grid', size: 'large' },
    maxItems: 50,
    photoField: 'photo',
    requiredField: 'review',
  },
  instagram: {
    shapes: SHAPES,
    modes: ['grid', 'slider'],
    sizes: SIZE_LIST,
    defaultLayout: { layoutVariant: 'square', displayMode: 'grid', size: 'large' },
    maxItems: 6,
    photoField: 'imageUrl',
    requiredField: 'imageUrl',
  },
  ads: {
    shapes: SHAPES,
    modes: ['grid', 'slider'],
    sizes: SIZE_LIST,
    defaultLayout: { layoutVariant: 'wide', displayMode: 'slider', size: 'large' },
    maxItems: 12,
    photoField: 'image',
    requiredField: 'image',
  },
});
export const SECTION_IDS = Object.freeze(Object.keys(SECTIONS));

/** Longest texts and links kept (the admin's inputs use the same numbers as maxLength). */
export const LIMITS = Object.freeze({
  id: 64,
  name: 80,
  location: 80,
  review: 1500,
  caption: 300,
  adTitle: 60,
  adButton: 24,
  link: 600,
  adImage: 600,
  /* Hero and Instagram photos have always accepted any link, long signed CDN links included. */
  photoLink: 2000,
  legacyField: 500,
});

/** Pages an advertisement can appear on. `path` is the route Next caches (the settings API drops it on save). */
export const PLACEMENTS = deepFreeze([
  { value: 'home', label: 'Home page', path: '/' },
  { value: 'shop', label: 'Shop page', path: '/shop' },
  { value: 'category', label: 'Category page', path: '/catalog' },
  { value: 'product', label: 'Product page', path: '/product/[id]', dynamic: true },
  { value: 'cart', label: 'Cart page', path: '/cart' },
  { value: 'checkout', label: 'Checkout page', path: '/checkout' },
  { value: 'order-success', label: 'Order success page', path: '/order-success' },
  { value: 'track-order', label: 'Track order page', path: '/track-order' },
]);
export const PLACEMENT_VALUES = Object.freeze(PLACEMENTS.map((p) => p.value));

/* The settings keys this module owns (sanitizeMarketingSettings touches these and no others). */
export const MARKETING_KEYS = Object.freeze([
  'heroSlides', 'heroLayout', 'testimonials', 'testimonialsLayout', 'instagramFeed', 'instagramLayout', 'advertisements',
]);

/* The old slider's fields: no page draws them any more, but a slide saved with them keeps them
   (the admin form never showed them back, so it must not be the thing that deletes them). */
const LEGACY_HERO_FIELDS = Object.freeze(['tag', 'title', 'subtitle', 'ctaText', 'ctaLink', 'cta2Text', 'cta2Link', 'bg']);

/* ── Small helpers ── */

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/* Own properties only: nothing inherited (Object.prototype pollution, __proto__ payloads) is ever read. */
const get = (obj, key) => (isRecord(obj) && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
const has = (obj, key) => isRecord(obj) && Object.prototype.hasOwnProperty.call(obj, key);
const hasValue = (v) => typeof v === 'string' && v.trim() !== '';
const pick = (list, value, fallback) => (typeof value === 'string' && list.includes(value) ? value : fallback);

/* More entries than this are never even looked at (a hostile 10-million-item array costs nothing). */
const SCAN_LIMIT = 1000;
/* Longer text is cut before it is processed. */
const TEXT_SCAN = 20000;

function safely(fn, fallback) {
  try {
    return fn();
  } catch {
    /* A hostile getter or proxy: the defaults are always a safe answer. */
    return fallback;
  }
}

/* Characters that change how a line reads, not what it says. */
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;
/* A half of an emoji (a lone surrogate) is not text: it would not survive being stored. */
const wellFormed = (s) => s.replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g, (m, pair) => pair || '');

/* A tag (`<b>`, `</p>`, `<img src=x onerror=…>`, `<!-- -->`). Taking one out can join the pieces on
   either side into another (`<scr<b>ipt>`), so it is repeated; whatever `<` `>` is left over goes too. */
const TAG = /<\/?[A-Za-z!?][^<>]*>/g;
function stripTags(s) {
  let out = s;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = out.replace(TAG, '');
    if (next === out) break;
    out = next;
  }
  return out.replace(/[<>]/g, '');
}

/* Plain text: no tags and no `<` `>`, no invisible characters, whitespace collapsed, at most `max`
   UTF-16 units (never cut inside an emoji); '' when nothing a customer could read is left. */
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const flat = stripTags(stripInvisible(wellFormed(value.length > TEXT_SCAN ? value.slice(0, TEXT_SCAN) : value).replace(CONTROLS, ' ')))
    .replace(/\s+/g, ' ')
    .trim();
  let out = '';
  for (const ch of flat) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  out = out.trim();
  return hasVisibleText(out) ? out : '';
}

/* Ids are labels for the admin's lists and React's keys, never looked up as anything else. */
const cleanId = (v) => {
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
  return typeof s === 'string' ? s.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, LIMITS.id) : '';
};
/* The id an item gets when it has none or when another item already took it — deterministic, so the
   server's list and the browser's agree. */
function uniqueId(raw, taken, fallback) {
  let id = cleanId(raw) || fallback;
  if (taken.has(id)) {
    let n = 2;
    while (taken.has(`${id}-${n}`)) n += 1;
    id = `${id}-${n}`;
  }
  taken.add(id);
  return id;
}

const safeFocus = (raw) => safely(() => normalizeFocus(raw), normalizeFocus(null));

/* ── Links and photos ── */

/**
 * An https link to a real host, or ''. No http, no credentials in the link (https://shop.com@evil.com),
 * no address bar tricks (backslashes, spaces, control characters, quotes, angle brackets), no IP
 * addresses or single-word hosts, at most LIMITS.link characters.
 * @param {unknown} v
 */
export function safeHttpsUrl(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > LIMITS.link || !/^https:\/\/[^\s\u0000-\u001F\u007F"'<>\\]+$/i.test(s)) return '';
  /* "https://shop.com@evil.com" reads as shop.com and goes to evil.com: no user-info part at all. */
  if (/^https:\/\/[^/?#]*@/i.test(s)) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    if (!/\.(?=[a-z0-9-]*[a-z])[a-z0-9-]{2,}$/i.test(u.hostname)) return '';
  } catch {
    return '';
  }
  return s;
}

/**
 * Where an advertisement may send a customer: '' (no link), a path on this site (starts with a
 * single '/', so never '//host' or '/\host'), or an https link (safeHttpsUrl). Anything else —
 * javascript:, data:, http:, mailto:, 'shop', '//evil.com' — is ''.
 * @param {unknown} v
 * @returns {string} the link as typed (trimmed), or ''
 */
export function safeAdLink(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  if (s.startsWith('/')) return s.length <= LIMITS.link && /^\/(?![/\\])[^\s\u0000-\u001F\u007F"'<>\\]*$/.test(s) ? s : '';
  return safeHttpsUrl(s);
}

/** True for a link that leaves this site (opens in a new tab with rel="noopener noreferrer"). */
export const isExternalLink = (href) => typeof href === 'string' && /^https:/i.test(href);

/* An advertisement photo: https only, like the category showcase's photos. */
function cleanAdImage(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length <= LIMITS.adImage && /^https:\/\/[^\s"'<>]+$/.test(s) ? s : '';
}

/* A hero or Instagram photo: https, or a path on this site (what the hero has always accepted:
   heroSlides.isImageLink). */
function cleanPhotoLink(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length <= LIMITS.photoLink && /^(?:https:\/\/[^\s"'<>\\]+|\/(?![/\\])[^\s"'<>\\]*)$/i.test(s) ? s : '';
}

/* ── Layout ── */

/**
 * The layout bar's value for a section, complete and valid: shape, display mode and size each
 * from that section's allow-list, the section's default for anything else. An unknown section
 * gets the category showcase's.
 * @param {unknown} raw
 * @param {'hero'|'showcase'|'testimonials'|'instagram'|'ads'} section
 * @returns {{ layoutVariant: string, displayMode: string, size: string }}
 */
export function normalizeLayout(raw, section) {
  const cfg = typeof section === 'string' && Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : SECTIONS.showcase;
  const d = cfg.defaultLayout;
  return safely(() => ({
    layoutVariant: pick(cfg.shapes, get(raw, 'layoutVariant'), d.layoutVariant),
    displayMode: pick(cfg.modes, get(raw, 'displayMode'), d.displayMode),
    size: pick(cfg.sizes, get(raw, 'size'), d.size),
  }), { ...d });
}

/** True when the layout is a slider that has something to slide (a lone photo is just a photo: no dots, no timer). */
export const showsSlider = (layout, count) => get(layout, 'displayMode') === 'slider' && count > 1;

/* ── Items ──
   Each builder returns one item. `store` is the form the settings API keeps: the same
   fields, but `isActive` and `focus` only when they were sent (a document saved before they
   existed is not rewritten with defaults); a reader fills them in. */

/* The two optional fields, as a partial object to spread: both when reading, only the ones that
   were sent when storing. */
const activeOf = (raw, store) => {
  const v = get(raw, 'isActive');
  if (typeof v === 'boolean') return { isActive: v };
  return store ? {} : { isActive: true };
};
const focusOf = (raw, store) => {
  const v = get(raw, 'focus');
  if (isRecord(v)) return { focus: safeFocus(v) };
  return store ? {} : { focus: normalizeFocus(null) };
};

function heroSlide(raw, ctx) {
  const out = {
    id: ctx.store ? cleanId(get(raw, 'id')) : uniqueId(get(raw, 'id'), ctx.taken, `slide-${ctx.index + 1}`),
    imageUrl: cleanPhotoLink(get(raw, 'imageUrl')),
    ...activeOf(raw, ctx.store),
    ...focusOf(raw, ctx.store),
  };
  if (ctx.store) {
    for (const field of LEGACY_HERO_FIELDS) {
      const v = get(raw, field);
      if (typeof v === 'string') out[field] = v.slice(0, LIMITS.legacyField);
    }
  }
  return out;
}

/* A rating is 1–5 stars; anything else is the 5 the form starts on (heroSlides.pickTestimonials's rule). */
function cleanRating(v) {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(5, Math.round(n)) : 5;
}

function testimonial(raw, ctx) {
  return {
    name: cleanText(get(raw, 'name'), LIMITS.name),
    location: cleanText(get(raw, 'location'), LIMITS.location),
    rating: cleanRating(get(raw, 'rating')),
    /* Reviews saved by the earliest form used `text`. */
    review: cleanText(get(raw, 'review'), LIMITS.review) || cleanText(get(raw, 'text'), LIMITS.review),
    photo: isUsableImageUrl(get(raw, 'photo')) ? get(raw, 'photo') : '',
    ...activeOf(raw, ctx.store),
    ...focusOf(raw, ctx.store),
  };
}

function instagramPost(raw, ctx) {
  return {
    imageUrl: cleanPhotoLink(get(raw, 'imageUrl')),
    caption: cleanText(get(raw, 'caption'), LIMITS.caption),
    postUrl: safeHttpsUrl(get(raw, 'postUrl')),
    ...activeOf(raw, ctx.store),
    ...focusOf(raw, ctx.store),
  };
}

function advertisement(raw, ctx) {
  const placements = get(raw, 'placements');
  const listed = Array.isArray(placements) ? placements.slice(0, SCAN_LIMIT) : [];
  return {
    id: uniqueId(get(raw, 'id'), ctx.taken, `ad-${ctx.index + 1}`),
    ...activeOf(raw, ctx.store),
    image: cleanAdImage(get(raw, 'image')),
    ...focusOf(raw, ctx.store),
    link: safeAdLink(get(raw, 'link')),
    title: cleanText(get(raw, 'title'), LIMITS.adTitle),
    buttonText: cleanText(get(raw, 'buttonText'), LIMITS.adButton),
    /* The known pages, once each, in the order PLACEMENTS lists them. */
    placements: PLACEMENT_VALUES.filter((p) => listed.includes(p)),
  };
}

const BUILDERS = { hero: heroSlide, testimonials: testimonial, instagram: instagramPost, ads: advertisement };

function buildList(raw, section, store) {
  return safely(() => {
    const out = [];
    if (!Array.isArray(raw)) return out;
    const max = SECTIONS[section].maxItems;
    const build = BUILDERS[section];
    const taken = new Set();
    const n = Math.min(raw.length, SCAN_LIMIT);
    for (let i = 0; i < n && out.length < max; i += 1) {
      try {
        const item = raw[i];
        if (isRecord(item)) out.push(build(item, { store, taken, index: out.length }));
      } catch {
        /* an entry with a throwing getter is skipped, the rest are read */
      }
    }
    return out;
  }, []);
}

/**
 * The hero photos in `raw` (settings.heroSlides): at most 6, each `{ id, imageUrl, isActive, focus }`.
 * A slide saved before these fields existed reads as visible, auto-cropped. Entries that are not
 * objects are dropped; a non-array is "no slides". The old slider's tag / title / buttons are not
 * part of what the page reads.
 * @param {unknown} raw
 * @returns {{ id: string, imageUrl: string, isActive: boolean, focus: ReturnType<typeof normalizeFocus> }[]}
 */
export const normalizeHeroSlides = (raw) => buildList(raw, 'hero', false);

/**
 * The reviews in `raw` (settings.testimonials): at most 50, each
 * `{ name, location, rating, review, photo, isActive, focus }`. Like heroSlides.pickTestimonials a
 * review's words may be in `text` (the earliest form), rating is 1–5 (5 when missing) and the photo
 * is kept only when it is a usable https link. A review with no words is kept (the admin can finish
 * it) but is not visible() on the storefront.
 * @param {unknown} raw
 * @returns {{ name: string, location: string, rating: number, review: string, photo: string, isActive: boolean, focus: ReturnType<typeof normalizeFocus> }[]}
 */
export const normalizeTestimonialItems = (raw) => buildList(raw, 'testimonials', false);

/**
 * The Instagram posts in `raw` (settings.instagramFeed): at most 6, each
 * `{ imageUrl, caption, postUrl, isActive, focus }`. postUrl is an https link or ''.
 * @param {unknown} raw
 * @returns {{ imageUrl: string, caption: string, postUrl: string, isActive: boolean, focus: ReturnType<typeof normalizeFocus> }[]}
 */
export const normalizeInstagramItems = (raw) => buildList(raw, 'instagram', false);

function buildAds(raw, store) {
  const src = Array.isArray(raw) ? { items: raw } : raw;
  return {
    layout: normalizeLayout(get(src, 'layout'), 'ads'),
    items: buildList(get(src, 'items'), 'ads', store),
  };
}

/**
 * The advertisements in `raw` (settings.advertisements, or a bare list of ads):
 * `{ layout, items }`, at most 12 ads, each
 * `{ id, isActive, image, focus, link, title, buttonText, placements }`. Ids are unique and never
 * empty; `link` is '' / a path on this site / https (safeAdLink); `image` is https; `title` ≤ 60 and
 * `buttonText` ≤ 24 characters of plain text; `placements` are known page ids, once each. An ad with no
 * placements shows nowhere.
 * @param {unknown} raw
 * @returns {{ layout: { layoutVariant: string, displayMode: string, size: string }, items: { id: string, isActive: boolean, image: string, focus: ReturnType<typeof normalizeFocus>, link: string, title: string, buttonText: string, placements: string[] }[] }}
 */
export const normalizeAdvertisements = (raw) => safely(() => buildAds(raw, false), emptyAds());

/** No advertisements: the default layout and no ads. A fresh object each call. */
export function emptyAds() {
  return { layout: { ...SECTIONS.ads.defaultLayout }, items: [] };
}

/** A complete new item for a section (`init` fields applied and normalised), e.g. `newItem('ads', { id })`. */
export function newItem(section, init = {}) {
  if (typeof section !== 'string' || !Object.hasOwn(BUILDERS, section)) throw new TypeError(`newItem: no items in section "${section}"`);
  return buildList([isRecord(init) ? init : {}], section, false)[0];
}

/**
 * The items the storefront draws: switched on (`isActive !== false`) and, for a section that
 * cannot be shown without its main field (the hero without a photo, a review without words),
 * with it. Order is kept. Without `section` only the switch counts.
 * @param {unknown[]} items
 * @param {'hero'|'testimonials'|'instagram'|'ads'|'showcase'} [section]
 */
export function visible(items, section) {
  const need = typeof section === 'string' && Object.hasOwn(SECTIONS, section) ? SECTIONS[section].requiredField : null;
  return (Array.isArray(items) ? items : []).filter((it) => isRecord(it) && it.isActive !== false && (!need || hasValue(it[need])));
}

/**
 * The ads for one page: the visible ads that list `placement`, in order, with the layout.
 * Accepts the stored or the normalised value. Nothing for an unknown page.
 * @param {unknown} ads  settings.advertisements / getAdvertisements()
 * @param {string} placement  one of PLACEMENT_VALUES
 * @returns {{ layout: { layoutVariant: string, displayMode: string, size: string }, items: ReturnType<typeof normalizeAdvertisements>['items'] }}
 */
export function adsForPlacement(ads, placement) {
  const all = normalizeAdvertisements(ads);
  const items = typeof placement === 'string' && PLACEMENT_VALUES.includes(placement)
    ? visible(all.items, 'ads').filter((ad) => ad.placements.includes(placement))
    : [];
  return { layout: all.layout, items };
}

/* ── The whole tab at once ── */

/**
 * Everything the Marketing tab stores, normalised, from the site settings doc (or {}):
 * `{ heroSlides, heroLayout, testimonials, testimonialsLayout, instagramFeed, instagramLayout, advertisements }`.
 * @param {unknown} settings
 */
export function normalizeMarketing(settings) {
  const read = (key) => safely(() => get(settings, key), undefined);
  return {
    heroSlides: normalizeHeroSlides(read('heroSlides')),
    heroLayout: normalizeLayout(read('heroLayout'), 'hero'),
    testimonials: normalizeTestimonialItems(read('testimonials')),
    testimonialsLayout: normalizeLayout(read('testimonialsLayout'), 'testimonials'),
    instagramFeed: normalizeInstagramItems(read('instagramFeed')),
    instagramLayout: normalizeLayout(read('instagramLayout'), 'instagram'),
    advertisements: normalizeAdvertisements(read('advertisements')),
  };
}

/* ── Changes: "is it still what the screen shows?" ── */

/** True when two JSON-safe values print the same (normalised values have a fixed key order, so that means equal). */
export function sameJson(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * What a piece of state should hold once fresher data arrives — `prev` itself, the same
 * reference, when nothing should change, so React skips the render and what is on screen is
 * not touched (the rule nextHeroSlides and nextShowcase follow). That is when:
 *  - `next` is missing (null / undefined): there is nothing to take;
 *  - `stale`: it came from the browser's stored copy while the server already put newer data in the HTML;
 *  - `next` prints the same as `prev`.
 * @template T
 * @param {T} prev
 * @param {T|null|undefined} next
 * @param {{ stale?: boolean }} [from]
 * @returns {T}
 */
export function nextIfChanged(prev, next, { stale = false } = {}) {
  if (stale || next === undefined || next === null) return prev;
  return sameJson(prev, next) ? prev : next;
}

/* ── Saving ── */

/**
 * What POST /api/admin/settings keeps of the Marketing keys in a request body: a shallow copy of
 * `body` where
 *  - heroSlides / testimonials / instagramFeed / advertisements.items are cleaned item by item (the
 *    normalisers' rules: at most 6 / 50 / 6 / 12, https photos and links, plain text, unknown
 *    fields dropped) — except that nothing is filled in that was not sent (`isActive`, `focus`), and
 *    a hero slide keeps the old slider's fields it was saved with;
 *  - heroLayout / testimonialsLayout / instagramLayout / advertisements.layout are complete and valid;
 *  - a key of the wrong type (a string for a list, null for a layout) is left out, so what is stored
 *    stays as it was;
 *  - every other key is untouched. Never throws; `body` is not changed.
 * @param {unknown} body
 * @returns {Record<string, unknown>}
 */
export function sanitizeMarketingSettings(body) {
  const out = safely(() => (isRecord(body) ? { ...body } : {}), {});
  const lists = { heroSlides: 'hero', testimonials: 'testimonials', instagramFeed: 'instagram' };
  const layouts = { heroLayout: 'hero', testimonialsLayout: 'testimonials', instagramLayout: 'instagram' };
  for (const [key, section] of Object.entries(lists)) {
    if (!has(out, key)) continue;
    if (Array.isArray(out[key])) out[key] = buildList(out[key], section, true);
    else delete out[key];
  }
  for (const [key, section] of Object.entries(layouts)) {
    if (!has(out, key)) continue;
    if (isRecord(out[key])) out[key] = normalizeLayout(out[key], section);
    else delete out[key];
  }
  if (has(out, 'advertisements')) {
    if (isRecord(out.advertisements) || Array.isArray(out.advertisements)) out.advertisements = safely(() => buildAds(out.advertisements, true), emptyAds());
    else delete out.advertisements;
  }
  return out;
}
