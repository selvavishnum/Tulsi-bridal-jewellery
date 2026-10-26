/* ─────────────────────────────────────────────
   How the delivery message looks: the Tailwind classes behind each choice the
   owner can make (src/lib/deliveryMessage.js says what the choices are).

   Every class below is a complete, literal string. Tailwind scans
   src/components and src/app for class names and cannot see one that is
   assembled at run time (`text-${tone}-300`) or that lives in src/lib — so the
   tables spell everything out and resolveMessageStyle only *joins* them.
   Colours the owner types (custom tone) are the one exception: they cannot be
   classes, so they go on as inline `style`, and only after they have been
   validated as '#rrggbb' (normalizeDeliveryMessage).

   Four surfaces. 'bar' is the delivery clause of the announcement strip, a
   fixed 32px row; 'tagline' is the same clause in the strip's second state,
   where it runs on inside the tagline's own line; 'badge' is a hero trust badge,
   a fixed 24px row; 'product' is a cell of the product page's trust list.
   Every model on 'bar', 'tagline' and 'badge' is at most h-6 (24px), so none
   can make the row taller — that is the point of the fixed heights (the one
   exception, a long text on the badge, is explained at WRAP_AFTER).

   With the default configuration every table entry resolves to today's markup:
   the choices that equal "the look this surface already has" are the surface's
   own classes (or none), so nothing changes until the owner changes something.

   Pure: no hooks, safe on the server and in the browser.
   ───────────────────────────────────────────── */
import { normalizeDeliveryMessage, modelHasBackground, contrastRatio, SURFACE_COLORS, CONTRAST_MIN } from '@/lib/deliveryMessage';

export const MESSAGE_SURFACES = Object.freeze(['bar', 'tagline', 'badge', 'product']);

/* The truck is drawn with the product page's own line icon (see DeliveryMessage). */
export const LINE_ICON = '🚚';

/* What the surface itself already is, whatever the model. */
const BASE = {
  bar: 'flex-shrink-0',
  tagline: '',
  badge: 'inline-flex h-6 items-center gap-2 whitespace-nowrap',
  product: 'flex items-center gap-2',
};

/* A long text (more than WRAP_AFTER characters) could not fit a 360px phone on one line, and the hero cuts
   what overflows: the badge is then allowed to wrap, and so to grow past 24px, rather than lose its last
   words. (The default texts are shorter, so the default badge is the fixed 24px row.) */
export const WRAP_AFTER = 28;
const BADGE_WRAPPING = 'inline-flex min-h-6 max-w-full items-center gap-2 py-0.5';

/* The model's shape (no colours). Fixed 24px (h-6) wherever the row is fixed. */
const SHAPE = {
  bar: {
    text: '',
    pill: 'h-6 rounded-full px-2.5 leading-6',
    outline: 'h-6 rounded-md border px-2.5 leading-[22px]',
    solid: 'h-6 rounded-md px-2.5 leading-6',
    underline: '',
  },
  tagline: {
    text: '',
    pill: 'inline-block h-6 rounded-full px-2.5 align-middle leading-6',
    outline: 'inline-block h-6 rounded-md border px-2.5 align-middle leading-[22px]',
    solid: 'inline-block h-6 rounded-md px-2.5 align-middle leading-6',
    underline: '',
  },
  badge: {
    text: '',
    pill: 'rounded-full px-3',
    outline: 'rounded-md border px-2.5',
    solid: 'rounded-md px-2.5',
    underline: '',
  },
  product: {
    text: '',
    pill: 'w-fit max-w-full rounded-full px-3 py-1',
    outline: 'w-fit max-w-full rounded-lg border px-3 py-1',
    solid: 'w-fit max-w-full rounded-lg px-3 py-1',
    underline: '',
  },
};

/* The underline accent lives on the words only (never under the icon). */
const UNDERLINE = 'underline decoration-2 underline-offset-4';

/* '' = the surface's own. The strip's clause inherits text-xs and tracking-wide from its paragraph,
   the hero badge is 13px/medium, the product list text-xs: so each default is an empty or existing class. */
