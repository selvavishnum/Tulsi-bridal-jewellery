/* ─────────────────────────────────────────────
   The logic behind the admin's "Delivery message" card
   (src/components/admin/DeliveryMessagePanel.jsx), kept apart from the React
   markup so it can be tested directly: what a typed value turns into, what
   the storefront would do with it right now, and what to tell the owner
   about the colours they picked.

   The card is controlled: `value` is settings.deliveryMessage as the page
   holds it (missing, partial or garbage on a shop that never saved one) and
   every change hands the page the whole new object, saved with the page's
   Save Settings button. The server then normalizes it again (the storefront
   never trusts what the form held).

   Everything the owner reads that a customer never does is here and not in
   src/lib/deliveryMessage.js — the option labels and hints, the shipping
   warning, the colour advice — so the storefront (which loads that file on
   every page) does not carry it. Only the admin page imports this module.

   Pure — no React, no browser — safe in tests.
   ───────────────────────────────────────────── */
import {
  DELIVERY_TEXT_MAX, DEFAULT_DELIVERY_MESSAGE, SURFACE_COLORS, CONTRAST_MIN,
  normalizeDeliveryMessage, deliveryMessageFor, contrastRatio, modelHasBackground, stripInvisible,
} from '@/lib/deliveryMessage';
import { deliveryFreeForAll, freeShippingLine } from '@/lib/storeCharges';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/* What the owner can pick, with the words the controls show. The `value`s are exactly the lib's
   DELIVERY_CHOICES (a test keeps them in step); `swatch` is [text colour, background colour] of a tone as a filled badge. */
export const DELIVERY_OPTIONS = deepFreeze({
  fonts: [
    { value: 'sans', label: 'Modern', hint: 'Clean sans-serif, like the rest of the site' },
    { value: 'serif', label: 'Elegant', hint: 'The jewellery-style serif of the headings (it runs small: try Large)' },
    { value: 'classic', label: 'Classic', hint: 'Georgia-style serif, easy to read at small sizes' },
  ],
  weights: [
    { value: 'normal', label: 'Regular' },
    { value: 'medium', label: 'Medium' },
    { value: 'semibold', label: 'Semi-bold' },
    { value: 'bold', label: 'Bold' },
  ],
  sizes: [
    { value: 'sm', label: 'Small' },
    { value: 'md', label: 'Standard' },
    { value: 'lg', label: 'Large' },
  ],
  trackings: [
    { value: 'normal', label: 'Standard' },
    { value: 'wide', label: 'Wide' },
    { value: 'wider', label: 'Extra wide' },
  ],
  models: [
    { value: 'text', label: 'Plain text', hint: 'Just the words: the current look' },
    { value: 'pill', label: 'Soft pill', hint: 'A tinted, fully rounded label' },
    { value: 'outline', label: 'Outline', hint: 'A thin bordered label' },
    { value: 'solid', label: 'Solid badge', hint: 'A filled badge with contrasting text' },
    { value: 'underline', label: 'Underlined', hint: 'Text with a coloured underline accent' },
  ],
  tones: [
    { value: 'auto', label: 'Automatic', swatch: ['#44403c', '#faf8f5'] },
    { value: 'gold', label: 'Gold', swatch: ['#1a0b05', '#e4b040'] },
    { value: 'wine', label: 'Wine', swatch: ['#ffffff', '#8b1a4a'] },
    { value: 'emerald', label: 'Emerald', swatch: ['#ffffff', '#047857'] },
    { value: 'ivory', label: 'Ivory', swatch: ['#2d1209', '#e0d3bf'] },
    { value: 'night', label: 'Night', swatch: ['#f4dfa0', '#0f172a'] },
    { value: 'custom', label: 'Custom colours', swatch: ['#683f1a', '#faf0d0'] },
  ],
  icons: [
    { value: '🚚', label: 'Truck' },
    { value: '✨', label: 'Sparkles' },
    { value: '🎁', label: 'Gift' },
    { value: '✅', label: 'Tick' },
    { value: '💛', label: 'Heart' },
    { value: '', label: 'No icon' },
  ],
  modes: [
    { value: 'auto', label: 'Smart (recommended)', hint: 'Shown only while shipping really is free on every order' },
    { value: 'always', label: 'Always', hint: 'Shown whenever it is switched on: you are responsible for the words being true' },
  ],
});

/* WCAG: 4.5:1 reads comfortably at this size (the lib's CONTRAST_MIN, 3:1, is where it stops being used at all). */
export const CONTRAST_GOOD = 4.5;

/* The words drawn in the small samples (model cards): short enough for a phone-width card. */
export const SAMPLE_WORDS = 'Free delivery';

/* How the owner calls the places the message appears. */
export const SURFACE_NAMES = Object.freeze({ bar: 'top strip', badge: 'home page badge', product: 'product page' });

