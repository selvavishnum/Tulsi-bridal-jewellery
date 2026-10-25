/* ─────────────────────────────────────────────
   Homepage category showcase ("Shop by Category") — the data model shared
   by the admin manager, its live preview, the storefront and the API.

   Stored as one field of the public site settings doc (settings/site):

     categoryShowcase: {
       version: 1,
       layout: {
         layoutVariant: 'circle' | 'square' | 'king_size' | 'wide',
         displayMode:   'grid' | 'slider',
         size:          'small' | 'medium' | 'large',   // density
       },
       items: [{
         key, isActive, displayOrder, isFeatured,
         image,                       // '' = deliberately no photo
         focus: { gravity, x, y, zoom },
       }],
     }

   The cards themselves (label, link, emoji) are defined here in code, so a
   stored doc can only show, hide, order, feature, photograph and crop the
   known cards — never inject a link. Settings saved before this existed
   (categoryImages / categoryShape / categorySize) are read as the starting
   point, so the homepage looks the same until someone changes it.

   Pure module (no dependencies): safe in the browser, the server and tests.
   ───────────────────────────────────────────── */

export const SHOWCASE_VERSION = 1;

/* postMessage type between the admin page and its preview frame
   (/showcase-preview): '<type>' carries { showcase }, '<type>-ready' and
   '<type>-height' { height } come back. */
export const PREVIEW_MSG = 'tj-showcase-preview';

/* The cards. `key` matches the catalogue category (and the old categoryImages keys). */
export const SHOWCASE_CARDS = Object.freeze([
  { key: 'necklace', label: 'Necklaces', href: '/catalog?category=necklace', emoji: '📿', color: 'from-rose-50 to-pink-50' },
  { key: 'earrings', label: 'Earrings', href: '/catalog?category=earrings', emoji: '✨', color: 'from-amber-50 to-yellow-50' },
  { key: 'bangles', label: 'Bangles', href: '/catalog?category=bangles', emoji: '🟡', color: 'from-orange-50 to-amber-50' },
  { key: 'maang-tikka', label: 'Maang Tikka', href: '/catalog?category=maang-tikka', emoji: '👑', color: 'from-purple-50 to-violet-50' },
  { key: 'set', label: 'Bridal Sets', href: '/catalog?category=set', emoji: '💍', color: 'from-red-50 to-rose-50' },
  { key: 'rentals', label: 'Rentals', href: '/rentals', emoji: '🗓️', color: 'from-gold-50 to-amber-50' },
]);
export const CARD_KEYS = SHOWCASE_CARDS.map((c) => c.key);

export const LAYOUT_VARIANTS = Object.freeze([
  { value: 'circle', label: 'Circle', hint: 'Round photos, name below' },
  { value: 'square', label: 'Square', hint: '1 : 1 tiles' },
  { value: 'king_size', label: 'King Size', hint: 'Tall 4 : 5 portrait cards' },
  { value: 'wide', label: 'Wide Banner', hint: '16 : 9 banners' },
]);
export const DISPLAY_MODES = Object.freeze([
  { value: 'grid', label: 'Grid' },
  { value: 'slider', label: 'Slider' },
]);
export const SIZES = Object.freeze(['small', 'medium', 'large']);

/* Crop gravity. auto = Cloudinary's AI picks the subject (best for
   jewellery); custom = the admin's own focal point. */
export const GRAVITIES = Object.freeze([
  { value: 'auto', label: 'Auto (AI)' },
  { value: 'face', label: 'Face' },
  { value: 'center', label: 'Centre' },
  { value: 'north', label: 'Top' },
  { value: 'south', label: 'Bottom' },
  { value: 'custom', label: 'Custom point' },
]);
export const GRAVITY_VALUES = GRAVITIES.map((g) => g.value);

/* Width : height of each shape's frame. */
export const ASPECTS = Object.freeze({ circle: [1, 1], square: [1, 1], king_size: [4, 5], wide: [16, 9] });

export const DEFAULT_FOCUS = Object.freeze({ gravity: 'auto', x: 50, y: 50, zoom: 1 });
export const DEFAULT_LAYOUT = Object.freeze({ layoutVariant: 'king_size', displayMode: 'grid', size: 'large' });
export const ZOOM_RANGE = Object.freeze({ min: 1, max: 2.5 });

