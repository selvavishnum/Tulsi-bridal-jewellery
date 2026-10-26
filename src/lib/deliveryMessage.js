/* ─────────────────────────────────────────────
   The "Free Delivery across India" / "Free Nationwide Shipping" message —
   what the owner can switch off, reword and restyle (Admin → Settings →
   Marketing → Delivery message), as plain JSON in settings/site.deliveryMessage.

   Three places draw it: the announcement strip ('bar', and 'tagline' for the
   strip's second state), the home hero's trust badges ('badge') and the
   product page's trust list ('product'). The words come from the owner; the
   *permission* to show them still comes from the shop's real shipping rule:

     enabled false          → shown nowhere
     mode 'auto' (default)  → shown only while deliveryFreeForAll(charges), i.e.
                              today's honest behaviour
     mode 'always'          → shown whenever enabled (the owner's own text, e.g.
                              "Free delivery above ₹999"); the admin warns when
                              the shipping settings still charge for delivery

   Pure module — no '@/…' imports, no Tailwind classes (those live in
   src/components/ui/deliveryMessageStyle.js, where Tailwind scans for them) —
   safe on the server, in the browser and in tests.

   This file is in the first-load JavaScript of every storefront page (the
   announcement strip reads it), so it holds only what the storefront needs:
   the choices as plain values, normalising, the truth table, the contrast
   maths. The owner-facing words (option labels and hints, the shipping
   warning, the colour advice) live in src/components/admin/deliveryMessageAdmin.js,
   which only the admin page loads.
   ───────────────────────────────────────────── */
import { deliveryFreeForAll, FREE_DELIVERY_LINE } from './storeCharges.js';

export const DELIVERY_TEXT_MAX = 60;
export const DEFAULT_BAR_TEXT = FREE_DELIVERY_LINE;
export const DEFAULT_BADGE_TEXT = 'Free Nationwide Shipping';

/* WCAG: below 3:1 text does not read at all (4.5:1, the comfortable level, is the admin's: deliveryMessageAdmin.js). */
export const CONTRAST_MIN = 3;

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/* What the owner can pick: the allow-lists normalizeDeliveryMessage enforces, as plain values (one source
   of truth). The labels, hints and swatches the admin shows next to them are
   src/components/admin/deliveryMessageAdmin.js's DELIVERY_OPTIONS, which a test keeps in step with this. */
export const DELIVERY_CHOICES = deepFreeze({
  fonts: ['sans', 'serif', 'classic'],
  weights: ['normal', 'medium', 'semibold', 'bold'],
  sizes: ['sm', 'md', 'lg'],
  trackings: ['normal', 'wide', 'wider'],
  models: ['text', 'pill', 'outline', 'solid', 'underline'],
  tones: ['auto', 'gold', 'wine', 'emerald', 'ivory', 'night', 'custom'],
  icons: ['🚚', '✨', '🎁', '✅', '💛', ''],
  modes: ['auto', 'always'],
});

const { fonts: FONTS, weights: WEIGHTS, sizes: SIZES, trackings: TRACKINGS, models: MODELS, tones: TONES, icons: ICONS, modes: MODES } = DELIVERY_CHOICES;

/* What the message sits on, for the contrast checks. The strip is a gradient from
   velvet-950 to wine-950: the lightest stop is used, because the worst case for
   light text is the lightest ground. */
export const SURFACE_COLORS = Object.freeze({ bar: '#3d0a23', badge: '#FAF8F5', product: '#ffffff' });

export const DEFAULT_DELIVERY_MESSAGE = deepFreeze({
  enabled: true,
  mode: 'auto',
  barText: DEFAULT_BAR_TEXT,
  badgeText: DEFAULT_BADGE_TEXT,
  icon: '🚚',
  style: {
    font: 'sans',
    weight: 'normal',
    size: 'md',
    tracking: 'normal',
    italic: false,
    uppercase: false,
    model: 'text',
    tone: 'auto',
    colors: { text: '#683f1a', bg: '#faf0d0' },
  },
});

/* ── Contrast (WCAG 2.x) ── */