const SURFACES = ['bar', 'badge', 'product'];
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** The words as the owner types them: no `<` `>`, no line breaks, no invisible characters (a paste can carry them), at most 60 characters (never cut inside an emoji). Spaces are kept — a trailing one is part of typing the next word. */
export function typedText(value) {
  const flat = stripInvisible(value).replace(/[<>]/g, '').replace(/[\r\n\t]/g, ' ');
  let out = '';
  for (const ch of flat) {
    if (out.length + ch.length > DELIVERY_TEXT_MAX) break;
    out += ch;
  }
  return out;
}

/**
 * The form's working copy of whatever is stored: complete and valid in every choice, but (a) a
 * custom colour pair that is hard to read is kept, so the form can go on warning about it instead
 * of snapping back to Automatic while the owner types, and (b) the two texts stay exactly as typed
 * — even empty — so the field never fights the typist. (Empty means "use the default words": the
 * storefront and the server do that, see normalizeDeliveryMessage.)
 */
export function editableConfig(value) {
  const base = normalizeDeliveryMessage(value, { lenient: true });
  const raw = isRecord(value) ? value : {};
  const own = (key) => (Object.prototype.hasOwnProperty.call(raw, key) && typeof raw[key] === 'string' ? typedText(raw[key]) : base[key]);
  return { ...base, barText: own('barText'), badgeText: own('badgeText') };
}

/** `patch` is merged into the top level (enabled, mode, icon, barText, badgeText). Returns the whole new configuration. */
export function changeConfig(value, patch) {
  return { ...editableConfig(value), ...patch };
}

/** `patch` is merged into style (font, weight, size, tracking, italic, uppercase, model, tone). */
export function changeStyle(value, patch) {
  const c = editableConfig(value);
  return { ...c, style: { ...c.style, ...patch } };
}

/** One of the two custom colours ('text' | 'bg'); `hex` must already be '#rrggbb'. */
export function changeColor(value, which, hex) {
  const c = editableConfig(value);
  return { ...c, style: { ...c.style, colors: { ...c.style.colors, [which === 'bg' ? 'bg' : 'text']: hex } } };
}

/** What the owner typed in a colour box → '#rrggbb' (lower case), or null. Accepts a missing '#' and the 3-digit short form ("fa0"). */
export function parseHexInput(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : null;
}

/** True while the box holds a complete colour that can be applied as the owner types (6 digits; the short form waits for the end of typing). */
export function isCompleteHex(input) {
  return typeof input === 'string' && /^#?[0-9a-f]{6}$/i.test(input.trim());
}

/** What the colour box says while the owner is still typing (a neutral hint: an unfinished code is not a mistake). */
export const COLOR_TYPING_HINT = 'Type 6 letters or numbers after the #, like #683f1a.';

/**
 * What the colour box says once the owner has left it holding something that is not a colour code: the
 * colour in use stays, and this says so. `typed` is what was in the box.
 * @param {unknown} typed
 * @returns {string}
 */
export function colorRefusal(typed) {
  const shown = typeof typed === 'string' ? typed.trim() : '';
  const what = shown ? `“${shown}” is not a colour code, so` : 'No colour code was typed, so';
  return `${what} the colour was not changed. Use a code like #683f1a (6 letters or numbers after the #).`;
}

/* The look = icon + every style choice. (The switch, the "show when" rule and the words are not part of it.) */
const lookOf = (c) => JSON.stringify({ icon: c.icon, style: c.style });

/** True when the icon and every style choice are the original ones (the "Reset look" button has nothing to do). */
export function lookIsDefault(value) {
  return lookOf(editableConfig(value)) === lookOf(DEFAULT_DELIVERY_MESSAGE);
}

/** The original icon, font, shape and colours; the switch, the rule and the words stay as they are. */
export function resetLook(value) {
  const c = editableConfig(value);
  return { ...c, icon: DEFAULT_DELIVERY_MESSAGE.icon, style: clone(DEFAULT_DELIVERY_MESSAGE.style) };
}

/**
 * A small fixed sample of the current look in another model (or tone), for the option cards: the
 * sample words must fit a card two to a row on a 360px phone, so there is no icon and size, letter
 * spacing and capitals stay small and standard; font, weight, italic and colours are the owner's.
 */
export function sampleConfig(value, patch) {
  const c = editableConfig(value);
  return { ...c, icon: '', style: { ...c.style, size: 'sm', tracking: 'normal', uppercase: false, ...patch } };
}

/**
 * What the storefront would do with this configuration right now, and (when it would show
 * nothing) why, in the owner's words.
 *   live    — the message would be drawn
 *   reason  — '' when live
 *   config  — the configuration the storefront would use (strict normalize)
 *   words   — the text of each place, whether or not it is shown now (the preview draws them dimmed)
 */