const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const isImageUrl = (v) => typeof v === 'string' && v.length <= 600 && /^https:\/\/[^\s"'<>]+$/.test(v);

function normalizeFocus(f) {
  const src = f && typeof f === 'object' ? f : {};
  return {
    gravity: GRAVITY_VALUES.includes(src.gravity) ? src.gravity : DEFAULT_FOCUS.gravity,
    x: Math.round(clampNum(src.x, 0, 100, DEFAULT_FOCUS.x)),
    y: Math.round(clampNum(src.y, 0, 100, DEFAULT_FOCUS.y)),
    zoom: Math.round(clampNum(src.zoom, ZOOM_RANGE.min, ZOOM_RANGE.max, DEFAULT_FOCUS.zoom) * 100) / 100,
  };
}

/* Old settings (shape + size) → the layout they produced. */
function legacyLayout(settings) {
  const shape = settings?.categoryShape;
  const size = SIZES.includes(settings?.categorySize) ? settings.categorySize : DEFAULT_LAYOUT.size;
  if (shape === 'circle') return { layoutVariant: 'circle', displayMode: 'grid', size };
  if (shape === 'square' && size === 'small') return { layoutVariant: 'square', displayMode: 'grid', size };
  return { ...DEFAULT_LAYOUT, size };
}

/**
 * The showcase as everything else should see it: every known card exactly
 * once (stored values where valid, defaults otherwise), ordered by
 * displayOrder, with the card's label / link / emoji attached.
 * @param {object} settings  the site settings doc (or {})
 */
export function normalizeShowcase(settings = {}) {
  const stored = settings && typeof settings.categoryShowcase === 'object' && settings.categoryShowcase ? settings.categoryShowcase : null;
  const legacyImages = settings?.categoryImages && typeof settings.categoryImages === 'object' ? settings.categoryImages : {};
  const l = stored?.layout && typeof stored.layout === 'object' ? stored.layout : legacyLayout(settings);
  const layout = {
    /* typeof first: hasOwn coerces its key, so ['circle'] would pass. */
    layoutVariant: typeof l.layoutVariant === 'string' && Object.hasOwn(ASPECTS, l.layoutVariant) ? l.layoutVariant : DEFAULT_LAYOUT.layoutVariant,
    displayMode: DISPLAY_MODES.some((m) => m.value === l.displayMode) ? l.displayMode : DEFAULT_LAYOUT.displayMode,
    size: SIZES.includes(l.size) ? l.size : DEFAULT_LAYOUT.size,
  };
  const byKey = new Map();
  for (const it of Array.isArray(stored?.items) ? stored.items : []) {
    if (it && CARD_KEYS.includes(it.key) && !byKey.has(it.key)) byKey.set(it.key, it);
  }
  const items = SHOWCASE_CARDS.map((card, i) => {
    const s = byKey.get(card.key) || {};
    /* '' means "removed on purpose"; undefined falls back to the old photo field. */
    const rawImage = s.image !== undefined ? s.image : legacyImages[card.key];
    return {
      ...card,
      isActive: typeof s.isActive === 'boolean' ? s.isActive : true,
      displayOrder: Number.isInteger(s.displayOrder) ? s.displayOrder : i,
      isFeatured: s.isFeatured === true,
      image: isImageUrl(rawImage) ? rawImage : '',
      focus: normalizeFocus(s.focus),
    };
  });
  items.sort((a, b) => a.displayOrder - b.displayOrder || CARD_KEYS.indexOf(a.key) - CARD_KEYS.indexOf(b.key));
  /* Re-number 0..n-1 so the order is always a clean sequence. */
  items.forEach((it, i) => { it.displayOrder = i; });
  return { version: SHOWCASE_VERSION, layout, items };
}

/** What is stored: no derived card fields (label/link/emoji come from code). */
export function toStored(showcase) {
  return {
    version: SHOWCASE_VERSION,
    layout: { ...showcase.layout },
    items: showcase.items.map((it) => ({
      key: it.key, isActive: it.isActive, displayOrder: it.displayOrder, isFeatured: it.isFeatured,
      image: it.image, focus: { ...it.focus },
    })),
  };
}

/** The cards the storefront shows, in order. */
export const visibleItems = (showcase) => showcase.items.filter((it) => it.isActive);

/* ── Changes (PATCH body) ──
   The validation schema (ShowcasePatch) lives in categoryShowcaseSchema.js:
   it needs zod, which the storefront would otherwise download on every visit
   for a schema only the admin API uses. */

/**
 * Apply a validated patch to a normalized showcase (returns a new one).
 * Only the fields sent are changed, so two quick toggles from the admin
 * page never undo each other.
 */
export function applyShowcasePatch(showcase, patch) {
  const next = {
    version: SHOWCASE_VERSION,
    layout: { ...showcase.layout, ...(patch.layout || {}) },
    items: showcase.items.map((it) => ({ ...it, focus: { ...it.focus } })),
  };
  for (const p of patch.items || []) {
    const it = next.items.find((x) => x.key === p.key);
    if (typeof p.isActive === 'boolean') it.isActive = p.isActive;
    if (typeof p.isFeatured === 'boolean') it.isFeatured = p.isFeatured;
    if (p.image !== undefined) it.image = p.image;
    if (p.focus) it.focus = normalizeFocus({ ...it.focus, ...p.focus });
  }
  if (patch.order) {
    const pos = new Map(patch.order.map((k, i) => [k, i]));
    next.items.sort((a, b) => pos.get(a.key) - pos.get(b.key));
  }
  next.items.forEach((it, i) => { it.displayOrder = i; });
  return next;
}

/* ── Rendering helpers (storefront + preview) ── */
const CLD_UPLOAD = '/upload/';
export const isCloudinary = (url) => typeof url === 'string' && url.includes('res.cloudinary.com') && url.includes(CLD_UPLOAD);

const CLD_GRAVITY = { auto: 'auto', face: 'auto:faces', center: 'center', north: 'north', south: 'south' };

/**
 * The photo URL for a frame of the given shape and pixel width.
 * Preset gravities crop on Cloudinary's CDN to the exact frame (the AI
 * keeps the jewellery in view); a custom point is cropped by the browser
 * (focusStyle), so Cloudinary only resizes.
 */
export function showcaseImageUrl(url, { variant = 'square', focus = DEFAULT_FOCUS, width = 600 } = {}) {
  if (!isCloudinary(url)) return url;
  /* Zooming in shows fewer of the photo's pixels on screen: fetch more. A
     custom point is cropped by the browser (object-fit: cover), which may
     need more width than the frame when the photo is a different shape. */
  const zoom = Number(focus.zoom) > 1 ? Number(focus.zoom) : 1;
  const [aw, ah] = ASPECTS[variant] || ASPECTS.square;
  const t = focus.gravity === 'custom'
    ? `f_auto,q_auto:good,c_limit,w_${Math.min(3000, Math.round(Math.max(80, width) * zoom * 1.6))}`
    : `f_auto,q_auto:good,c_fill,ar_${aw}:${ah},g_${CLD_GRAVITY[focus.gravity] || 'auto'},w_${Math.min(3000, Math.round(Math.max(80, width) * zoom))}`;
  const i = url.indexOf(CLD_UPLOAD) + CLD_UPLOAD.length;
  return `${url.slice(0, i)}${t}/${url.slice(i)}`;
}

/** srcset across widths for a frame of `variant`. */
/* 720 and 1600 fill gaps that cost bytes: a full-width tile on a phone needs ~660–720px (the next rung up was 900), a featured tile on a 2× desktop ~1600. */
export function showcaseSrcSet(url, opts, widths = [240, 400, 600, 720, 900, 1200, 1600]) {
  if (!isCloudinary(url)) return undefined;
  return widths.map((w) => `${showcaseImageUrl(url, { ...opts, width: w })} ${w}w`).join(', ');
}

const CSS_POSITION = { auto: '50% 50%', face: '50% 30%', center: '50% 50%', north: '50% 0%', south: '50% 100%' };

/** Inline style for the <img>: where to crop, and how far to zoom in. */
export function focusStyle(focus = DEFAULT_FOCUS) {
  const origin = focus.gravity === 'custom' ? `${focus.x}% ${focus.y}%` : CSS_POSITION[focus.gravity] || '50% 50%';
  return {
    objectFit: 'cover',
    objectPosition: origin,
    transformOrigin: origin,
    transform: focus.zoom > 1 ? `scale(${focus.zoom})` : undefined,
  };
}