const HEX_RE = /^#[0-9a-f]{6}$/i;

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio of two '#rrggbb' colours, 1 (identical) to 21 (black on
 * white). Anything that is not a '#rrggbb' string counts as unreadable: 1.
 * @param {string} hexA
 * @param {string} hexB
 * @returns {number}
 */
export function contrastRatio(hexA, hexB) {
  if (typeof hexA !== 'string' || typeof hexB !== 'string' || !HEX_RE.test(hexA) || !HEX_RE.test(hexB)) return 1;
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Models that paint their own background: the custom text colour is checked against the custom background. */
export function modelHasBackground(model) {
  return model === 'pill' || model === 'solid';
}

/* ── Normalising ── */

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/* Own properties only: nothing inherited (Object.prototype pollution, __proto__ payloads) is ever read. */
const get = (obj, key) => (isRecord(obj) && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
const pick = (list, value, fallback) => (typeof value === 'string' && list.includes(value) ? value : fallback);

/* Characters that change how a line reads or what it looks like it says, not what it says. */
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;
/* Characters that draw nothing, or only pass for a space or a letter: soft hyphen, Arabic letter mark, the
   Hangul fillers, Mongolian vowel separator, zero-width space, direction marks and embeddings, word joiner
   and the invisible operators after it, Braille blank, BOM, interlinear anchors, and the Tag block (text that
   rides along unseen). The zero-width joiner (200D) and non-joiner (200C) stay: emoji sequences and Indic
   and Persian words need them. */
const INVISIBLE = /[\u00AD\u061C\u115F\u1160\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu;
/* Something a customer can actually see: a letter, a number, punctuation or a symbol (an emoji is one).
   Marks, joiners and variation selectors on their own draw nothing. */
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/** The text without the characters that draw nothing (see INVISIBLE). */
export function stripInvisible(value) {
  return typeof value === 'string' ? value.replace(INVISIBLE, '') : '';
}

/** True when the text has something a customer can see (not just spaces, joiners, marks or invisible characters). */
export function hasVisibleText(value) {
  return typeof value === 'string' && VISIBLE.test(stripInvisible(value));
}

/* A half of an emoji (a broken surrogate pair) is not text: it would not survive being stored. */
function dropLoneSurrogates(s) {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const next = s.charCodeAt(i + 1);
    if (c >= 0xD800 && c <= 0xDBFF) {
      if (next >= 0xDC00 && next <= 0xDFFF) { out += s[i] + s[i + 1]; i += 1; }
    } else if (c < 0xDC00 || c > 0xDFFF) out += s[i];
  }
  return out;
}

/* Plain text, at most DELIVERY_TEXT_MAX UTF-16 units (never cut inside an emoji); empty, or nothing visible → the default. */
function cleanText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const flat = dropLoneSurrogates(value)
    .replace(CONTROLS, ' ')
    .replace(INVISIBLE, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let out = '';
  for (const ch of flat) {
    if (out.length + ch.length > DELIVERY_TEXT_MAX) break;
    out += ch;
  }
  out = out.trim();
  /* Nothing a customer could read (only joiners or marks left) is empty too: the default words. */
  return VISIBLE.test(out) ? out : fallback;
}

function cleanHex(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  return HEX_RE.test(v) ? v.toLowerCase() : fallback;
}

function build(raw, lenient) {
  const d = DEFAULT_DELIVERY_MESSAGE;
  const style = get(raw, 'style');
  const colors = get(style, 'colors');
  const enabled = get(raw, 'enabled');
  const italic = get(style, 'italic');
  const uppercase = get(style, 'uppercase');
  const out = {
    enabled: typeof enabled === 'boolean' ? enabled : d.enabled,
    mode: pick(MODES, get(raw, 'mode'), d.mode),
    barText: cleanText(get(raw, 'barText'), d.barText),
    badgeText: cleanText(get(raw, 'badgeText'), d.badgeText),
    icon: pick(ICONS, get(raw, 'icon'), d.icon),
    style: {
      font: pick(FONTS, get(style, 'font'), d.style.font),
      weight: pick(WEIGHTS, get(style, 'weight'), d.style.weight),
      size: pick(SIZES, get(style, 'size'), d.style.size),
      tracking: pick(TRACKINGS, get(style, 'tracking'), d.style.tracking),
      italic: typeof italic === 'boolean' ? italic : d.style.italic,
      uppercase: typeof uppercase === 'boolean' ? uppercase : d.style.uppercase,
      model: pick(MODELS, get(style, 'model'), d.style.model),
      tone: pick(TONES, get(style, 'tone'), d.style.tone),
      colors: {
        text: cleanHex(get(colors, 'text'), d.style.colors.text),
        bg: cleanHex(get(colors, 'bg'), d.style.colors.bg),
      },
    },
  };
  /* Unreadable custom colours are never applied. (A plain-text, outline or underline model has no
     background of its own: it sits on each surface, so it is judged per surface at draw time.) */
  const s = out.style;
  if (!lenient && s.tone === 'custom' && modelHasBackground(s.model) && contrastRatio(s.colors.text, s.colors.bg) < CONTRAST_MIN) s.tone = 'auto';
  return out;
}

/**
 * Whatever is stored (missing, partial, garbage) → the complete, valid
 * configuration. Never throws; a fresh JSON-safe object each time (nothing is
 * shared with the input or with the defaults); unknown keys are ignored; every
 * choice must be on its allow-list; texts are plain (`<` `>` and invisible
 * characters removed, whitespace collapsed, at most 60 characters, empty →
 * the default); colours are lower-case '#rrggbb' only; a custom tone whose
 * text/background contrast is under 3:1 becomes 'auto'.
 *
 * `lenient` keeps such a custom tone — for the admin form, which must go on
 * showing (and warning about) what the owner is typing. The storefront and the
 * API never use it.
 *
 * @param {unknown} raw
 * @param {{ lenient?: boolean }} [opts]
 */
export function normalizeDeliveryMessage(raw, opts) {
  const lenient = isRecord(opts) && opts.lenient === true;
  try {
    return build(raw, lenient);
  } catch {
    /* A hostile getter or proxy: the defaults are always a safe answer. */
    return build(null, lenient);
  }
}

/** What the server seeds into the page: the normalized configuration of the site settings, as plain JSON. */
export function pickDeliveryMessage(settings) {
  return normalizeDeliveryMessage(get(settings, 'deliveryMessage'));
}

/** True when two configurations draw the same message (compared after normalizing). */
export function sameDeliveryMessage(a, b) {
  return JSON.stringify(normalizeDeliveryMessage(a)) === JSON.stringify(normalizeDeliveryMessage(b));
}

/**
 * What the page should hold once settings arrive — the same rule as nextHeroSlides.
 * Returns `prev` itself (same reference) when nothing should change, so React skips the render:
 *  - `settings` has no delivery message (never saved one);
 *  - `stale`: the settings came from the browser's stored copy while the server already put newer
 *    ones in the HTML;
 *  - it draws the same message as `prev` (`prev` may be null: the defaults).
 * Otherwise the new, normalized configuration.
 *
 * @param {object|null} prev
 * @param {unknown} settings  the site settings (settings.deliveryMessage is read)
 * @param {{ stale?: boolean }} [from]
 */
export function nextDeliveryMessage(prev, settings, { stale = false } = {}) {
  const incoming = get(settings, 'deliveryMessage');
  if (stale || !isRecord(incoming)) return prev;
  return sameDeliveryMessage(prev, incoming) ? prev : normalizeDeliveryMessage(incoming);
}

/**
 * The words to show on a surface, or '' when nothing may be shown.
 * 'bar' (and the strip's 'tagline' state) and 'product' use barText, 'badge' uses badgeText.
 * @param {unknown} config   settings.deliveryMessage (any shape)
 * @param {object} charges   the shop's shipping settings (useCart().charges)
 * @param {'bar'|'tagline'|'badge'|'product'|string} surface
 * @returns {string}
 */
export function deliveryMessageFor(config, charges, surface) {
  const c = normalizeDeliveryMessage(config);
  if (!c.enabled) return '';
  if (c.mode === 'auto' && !deliveryFreeForAll(charges)) return '';
  if (surface === 'badge') return c.badgeText;
  if (surface === 'bar' || surface === 'tagline' || surface === 'product') return c.barText;
  return '';
}