export function previewState(value, charges) {
  const config = normalizeDeliveryMessage(value);
  const live = deliveryMessageFor(config, charges, 'bar') !== '';
  let reason = '';
  if (!config.enabled) {
    reason = 'Hidden on the storefront right now because the message is switched off. Turn the switch on (top right of this card) to show it.';
  } else if (!live) {
    reason = `Hidden on the storefront right now because “Smart” shows it only while delivery is free on every order, and your shipping settings still charge for delivery (${freeShippingLine(charges)}). To show it anyway, choose “Always” under “Show when”.`;
  }
  return { live, reason, config, words: { bar: config.barText, badge: config.badgeText, product: config.barText } };
}

const ratioText = (n) => n.toFixed(2);
const listOf = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * What to tell the owner about their own (custom) colours, as { level: 'unusable'|'low', text }
 * lines — red for "won't be used", amber for "hard to read". Empty when the tone is not Custom
 * or everything reads comfortably. A shape with its own background (Soft pill, Solid badge) is
 * judged text against background, the same on every place; the others sit on each place's own
 * ground, so a pale text colour can be fine on the dark top strip and invisible on the home page.
 */
export function contrastNotes(value) {
  const c = normalizeDeliveryMessage(value, { lenient: true });
  const { tone, model } = c.style;
  if (tone !== 'custom') return [];
  if (modelHasBackground(model)) {
    const { level, ratio } = contrastNote(c, 'bar');
    if (level === 'ok') return [];
    return [{
      level,
      text: level === 'unusable'
        ? `The text and the background are too close in colour (${ratioText(ratio)}:1), so these colours will not be used: customers see the Automatic look instead. Pick colours that stand further apart.`
        : `The text is hard to read on this background (${ratioText(ratio)}:1). Colours that stand further apart read better.`,
    }];
  }
  const notes = [];
  for (const level of ['unusable', 'low']) {
    const hits = SURFACES.map((s) => ({ s, ...contrastNote(c, s) })).filter((n) => n.level === level);
    if (!hits.length) continue;
    const where = listOf(hits.map((n) => `${SURFACE_NAMES[n.s]} (${ratioText(n.ratio)}:1)`));
    notes.push({
      level,
      text: level === 'unusable'
        ? `This text colour can hardly be seen on the ${where}, so the Automatic look is used there instead.`
        : `This text colour is hard to read on the ${where}. A darker or lighter colour reads better.`,
    });
  }
  return notes;
}

/**
 * For the admin: '' or a warning, when the message is on in 'always' mode but the shipping settings
 * still charge for delivery (a customer could see "free" and be charged at checkout).
 * @param {unknown} config
 * @param {object} charges
 * @returns {string}
 */
export function deliveryMismatch(config, charges) {
  const c = normalizeDeliveryMessage(config);
  if (!c.enabled || c.mode !== 'always' || deliveryFreeForAll(charges)) return '';
  return `Your shipping settings still charge for delivery (${freeShippingLine(charges)}), so a customer can read this message and then be charged at checkout. Choose “Smart”, make shipping free in Store Settings, or word the message so it stays true.`;
}

/**
 * How readable the custom colours are, for the admin hints, on one surface:
 * 'ok' (4.5:1 or more), 'low' (3 to 4.5: hard to read), 'unusable' (under 3: not used there).
 * A model with its own background (pill, solid) is judged text against background; the others
 * against the surface they sit on. Any other tone is a curated, already-checked pair: 'ok'.
 * Judges what the owner is typing (lenient), not what the storefront would end up using.
 * `ratio` is rounded down to two decimals, so it never promises more than there is.
 *
 * @param {unknown} config
 * @param {'bar'|'tagline'|'badge'|'product'} surface
 * @returns {{ level: 'ok'|'low'|'unusable', ratio: number }}
 */
export function contrastNote(config, surface) {
  const { style } = normalizeDeliveryMessage(config, { lenient: true });
  let ratio;
  if (style.tone === 'custom') {
    const ground = modelHasBackground(style.model)
      ? style.colors.bg
      : SURFACE_COLORS[surface === 'tagline' ? 'bar' : surface] || SURFACE_COLORS.product;
    ratio = contrastRatio(style.colors.text, ground);
  } else {
    const [text, bg] = DELIVERY_OPTIONS.tones.find((t) => t.value === style.tone).swatch;
    ratio = contrastRatio(text, bg);
  }
  const level = style.tone !== 'custom' || ratio >= CONTRAST_GOOD ? 'ok' : ratio >= CONTRAST_MIN ? 'low' : 'unusable';
  return { level, ratio: Math.floor(ratio * 100) / 100 };
}