const FONT = { sans: '', serif: 'font-serif', classic: 'font-classic' };
const SIZE = {
  bar: { sm: 'text-[11px]', md: '', lg: 'text-[13px]' },
  tagline: { sm: 'text-[11px]', md: '', lg: 'text-[13px]' },
  badge: { sm: 'text-xs', md: 'text-[13px]', lg: 'text-sm' },
  product: { sm: 'text-[11px]', md: 'text-xs', lg: 'text-sm' },
};
const WEIGHT = {
  bar: { normal: '', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' },
  tagline: { normal: '', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' },
  badge: { normal: 'font-medium', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' },
  product: { normal: '', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' },
};
/* Relative to the surface's own spacing: the strip already runs at tracking-wide. */
const TRACKING = {
  bar: { normal: '', wide: 'tracking-wider', wider: 'tracking-widest' },
  tagline: { normal: '', wide: 'tracking-wider', wider: 'tracking-widest' },
  badge: { normal: '', wide: 'tracking-wide', wider: 'tracking-wider' },
  product: { normal: '', wide: 'tracking-wide', wider: 'tracking-wider' },
};

/* Colours: [classes on the wrapper, classes on the words (the underline accent)].
   Every pair is checked at 4.5:1 or better by tests/delivery-message.test.mjs. */

/* 'auto' = the look each surface has today (plain text), and a matching one for the other models. */
const AUTO = {
  bar: {
    text: ['text-gold-200/80', ''],
    pill: ['bg-gold-300/15 text-gold-100', ''],
    outline: ['border-gold-300/50 text-gold-200', ''],
    solid: ['bg-gold-300 text-velvet-950', ''],
    underline: ['text-gold-200/80', 'decoration-gold-400/70'],
  },
  tagline: {
    text: ['', ''],
    pill: ['bg-gold-300/15 text-gold-100', ''],
    outline: ['border-gold-300/50 text-gold-200', ''],
    solid: ['bg-gold-300 text-velvet-950', ''],
    underline: ['', 'decoration-gold-400/70'],
  },
  badge: {
    text: ['text-stone-700', ''],
    pill: ['bg-gold-100 text-gold-900', ''],
    outline: ['border-gold-500 text-gold-900', ''],
    solid: ['bg-[#4A1224] text-white', ''],
    underline: ['text-stone-700', 'decoration-gold-400'],
  },
  product: {
    text: ['text-stone-500', ''],
    pill: ['bg-gold-100 text-gold-900', ''],
    outline: ['border-gold-500 text-gold-900', ''],
    solid: ['bg-[#4A1224] text-white', ''],
    underline: ['text-stone-500', 'decoration-gold-400'],
  },
};

/* The named tones, once for the dark strip and once for the light surfaces. */
const DARK = {
  gold: {
    text: ['text-gold-300', ''],
    pill: ['bg-gold-900 text-gold-100', ''],
    outline: ['border-gold-400 text-gold-200', ''],
    solid: ['bg-gold-300 text-velvet-950', ''],
    underline: ['text-gold-300', 'decoration-gold-400'],
  },
  wine: {
    text: ['text-wine-200', ''],
    pill: ['bg-wine-800 text-wine-50', ''],
    outline: ['border-wine-300 text-wine-100', ''],
    solid: ['bg-wine-600 text-white', ''],
    underline: ['text-wine-200', 'decoration-wine-400'],
  },
  emerald: {
    text: ['text-emerald-300', ''],
    pill: ['bg-emerald-900 text-emerald-50', ''],
    outline: ['border-emerald-400 text-emerald-200', ''],
    solid: ['bg-emerald-700 text-white', ''],
    underline: ['text-emerald-300', 'decoration-emerald-500'],
  },
  ivory: {
    text: ['text-ivory-200', ''],
    pill: ['bg-velvet-700 text-ivory-100', ''],
    outline: ['border-ivory-300 text-ivory-100', ''],
    solid: ['bg-ivory-100 text-wine-950', ''],
    underline: ['text-ivory-200', 'decoration-ivory-400'],
  },
  night: {
    text: ['text-slate-200', ''],
    pill: ['bg-slate-800 text-slate-100', ''],
    outline: ['border-slate-400 text-slate-100', ''],
    solid: ['bg-slate-900 text-gold-200 ring-1 ring-slate-600', ''],
    underline: ['text-slate-200', 'decoration-slate-400'],
  },
};
const LIGHT = {
  gold: {
    text: ['text-gold-800', ''],
    pill: ['bg-gold-100 text-gold-900', ''],
    outline: ['border-gold-500 text-gold-900', ''],
    solid: ['bg-gold-400 text-velvet-950', ''],
    underline: ['text-gold-800', 'decoration-gold-400'],
  },
  wine: {
    text: ['text-wine-800', ''],
    pill: ['bg-wine-100 text-wine-900', ''],
    outline: ['border-wine-700 text-wine-800', ''],
    solid: ['bg-wine-700 text-white', ''],
    underline: ['text-wine-800', 'decoration-wine-400'],
  },
  emerald: {
    text: ['text-emerald-800', ''],
    pill: ['bg-emerald-100 text-emerald-900', ''],
    outline: ['border-emerald-600 text-emerald-800', ''],
    solid: ['bg-emerald-700 text-white', ''],
    underline: ['text-emerald-800', 'decoration-emerald-500'],
  },
  ivory: {
    text: ['text-velvet-700', ''],
    pill: ['bg-ivory-300 text-velvet-800', ''],
    outline: ['border-velvet-300 text-velvet-800', ''],
    solid: ['bg-ivory-400 text-velvet-900', ''],
    underline: ['text-velvet-700', 'decoration-ivory-400'],
  },
  night: {
    text: ['text-slate-800', ''],
    pill: ['bg-slate-200 text-slate-900', ''],
    outline: ['border-slate-700 text-slate-900', ''],
    solid: ['bg-slate-900 text-gold-200', ''],
    underline: ['text-slate-800', 'decoration-slate-500'],
  },
};
const NAMED = { bar: DARK, tagline: DARK, badge: LIGHT, product: LIGHT };

/* The icon's own classes, by surface. The strip's icon follows the words (a space, no class);
   the badge's is today's `text-base leading-none`; the product page's line icon is its green. */
const ICON = {
  bar: '',
  tagline: '',
  badge: 'text-base leading-none',
  productLine: 'flex-shrink-0',
  productLineGreen: 'text-green-500 flex-shrink-0',
  productEmoji: 'flex-shrink-0 leading-none',
};

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/* Every table, for the tests (and nothing else): frozen, so they cannot be edited at run time. */
export const MESSAGE_STYLE_MAPS = deepFreeze({ BASE, BADGE_WRAPPING, SHAPE, UNDERLINE, FONT, SIZE, WEIGHT, TRACKING, AUTO, DARK, LIGHT, ICON });

const isSurface = (s) => MESSAGE_SURFACES.includes(s);

/**
 * The classes (and, for custom colours, the inline style) that draw the message on one surface.
 * The configuration is normalized first, so a raw stored value is as safe as a clean one.
 *
 * @param {unknown} config   settings.deliveryMessage (any shape)
 * @param {'bar'|'tagline'|'badge'|'product'} surface  unknown surfaces are drawn as 'product'
 * @param {{ long?: boolean }} [opts]  long: the text is longer than WRAP_AFTER characters (the hero badge may then wrap)
 * @returns {{
 *   wrapperClass: string,  // the shape: font, size, spacing, colours — also the surface's own layout classes
 *   textClass: string,     // the words only: the underline accent ('' = no extra element for the words)
 *   wrapperStyle: Record<string, string>,  // custom colours only ('#rrggbb' validated); {} otherwise
 *   iconClass: string,
 *   iconKind: 'emoji'|'line'|'none',  // 'line' = the product page's own truck icon
 *   icon: string,          // the emoji ('' = none)
 *   iconAfter: boolean,    // the strip puts the icon after the words, the others before
 * }}
 */
export function resolveMessageStyle(config, surface, { long = false } = {}) {
  const c = normalizeDeliveryMessage(config);
  const s = isSurface(surface) ? surface : 'product';
  const { style } = c;
  const { model } = style;

  /* A custom colour that cannot be read on this surface is not used on it (the shapes with their own
     background were already checked against it when the configuration was normalized). */
  let tone = style.tone;
  if (tone === 'custom' && !modelHasBackground(model) && contrastRatio(style.colors.text, SURFACE_COLORS[s === 'tagline' ? 'bar' : s]) < CONTRAST_MIN) tone = 'auto';

  let colorClass = '';
  let accentClass = '';
  const wrapperStyle = {};
  if (tone === 'custom') {
    wrapperStyle.color = style.colors.text;
    if (modelHasBackground(model)) wrapperStyle.backgroundColor = style.colors.bg;
    if (model === 'outline') wrapperStyle.borderColor = style.colors.text;
  } else {
    [colorClass, accentClass] = (tone === 'auto' ? AUTO[s] : NAMED[s][tone])[model];
  }

  const wrapperClass = [
    s === 'badge' && long ? BADGE_WRAPPING : BASE[s], SHAPE[s][model], FONT[style.font], SIZE[s][style.size], TRACKING[s][style.tracking],
    WEIGHT[s][style.weight], style.italic ? 'italic' : '', style.uppercase ? 'uppercase' : '', colorClass,
  ].filter(Boolean).join(' ');
  const textClass = model === 'underline' ? [UNDERLINE, accentClass].filter(Boolean).join(' ') : '';

  /* The strip's second state carries no icon (as today: the clause is followed by "·" and the phone). */
  let iconKind = 'none';
  let iconClass = '';
  if (c.icon && s !== 'tagline') {
    if (s === 'product') {
      iconKind = c.icon === LINE_ICON ? 'line' : 'emoji';
      if (iconKind === 'emoji') iconClass = ICON.productEmoji;
      else iconClass = tone === 'auto' && (model === 'text' || model === 'underline') ? ICON.productLineGreen : ICON.productLine;
    } else {
      iconKind = 'emoji';
      iconClass = ICON[s];
    }
  }

  return { wrapperClass, textClass, wrapperStyle, iconClass, iconKind, icon: iconKind === 'none' ? '' : c.icon, iconAfter: s === 'bar' || s === 'tagline' };
}
