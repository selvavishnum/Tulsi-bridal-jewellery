/* ─────────────────────────────────────────────
   The delivery message ("Free Delivery across India" / "Free Nationwide
   Shipping") the owner can switch off, reword and restyle:

     src/lib/deliveryMessage.js                  the configuration, normalising, the truth table
     src/components/admin/deliveryMessageAdmin.js the owner-facing words (labels, the shipping warning, the colour advice)
     src/components/ui/deliveryMessageStyle.js   the literal Tailwind classes per choice
     src/components/ui/DeliveryMessage.jsx       the one component every surface (and the admin preview) draws

   The component is JSX, which Node can't load, so it is transpiled here with
   sucrase (already in node_modules via tailwindcss) and run with react-dom/server,
   its imports wired by hand (the real FiTruck, the real style module). The class
   tables are compiled with the repo's real Tailwind config, so a typo'd class, a
   missing colour or a class that Tailwind could not see would fail here.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as lib from '../src/lib/deliveryMessage.js';
import * as adminLib from '../src/components/admin/deliveryMessageAdmin.js';
import * as styleLib from '../src/components/ui/deliveryMessageStyle.js';
import { DEFAULT_CHARGES, FREE_DELIVERY_LINE } from '../src/lib/storeCharges.js';
import { pickHeroSlides, nextHeroSlides } from '../src/lib/heroSlides.js';

const {
  DELIVERY_TEXT_MAX, DEFAULT_DELIVERY_MESSAGE, DELIVERY_CHOICES, SURFACE_COLORS, CONTRAST_MIN,
  normalizeDeliveryMessage, pickDeliveryMessage, sameDeliveryMessage, nextDeliveryMessage,
  deliveryMessageFor, contrastRatio, modelHasBackground,
} = lib;
/* Labels, the shipping warning and the colour advice are the admin's (kept out of the storefront's first-load JavaScript). */
const { DELIVERY_OPTIONS, CONTRAST_GOOD, deliveryMismatch, contrastNote } = adminLib;
const { resolveMessageStyle, MESSAGE_STYLE_MAPS, MESSAGE_SURFACES, WRAP_AFTER } = styleLib;

const require = createRequire(import.meta.url);
const read = (p) => readFileSync(path.resolve(p), 'utf8');
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so DeliveryMessage.jsx cannot be transpiled for node --test';
const React = require('react');
const { renderToStaticMarkup, renderToString } = require('react-dom/server');

function loadComponent() {
  const file = path.resolve('src/components/ui/DeliveryMessage.jsx');
  const { code } = sucrase.transform(read('src/components/ui/DeliveryMessage.jsx'), {
    transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file,
  });
  const deps = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-icons/fi': require('react-icons/fi'),
    './deliveryMessageStyle': styleLib,
  };
  const req = (id) => {
    if (!Object.hasOwn(deps, id)) throw new Error(`DeliveryMessage.jsx imports ${id}: add a stub for it in this test`);
    return deps[id];
  };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, req, mod);
  return mod.exports.default;
}
const DeliveryMessage = sucrase ? loadComponent() : null;
const draw = (props, { stringify = renderToStaticMarkup } = {}) => stringify(React.createElement(DeliveryMessage, props));

const values = (key) => DELIVERY_OPTIONS[key].map((o) => o.value);
const MODELS = values('models');
const TONES = values('tones');
const NAMED = TONES.filter((t) => t !== 'auto' && t !== 'custom');
const SURFACES = [...MESSAGE_SURFACES];
const FREE = { ...DEFAULT_CHARGES, enable_shipping_fee: false };
const PAID = DEFAULT_CHARGES;
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ═══ The configuration ═══ */

describe('defaults and options', () => {
  test('the defaults are the full, frozen configuration, with the shop’s current words', () => {
    assert.deepEqual(DEFAULT_DELIVERY_MESSAGE, {
      enabled: true,
      mode: 'auto',
      barText: 'Free Delivery across India',
      badgeText: 'Free Nationwide Shipping',
      icon: '🚚',
      style: {
        font: 'sans', weight: 'normal', size: 'md', tracking: 'normal', italic: false, uppercase: false,
        model: 'text', tone: 'auto', colors: { text: '#683f1a', bg: '#faf0d0' },
      },
    });
    assert.equal(DEFAULT_DELIVERY_MESSAGE.barText, FREE_DELIVERY_LINE, 'one source for the strip’s words');
    for (const v of [DEFAULT_DELIVERY_MESSAGE, DEFAULT_DELIVERY_MESSAGE.style, DEFAULT_DELIVERY_MESSAGE.style.colors, DELIVERY_CHOICES, DELIVERY_CHOICES.fonts, DELIVERY_OPTIONS, DELIVERY_OPTIONS.fonts, DELIVERY_OPTIONS.fonts[0], DELIVERY_OPTIONS.tones[0].swatch, SURFACE_COLORS]) {
      assert.ok(Object.isFrozen(v));
    }
    assert.equal(DELIVERY_TEXT_MAX, 60);
  });

  test('options: every list has unique values, the defaults are among them, every label is words, tones carry two valid swatch colours', () => {
    const d = DEFAULT_DELIVERY_MESSAGE;
    const expected = {
      fonts: ['sans', 'serif', 'classic'], weights: ['normal', 'medium', 'semibold', 'bold'], sizes: ['sm', 'md', 'lg'],
      trackings: ['normal', 'wide', 'wider'], models: ['text', 'pill', 'outline', 'solid', 'underline'],
      tones: ['auto', 'gold', 'wine', 'emerald', 'ivory', 'night', 'custom'], icons: ['🚚', '✨', '🎁', '✅', '💛', ''], modes: ['auto', 'always'],
    };
    for (const [key, list] of Object.entries(expected)) assert.deepEqual(values(key), list, key);
    for (const [key, list] of Object.entries(DELIVERY_OPTIONS)) {
      assert.equal(new Set(values(key)).size, list.length, `${key}: unique`);
      for (const o of list) assert.ok(typeof o.label === 'string' && o.label.trim(), `${key}/${o.value} has a label`);
    }
    const defaults = { fonts: d.style.font, weights: d.style.weight, sizes: d.style.size, trackings: d.style.tracking, models: d.style.model, tones: d.style.tone, icons: d.icon, modes: d.mode };
    for (const [key, v] of Object.entries(defaults)) assert.ok(values(key).includes(v), `${key} default`);
    /* The admin's labelled options and the lib's plain allow-lists are one list (the lib enforces, the admin shows). */
    assert.deepEqual(Object.keys(DELIVERY_OPTIONS), Object.keys(DELIVERY_CHOICES));
    for (const key of Object.keys(DELIVERY_CHOICES)) assert.deepEqual(values(key), [...DELIVERY_CHOICES[key]], `${key}: the admin shows exactly what the lib accepts`);
    for (const key of Object.keys(DELIVERY_CHOICES)) for (const v of DELIVERY_CHOICES[key]) assert.ok(typeof v === 'string', key);
    for (const m of DELIVERY_OPTIONS.models.concat(DELIVERY_OPTIONS.modes)) assert.ok(m.hint, `${m.value} explains itself`);
    for (const t of DELIVERY_OPTIONS.tones) {
      assert.equal(t.swatch.length, 2);
      assert.ok(t.swatch.every((h) => /^#[0-9a-f]{6}$/.test(h)), t.value);
    }
  });

  test('surface colours are valid hex, and the strip’s is the lightest stop of its dark gradient', () => {
    assert.deepEqual(Object.keys(SURFACE_COLORS), ['bar', 'badge', 'product']);
    for (const hex of Object.values(SURFACE_COLORS)) assert.match(hex, /^#[0-9a-f]{6}$/i);
    assert.equal(SURFACE_COLORS.badge.toLowerCase(), '#faf8f5');
    assert.equal(SURFACE_COLORS.product, '#ffffff');
    const colors = require('../tailwind.config.js').theme.extend.colors;
    assert.equal(SURFACE_COLORS.bar, colors.wine[950], 'bg-gradient-to-r from-velvet-950 via-wine-950: the lightest stop is the worst case for light text');
  });
});

describe('normalizeDeliveryMessage', () => {
  const JUNK = [undefined, null, '', 'x', '{"enabled":false}', 0, 1, NaN, -1, true, false, [], [1, 2], [{ enabled: false }], () => ({ enabled: false }), Symbol('s'), 10n, new Date(0), new Map([['enabled', false]]), /x/];

  test('anything that is not an object gives exactly the defaults', () => {
    for (const raw of JUNK) assert.deepEqual(normalizeDeliveryMessage(raw), DEFAULT_DELIVERY_MESSAGE, String(typeof raw));
    assert.deepEqual(normalizeDeliveryMessage({}), DEFAULT_DELIVERY_MESSAGE);
    assert.deepEqual(normalizeDeliveryMessage({ style: null }), DEFAULT_DELIVERY_MESSAGE);
    assert.deepEqual(normalizeDeliveryMessage({ style: [] }), DEFAULT_DELIVERY_MESSAGE);
    assert.deepEqual(normalizeDeliveryMessage({ style: 'bold', colors: 'red' }), DEFAULT_DELIVERY_MESSAGE);
    assert.deepEqual(normalizeDeliveryMessage({ style: { colors: [] } }), DEFAULT_DELIVERY_MESSAGE);
  });

  test('the result is complete, in a fixed key order, JSON-safe, and shares nothing with the input or the defaults', () => {
    const input = { enabled: false, mode: 'always', barText: 'a', badgeText: 'b', icon: '✨', style: { font: 'serif', colors: { text: '#AABBCC', bg: '#112233' } }, extra: { x: 1 } };
    const out = normalizeDeliveryMessage(input);
    assert.deepEqual(Object.keys(out), ['enabled', 'mode', 'barText', 'badgeText', 'icon', 'style']);
    assert.deepEqual(Object.keys(out.style), ['font', 'weight', 'size', 'tracking', 'italic', 'uppercase', 'model', 'tone', 'colors']);
    assert.deepEqual(Object.keys(out.style.colors), ['text', 'bg']);
    assert.deepEqual(JSON.parse(JSON.stringify(out)), out, 'survives the server → client prop boundary');
    assert.ok(!('extra' in out));
    assert.notEqual(out.style, input.style);
    assert.notEqual(out.style.colors, input.style.colors);
    assert.equal(input.style.colors.text, '#AABBCC', 'the input is not modified');
    /* Mutating a result touches neither the defaults nor the next result. */
    const a = normalizeDeliveryMessage(null);
    a.style.colors.text = '#000000';
    a.barText = 'changed';
    a.style.tone = 'custom';
    assert.deepEqual(normalizeDeliveryMessage(null), DEFAULT_DELIVERY_MESSAGE);
    assert.equal(DEFAULT_DELIVERY_MESSAGE.barText, 'Free Delivery across India');
    assert.notEqual(normalizeDeliveryMessage(null), normalizeDeliveryMessage(null));
    assert.ok(!Object.isFrozen(a), 'callers may spread and edit a result');
  });

  test('idempotent: normalizing a normalized value changes nothing', () => {
    const inputs = [null, { barText: ' <b> Hi </b> ', style: { tone: 'custom', model: 'pill', colors: { text: '#FFFFFF', bg: '#ffffff' } } }, { style: { tone: 'custom', colors: { text: '#ABCDEF' } } }, { icon: '🎁', mode: 'always', style: { italic: true, uppercase: true, model: 'solid', tone: 'gold' } }];
    for (const raw of inputs) {
      const once = normalizeDeliveryMessage(raw);
      assert.deepEqual(normalizeDeliveryMessage(once), once);
      assert.deepEqual(normalizeDeliveryMessage(clone(once)), once);
    }
  });

  test('every choice must be on its allow-list; anything else is the default, never a guess', () => {
    const fields = [
      [(v) => ({ mode: v }), (o) => o.mode, 'modes', 'auto'],
      [(v) => ({ icon: v }), (o) => o.icon, 'icons', '🚚'],
      [(v) => ({ style: { font: v } }), (o) => o.style.font, 'fonts', 'sans'],
      [(v) => ({ style: { weight: v } }), (o) => o.style.weight, 'weights', 'normal'],
      [(v) => ({ style: { size: v } }), (o) => o.style.size, 'sizes', 'md'],
      [(v) => ({ style: { tracking: v } }), (o) => o.style.tracking, 'trackings', 'normal'],
      [(v) => ({ style: { model: v } }), (o) => o.style.model, 'models', 'text'],
      [(v) => ({ style: { tone: v } }), (o) => o.style.tone, 'tones', 'auto'],
    ];
    const bad = ['SANS', ' sans', 'serif ', 'bolder', 'x', '<script>', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'url(x)', 7, true, null, [], ['serif'], {}, '🚚🚚', '🚚 ', 'truck'];
    for (const [make, read, key, dflt] of fields) {
      for (const v of values(key)) assert.equal(read(normalizeDeliveryMessage(make(v))), v, `${key}: ${JSON.stringify(v)} is accepted`);
      for (const v of bad) {
        /* '' is a real choice for icons (no icon), and not for the others. */
        assert.equal(read(normalizeDeliveryMessage(make(v))), dflt, `${key}: ${JSON.stringify(v)} → ${dflt}`);
      }
    }
    assert.equal(normalizeDeliveryMessage({ icon: '' }).icon, '', 'no icon is a valid choice');
    assert.equal(normalizeDeliveryMessage({ icon: undefined }).icon, '🚚');
  });

  test('toggles are real booleans only', () => {
    for (const v of [true, false]) {
      assert.equal(normalizeDeliveryMessage({ enabled: v }).enabled, v);
      assert.equal(normalizeDeliveryMessage({ style: { italic: v, uppercase: v } }).style.italic, v);
      assert.equal(normalizeDeliveryMessage({ style: { italic: v, uppercase: v } }).style.uppercase, v);
    }
    for (const v of ['false', 'true', 0, 1, null, 'on', [], {}]) {
      assert.equal(normalizeDeliveryMessage({ enabled: v }).enabled, true, `enabled ${JSON.stringify(v)} → default true`);
      assert.equal(normalizeDeliveryMessage({ style: { italic: v, uppercase: v } }).style.italic, false);
      assert.equal(normalizeDeliveryMessage({ style: { italic: v, uppercase: v } }).style.uppercase, false);
    }
  });

  test('text with nothing a customer can see is empty: invisible characters, fillers, joiners and marks give the default words, not an empty label', () => {
    const bar = (v) => normalizeDeliveryMessage({ barText: v }).barText;
    const badge = (v) => normalizeDeliveryMessage({ badgeText: v }).badgeText;
    const BLANKS = {
      'zero-width non-joiner': '\u200c', 'zero-width joiner': '\u200d', 'zero-width space': '\u200b', 'invisible separator': '\u2063', 'invisible times': '\u2062',
      'function application': '\u2061', 'invisible plus': '\u2064', 'word joiner': '\u2060', 'Arabic letter mark': '\u061c', 'Hangul filler': '\u3164',
      'Hangul choseong filler': '\u115f', 'Hangul jungseong filler': '\u1160', 'halfwidth Hangul filler': '\uffa0', 'Braille blank': '\u2800',
      'Tag letters': '\u{E0041}\u{E0042}', 'Tag block edges': '\u{E0000}\u{E007F}', 'soft hyphen': '\u00ad', 'Mongolian vowel separator': '\u180e',
      'BOM': '\ufeff', 'interlinear anchor': '\ufff9', 'combining grapheme joiner': '\u034f', 'a lone accent': '\u0301', 'emoji selector': '\ufe0f',
      'text selector': '\ufe0e', 'Khmer inherent vowel': '\u17b4', 'joiners around spaces': ' \u200c \u200d ', 'a mix of all of them': '\u2800\u3164 \u200b\u200c\u{E0041}\u00ad',
    };
    for (const [name, blank] of Object.entries(BLANKS)) {
      assert.equal(bar(blank), 'Free Delivery across India', name);
      assert.equal(badge(blank), 'Free Nationwide Shipping', name);
      assert.equal(bar(blank.repeat(70)), 'Free Delivery across India', `${name}, long`);
      assert.deepEqual(normalizeDeliveryMessage({ barText: blank, badgeText: blank }), DEFAULT_DELIVERY_MESSAGE, `${name}: the whole configuration is the default`);
    }
    /* What is left after cutting at 60 is judged, not what was typed. */
    assert.equal(bar(`${'\u200d'.repeat(70)}x`), 'Free Delivery across India');
    /* Hidden text riding along with visible words is removed; the words stay. */
    assert.equal(bar('Free\u2800 ship\u{E0041}\u{E0042}ping\u3164'), 'Free shipping');
    assert.equal(bar('\u2063Free\u061c \u180edelivery'), 'Free delivery');
    /* Real text that needs a joiner or non-joiner is untouched: Persian, Indic, emoji sequences, flags, keycaps. */
    for (const real of ['می\u200cخواهم', 'क्\u200dष', '❤️‍🔥', '👨‍👩‍👧', '🇮🇳', '1️⃣ free', 'தமிழ்', 'Ünï©ødé ₹999']) assert.equal(bar(real), real, real);
    assert.equal(bar('\u200cFree'), '\u200cFree', 'a joiner next to real letters is part of the word');
  });

  test('stripInvisible / hasVisibleText: the building blocks, safe on anything', () => {
    assert.equal(lib.stripInvisible('F\u200bre\u2800e\u{E0041}'), 'Free');
    assert.equal(lib.stripInvisible('❤️‍🔥'), '❤️‍🔥', 'the emoji joiner stays');
    for (const junk of [undefined, null, 5, {}, [], true]) {
      assert.equal(lib.stripInvisible(junk), '');
      assert.equal(lib.hasVisibleText(junk), false);
    }
    for (const yes of ['a', '7', '!', '₹', '🚚', ' x ', 'த', 'Free\u200b']) assert.equal(lib.hasVisibleText(yes), true, yes);
    for (const no of ['', ' ', '\n\t', '\u200c', '\u200d\u200d', '\u3164', '\u2800', '\u0301', '\ufe0f', '\u{E0041}', '\u00a0', ' \u200b ']) assert.equal(lib.hasVisibleText(no), false, JSON.stringify(no));
  });

  test('texts: plain, “<” and “>” gone, whitespace collapsed and trimmed, at most 60, empty → the default', () => {
    const bar = (v) => normalizeDeliveryMessage({ barText: v }).barText;
    const badge = (v) => normalizeDeliveryMessage({ badgeText: v }).badgeText;
    assert.equal(bar('Free delivery above ₹999'), 'Free delivery above ₹999');
    assert.equal(bar('  Free \t\n  delivery   '), 'Free delivery');
    assert.equal(bar('<script>alert(1)</script>'), 'scriptalert(1)/script');
    assert.equal(bar('a<b>c'), 'abc');
    assert.equal(bar('<<>>'), 'Free Delivery across India', 'nothing left → the default');
    assert.equal(badge('<<>>'), 'Free Nationwide Shipping');
    for (const v of ['', '   ', '\n\t', undefined, null, 5, true, [], {}, ['x']]) {
      assert.equal(bar(v), 'Free Delivery across India', JSON.stringify(v));
      assert.equal(badge(v), 'Free Nationwide Shipping', JSON.stringify(v));
    }
    /* Controls and look-alike tricks: no bidi overrides, no zero-width spaces, no control characters. */
    assert.equal(bar('Free‮evil‬'), 'Freeevil');
    assert.equal(bar('Fr​ee﻿'), 'Free');
    assert.equal(bar('Free\u0000De\u0007livery'), 'Free De livery');
    assert.equal(bar('Free  Delivery'), 'Free Delivery', 'non-breaking and wide spaces collapse');
    assert.equal(bar('Free \uD800 delivery'), 'Free delivery', 'half of an emoji is not text');
    /* Emoji, Tamil and Hindi survive; a joiner is kept (emoji sequences, conjuncts). */
    assert.equal(bar('இலவச டெலிவரி 🇮🇳'), 'இலவச டெலிவரி 🇮🇳');
    assert.equal(bar('मुफ़्त डिलीवरी'), 'मुफ़्त डिलीवरी');
    assert.equal(bar('❤️‍🔥'), '❤️‍🔥');
    /* Length: at most 60 UTF-16 units, never cut inside an emoji, trimmed after cutting. */
    assert.equal(bar('x'.repeat(60)).length, 60);
    assert.equal(bar('x'.repeat(61)), 'x'.repeat(60));
    assert.equal(bar('x'.repeat(5000)), 'x'.repeat(60));
    assert.equal(bar(`${'x'.repeat(59)} tail`), 'x'.repeat(59), 'the cut leaves no trailing space');
    const cut = bar(`${'x'.repeat(59)}🚚🚚`);
    assert.equal(cut, 'x'.repeat(59), 'a 2-unit emoji that would cross the limit is dropped whole');
    assert.ok(!/[\uD800-\uDBFF]$/.test(cut));
    const emojis = bar('🚚'.repeat(100));
    assert.ok(emojis.length <= DELIVERY_TEXT_MAX);
    assert.equal(emojis, '🚚'.repeat(30));
    for (const v of ['a'.repeat(200), '🚚'.repeat(200), `${'<>'.repeat(100)}x`, ' '.repeat(100) + 'y']) {
      const t = bar(v);
      assert.ok(t.length >= 1 && t.length <= DELIVERY_TEXT_MAX && t === t.trim() && !/[<>]/.test(t));
    }
  });

  test('colours: only lower-case #rrggbb is kept; everything else is the default colour', () => {
    const text = (v) => normalizeDeliveryMessage({ style: { colors: { text: v } } }).style.colors.text;
    const bg = (v) => normalizeDeliveryMessage({ style: { colors: { bg: v } } }).style.colors.bg;
    assert.equal(text('#AABBCC'), '#aabbcc');
    assert.equal(text('  #AaBbCc '), '#aabbcc');
    assert.equal(bg('#0F0F0F'), '#0f0f0f');
    for (const v of ['red', '#abc', '#abcd', '#aabbccdd', 'aabbcc', '#gggggg', 'rgb(0,0,0)', 'red;background:url(//evil)', '#aabbcc;color:red', '#aabbcc"', "#aabbcc'", 'url(x)', 'var(--x)', '#aabbc\n', 5, null, true, [], ['#aabbcc'], {}]) {
      assert.equal(text(v), '#683f1a', JSON.stringify(v));
      assert.equal(bg(v), '#faf0d0', JSON.stringify(v));
    }
  });

  test('a custom tone whose text and background read under 3:1 is not applied (auto); 3:1 and up is kept', () => {
    const tone = (model, text, bgc) => normalizeDeliveryMessage({ style: { tone: 'custom', model, colors: { text, bg: bgc } } }).style.tone;
    for (const model of ['pill', 'solid']) {
      assert.equal(tone(model, '#ffffff', '#ffffff'), 'auto');
      assert.equal(tone(model, '#777777', '#888888'), 'auto');
      assert.equal(tone(model, '#000000', '#ffffff'), 'custom');
      assert.equal(tone(model, '#ffffff', '#8b1a4a'), 'custom');
      /* The boundary: #949494 on white is 3.03:1, #959595 is 2.99:1. */
      assert.ok(contrastRatio('#949494', '#ffffff') >= 3 && contrastRatio('#959595', '#ffffff') < 3);
      assert.equal(tone(model, '#949494', '#ffffff'), 'custom');
      assert.equal(tone(model, '#959595', '#ffffff'), 'auto');
    }
    /* The colours themselves are kept, so the owner’s pick is not lost. */
    const kept = normalizeDeliveryMessage({ style: { tone: 'custom', model: 'pill', colors: { text: '#ffffff', bg: '#FFFFFF' } } });
    assert.deepEqual(kept.style.colors, { text: '#ffffff', bg: '#ffffff' });
    /* Models without a background of their own sit on each surface: judged there, when drawn. */
    for (const model of ['text', 'outline', 'underline']) assert.equal(tone(model, '#ffffff', '#ffffff'), 'custom', model);
    /* Other tones never look at the colours. */
    assert.equal(normalizeDeliveryMessage({ style: { tone: 'gold', model: 'pill', colors: { text: '#ffffff', bg: '#ffffff' } } }).style.tone, 'gold');
  });

  test('lenient keeps an unusable custom tone (the admin form must go on showing what is being typed); strict never does', () => {
    const raw = { style: { tone: 'custom', model: 'solid', colors: { text: '#ffffff', bg: '#fefefe' } } };
    assert.equal(normalizeDeliveryMessage(raw).style.tone, 'auto');
    assert.equal(normalizeDeliveryMessage(raw, { lenient: true }).style.tone, 'custom');
    assert.equal(normalizeDeliveryMessage(raw, { lenient: false }).style.tone, 'auto');
    assert.equal(normalizeDeliveryMessage(raw, {}).style.tone, 'auto');
    assert.equal(normalizeDeliveryMessage(raw, null).style.tone, 'auto', 'a junk second argument is the strict default');
    assert.deepEqual(normalizeDeliveryMessage(normalizeDeliveryMessage(raw, { lenient: true })), normalizeDeliveryMessage(raw), 'strict(lenient(x)) = strict(x)');
    /* Everything else is identical. */
    const lenient = normalizeDeliveryMessage(raw, { lenient: true });
    lenient.style.tone = 'auto';
    assert.deepEqual(lenient, normalizeDeliveryMessage(raw));
  });

  test('never throws, and never reads anything inherited: hostile and prototype-pollution-shaped input', () => {
    /* JSON that carries __proto__ / constructor keys as ordinary own properties. */
    const evil = JSON.parse('{"__proto__":{"enabled":false,"barText":"pwned"},"constructor":{"prototype":{"enabled":false}},"enabled":true,"style":{"__proto__":{"model":"pill"},"constructor":"x","model":"solid","colors":{"__proto__":{"text":"#000000"}}}}');
    const out = normalizeDeliveryMessage(evil);
    assert.equal(out.enabled, true);
    assert.equal(out.barText, 'Free Delivery across India');
    assert.equal(out.style.model, 'solid');
    assert.equal(out.style.colors.text, '#683f1a');
    assert.deepEqual(Object.keys(out), ['enabled', 'mode', 'barText', 'badgeText', 'icon', 'style']);
    assert.equal({}.polluted, undefined);
    assert.equal(Object.getPrototypeOf(out), Object.prototype);

    /* Values that sit on a polluted Object.prototype are never read. */
    const keys = ['enabled', 'mode', 'barText', 'badgeText', 'icon', 'style', 'font', 'model', 'tone', 'colors', 'text', 'bg', 'italic'];
    try {
      for (const k of keys) Object.defineProperty(Object.prototype, k, { value: k === 'enabled' || k === 'italic' ? true : 'always', configurable: true, writable: true });
      assert.deepEqual(normalizeDeliveryMessage({}), DEFAULT_DELIVERY_MESSAGE);
      assert.deepEqual(normalizeDeliveryMessage({ style: {} }), DEFAULT_DELIVERY_MESSAGE);
      assert.deepEqual(normalizeDeliveryMessage(null), DEFAULT_DELIVERY_MESSAGE);
    } finally {
      for (const k of keys) delete Object.prototype[k];
    }

    /* A null-prototype object works; throwing getters and proxies fall back to the defaults. */
    const bare = Object.create(null);
    bare.mode = 'always';
    assert.equal(normalizeDeliveryMessage(bare).mode, 'always');
    const boom = { get enabled() { throw new Error('boom'); } };
    assert.deepEqual(normalizeDeliveryMessage(boom), DEFAULT_DELIVERY_MESSAGE);
    const proxy = new Proxy({}, { get() { throw new Error('boom'); }, has() { throw new Error('boom'); }, getOwnPropertyDescriptor() { throw new Error('boom'); } });
    assert.deepEqual(normalizeDeliveryMessage(proxy), DEFAULT_DELIVERY_MESSAGE);
    assert.deepEqual(normalizeDeliveryMessage({ style: proxy }), DEFAULT_DELIVERY_MESSAGE);
    assert.doesNotThrow(() => normalizeDeliveryMessage(proxy, { lenient: true }));
    const cyclic = { barText: 'ok' };
    cyclic.style = { colors: cyclic, self: cyclic };
    cyclic.self = cyclic;
    assert.equal(normalizeDeliveryMessage(cyclic).barText, 'ok');
    assert.doesNotThrow(() => JSON.stringify(normalizeDeliveryMessage(cyclic)));
  });

  test('an old stored value that is only partly valid keeps its valid parts', () => {
    const out = normalizeDeliveryMessage({ enabled: false, barText: 'Free shipping over ₹999', icon: 'NOPE', style: { model: 'pill', weight: 'heavy', italic: true } });
    assert.equal(out.enabled, false);
    assert.equal(out.barText, 'Free shipping over ₹999');
    assert.equal(out.badgeText, 'Free Nationwide Shipping');
    assert.equal(out.icon, '🚚');
    assert.equal(out.style.model, 'pill');
    assert.equal(out.style.weight, 'normal');
    assert.equal(out.style.italic, true);
  });
});

describe('pickDeliveryMessage, sameDeliveryMessage, nextDeliveryMessage', () => {
  test('pick reads settings.deliveryMessage and always gives the full configuration', () => {
    for (const settings of [null, undefined, {}, 'x', [], { deliveryMessage: null }, { deliveryMessage: 'x' }, { deliveryMessage: [] }, { deliveryMessage: {} }]) {
      assert.deepEqual(pickDeliveryMessage(settings), DEFAULT_DELIVERY_MESSAGE);
    }
    assert.equal(pickDeliveryMessage({ deliveryMessage: { enabled: false, phone: 'x' }, phone: '1' }).enabled, false);
    assert.deepEqual(JSON.parse(JSON.stringify(pickDeliveryMessage({ deliveryMessage: { icon: '🎁' } }))), pickDeliveryMessage({ deliveryMessage: { icon: '🎁' } }));
  });

  test('same: equal after normalizing (extra keys, case of colours and junk do not count)', () => {
    assert.equal(sameDeliveryMessage(null, {}), true);
    assert.equal(sameDeliveryMessage(undefined, DEFAULT_DELIVERY_MESSAGE), true);
    assert.equal(sameDeliveryMessage({ extra: 1 }, { mode: 'nonsense' }), true);
    assert.equal(sameDeliveryMessage({ style: { colors: { text: '#ABCDEF' } } }, { style: { colors: { text: '#abcdef' } } }), true);
    assert.equal(sameDeliveryMessage({ enabled: false }, null), false);
    assert.equal(sameDeliveryMessage({ barText: 'a' }, { barText: 'b' }), false);
    assert.equal(sameDeliveryMessage({ style: { model: 'pill' } }, { style: { model: 'solid' } }), false);
    assert.equal(sameDeliveryMessage({ style: { italic: true } }, {}), false);
  });

  test('next: the very same object (reference) unless the page really has to change — as nextHeroSlides', () => {
    const prev = normalizeDeliveryMessage({ barText: 'Free shipping', style: { model: 'pill' } });
    /* nothing to apply */
    for (const settings of [null, undefined, {}, 'x', [], { deliveryMessage: null }, { deliveryMessage: 'x' }, { deliveryMessage: [] }, { phone: '1' }]) {
      assert.equal(nextDeliveryMessage(prev, settings), prev, JSON.stringify(settings));
    }
    /* the same message, however it is spelled */
    assert.equal(nextDeliveryMessage(prev, { deliveryMessage: clone(prev) }), prev);
    assert.equal(nextDeliveryMessage(prev, { deliveryMessage: { ...clone(prev), junk: 1 } }), prev);
    assert.equal(nextDeliveryMessage(prev, { deliveryMessage: { barText: ' Free   shipping ', style: { model: 'pill', tone: 'bogus' } } }), prev);
    /* stale (the browser's stored copy): never applied, even when different */
    assert.equal(nextDeliveryMessage(prev, { deliveryMessage: { enabled: false } }, { stale: true }), prev);
    assert.equal(nextDeliveryMessage(prev, { deliveryMessage: { enabled: false } }, { stale: false }).enabled, false);
    /* a real change: a new normalized object */
    const changed = nextDeliveryMessage(prev, { deliveryMessage: { barText: 'Free shipping', style: { model: 'solid' }, junk: 1 } });
    assert.notEqual(changed, prev);
    assert.equal(changed.style.model, 'solid');
    assert.deepEqual(changed, normalizeDeliveryMessage({ barText: 'Free shipping', style: { model: 'solid' } }));
    /* null = "the defaults" (settings could not be read on the server) */
    assert.equal(nextDeliveryMessage(null, { deliveryMessage: {} }), null, 'equal to the defaults: no state change');
    assert.equal(nextDeliveryMessage(null, { deliveryMessage: DEFAULT_DELIVERY_MESSAGE }), null);
    assert.equal(nextDeliveryMessage(null, {}), null);
    assert.deepEqual(nextDeliveryMessage(null, { deliveryMessage: { enabled: false } }), normalizeDeliveryMessage({ enabled: false }));
    assert.equal(nextDeliveryMessage(prev, { deliveryMessage: {} }).enabled, true, 'back to the defaults is a change');
    assert.equal(nextDeliveryMessage(DEFAULT_DELIVERY_MESSAGE, { deliveryMessage: {} }), DEFAULT_DELIVERY_MESSAGE);
    /* Same signature and behaviour as its sibling. */
    const slides = pickHeroSlides([{ id: '1', imageUrl: 'https://x/y.jpg' }]);
    assert.equal(nextHeroSlides(slides, undefined), slides);
    assert.equal(nextDeliveryMessage(prev, undefined), prev);
    assert.equal(nextDeliveryMessage(prev, { deliveryMessage: { enabled: false } }, undefined).enabled, false);
  });
});

describe('deliveryMessageFor — when, and with which words', () => {
  const surfaces = ['bar', 'tagline', 'badge', 'product'];
  const words = { bar: 'Bar words', tagline: 'Bar words', badge: 'Badge words', product: 'Bar words' };

  test('truth table: enabled × mode × shipping × surface', () => {
    for (const enabled of [true, false]) for (const mode of ['auto', 'always']) for (const [shipping, charges] of [['free', FREE], ['paid', PAID]]) for (const surface of surfaces) {
      const config = { enabled, mode, barText: 'Bar words', badgeText: 'Badge words' };
      const shown = enabled && (mode === 'always' || shipping === 'free');
      assert.equal(deliveryMessageFor(config, charges, surface), shown ? words[surface] : '', JSON.stringify({ enabled, mode, shipping, surface }));
    }
  });

  test('the defaults say today’s words exactly when shipping is free for every order, and nothing otherwise', () => {
    assert.equal(deliveryMessageFor(undefined, FREE, 'bar'), 'Free Delivery across India');
    assert.equal(deliveryMessageFor(null, FREE, 'product'), 'Free Delivery across India');
    assert.equal(deliveryMessageFor(null, FREE, 'tagline'), 'Free Delivery across India');
    assert.equal(deliveryMessageFor(null, FREE, 'badge'), 'Free Nationwide Shipping');
    for (const surface of surfaces) {
      assert.equal(deliveryMessageFor(null, PAID, surface), '');
      assert.equal(deliveryMessageFor(DEFAULT_DELIVERY_MESSAGE, DEFAULT_CHARGES, surface), '');
    }
  });

  test('the rule is the store’s: every free-for-all shape shows, every conditional one does not (mode auto)', () => {
    for (const c of [{ enable_shipping_fee: false }, { ...DEFAULT_CHARGES, shipping_fee_amount: 0 }, { ...DEFAULT_CHARGES, free_shipping_threshold: 1 }]) {
      assert.equal(deliveryMessageFor(null, c, 'bar'), 'Free Delivery across India', JSON.stringify(c));
    }
    for (const c of [DEFAULT_CHARGES, { ...DEFAULT_CHARGES, free_shipping_threshold: 0 }, { ...DEFAULT_CHARGES, free_shipping_threshold: 500 }, undefined, null, {}, 'x']) {
      assert.equal(deliveryMessageFor(null, c, 'bar'), '', JSON.stringify(c));
    }
  });

  test('garbage config means the defaults; an unknown surface shows nothing; the words are the sanitised ones', () => {
    for (const raw of [undefined, null, 'x', 5, [], { enabled: 'no' }, { mode: 'sometimes' }]) {
      assert.equal(deliveryMessageFor(raw, FREE, 'bar'), 'Free Delivery across India');
      assert.equal(deliveryMessageFor(raw, PAID, 'bar'), '');
    }
    for (const surface of [undefined, null, '', 'footer', 'BAR', 'toString', 5, {}, []]) assert.equal(deliveryMessageFor({ mode: 'always' }, FREE, surface), '', String(surface));
    assert.equal(deliveryMessageFor({ barText: '  <b>Free</b>   shipping  ' }, FREE, 'bar'), 'bFree/b shipping');
    assert.equal(deliveryMessageFor({ mode: 'always', badgeText: 'Free over ₹999' }, PAID, 'badge'), 'Free over ₹999');
    assert.equal(deliveryMessageFor({ enabled: false, mode: 'always' }, FREE, 'bar'), '', 'off means off');
  });
});

describe('deliveryMismatch — the admin warning', () => {
  test('only when on, in Always mode, and the shipping settings still charge', () => {
    for (const enabled of [true, false]) for (const mode of ['auto', 'always']) for (const charges of [FREE, PAID, { ...DEFAULT_CHARGES, free_shipping_threshold: 0 }]) {
      const warn = deliveryMismatch({ enabled, mode }, charges);
      const expected = enabled && mode === 'always' && charges !== FREE;
      assert.equal(typeof warn, 'string');
      assert.equal(warn !== '', expected, JSON.stringify({ enabled, mode, charges }));
    }
    assert.equal(deliveryMismatch(null, PAID), '');
    assert.equal(deliveryMismatch(undefined, undefined), '');
  });

  test('the warning names the real rule and what to do; nothing is claimed for a free store', () => {
    const w = deliveryMismatch({ mode: 'always' }, PAID);
    assert.match(w, /still charge/i);
    assert.match(w, /Free delivery above ₹2,000/);
    assert.match(w, /Smart/);
    assert.match(deliveryMismatch({ mode: 'always' }, { ...DEFAULT_CHARGES, free_shipping_threshold: 0, shipping_fee_amount: 79 }), /Delivery ₹79/);
    assert.equal(deliveryMismatch({ mode: 'always' }, { enable_shipping_fee: false }), '');
  });
});

describe('contrast', () => {
  test('contrastRatio is WCAG 2: black on white 21, identical 1, symmetric, known values', () => {
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#ffffff', '#000000'), 21);
    assert.equal(contrastRatio('#123456', '#123456'), 1);
    assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
    assert.ok(Math.abs(contrastRatio('#767676', '#ffffff') - 4.54) < 0.01);
    assert.ok(Math.abs(contrastRatio('#8b1a4a', '#ffffff') - 8.96) < 0.01);
    assert.equal(contrastRatio('#AABBCC', '#112233'), contrastRatio('#aabbcc', '#112233'), 'case does not matter');
    for (let i = 0; i < 50; i += 1) {
      const hex = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
      const [a, b] = [hex(), hex()];
      const r = contrastRatio(a, b);
      assert.ok(r >= 1 && r <= 21, `${a} ${b} ${r}`);
      assert.equal(r, contrastRatio(b, a));
    }
  });

  test('anything that is not #rrggbb counts as unreadable (1), without throwing', () => {
    for (const v of [undefined, null, '', 'red', '#fff', '#12345', '#1234567', 'rgb(0,0,0)', 5, {}, [], '#gggggg']) {
      assert.equal(contrastRatio(v, '#ffffff'), 1, String(v));
      assert.equal(contrastRatio('#000000', v), 1, String(v));
    }
  });

  test('modelHasBackground: pill and solid paint their own', () => {
    assert.deepEqual(MODELS.filter(modelHasBackground), ['pill', 'solid']);
  });

  test('contrastNote: ok from 4.5, low from 3, unusable under 3; judged on the surface for models without a background', () => {
    const note = (model, text, bgc, surface) => contrastNote({ style: { tone: 'custom', model, colors: { text, bg: bgc } } }, surface);
    /* pill/solid: text against the chosen background, whatever the surface */
    for (const surface of ['bar', 'badge', 'product']) {
      assert.deepEqual(note('pill', '#000000', '#ffffff', surface), { level: 'ok', ratio: 21 });
      assert.equal(note('solid', '#ffffff', '#ffffff', surface).level, 'unusable');
      assert.equal(note('solid', '#ffffff', '#ffffff', surface).ratio, 1);
    }
    assert.equal(note('pill', '#777777', '#ffffff', 'bar').level, 'low', '4.48:1 is hard to read');
    assert.equal(note('pill', '#767676', '#ffffff', 'bar').level, 'ok', '4.54:1');
    assert.equal(note('pill', '#949494', '#ffffff', 'bar').level, 'low', '3.03:1');
    assert.equal(note('pill', '#959595', '#ffffff', 'bar').level, 'unusable', '2.99:1');
    /* text/outline/underline: text against what it sits on */
    for (const model of ['text', 'outline', 'underline']) {
      assert.equal(note(model, '#ffffff', '#ffffff', 'bar').level, 'ok', `${model}: white text reads on the dark strip`);
      assert.equal(note(model, '#ffffff', '#ffffff', 'tagline').level, 'ok');
      assert.equal(note(model, '#ffffff', '#ffffff', 'badge').level, 'unusable', `${model}: but not on the cream hero`);
      assert.equal(note(model, '#ffffff', '#ffffff', 'product').level, 'unusable');
      assert.equal(note(model, '#683f1a', '#ffffff', 'bar').level, 'unusable', `${model}: brown does not read on the dark strip`);
      assert.equal(note(model, '#683f1a', '#ffffff', 'badge').level, 'ok');
      assert.equal(note(model, '#683f1a', '#ffffff', 'product').level, 'ok');
    }
    assert.equal(note('text', '#8b1a4a', '#000000', 'unknown-surface').level, 'ok', 'an unknown surface is judged on white');
    /* The ratio never promises more than there is: rounded down. */
    const r = note('text', '#767676', '#ffffff', 'product');
    assert.ok(r.ratio <= contrastRatio('#767676', '#ffffff') && contrastRatio('#767676', '#ffffff') - r.ratio < 0.01);
    assert.ok(Number.isInteger(Math.round(r.ratio * 100)));
  });

  test('contrastNote judges what is being typed (an unusable custom pair is reported, not hidden) and is safe on anything', () => {
    const raw = { style: { tone: 'custom', model: 'pill', colors: { text: '#fefefe', bg: '#ffffff' } } };
    assert.equal(normalizeDeliveryMessage(raw).style.tone, 'auto', 'the storefront would not use it');
    assert.equal(contrastNote(raw, 'badge').level, 'unusable', 'but the form still says why');
    for (const junk of [null, undefined, 'x', 5, [], {}, { style: 'x' }]) {
      const n = contrastNote(junk, 'bar');
      assert.deepEqual(n.level, 'ok');
      assert.ok(n.ratio >= 4.5);
    }
    /* Named tones are curated pairs: always ok, with their real ratio. */
    for (const tone of TONES.filter((t) => t !== 'custom')) {
      const n = contrastNote({ style: { tone } }, 'product');
      assert.equal(n.level, 'ok', tone);
      assert.ok(n.ratio >= CONTRAST_GOOD, `${tone} ${n.ratio}`);
    }
    assert.equal(CONTRAST_MIN, 3);
    assert.equal(CONTRAST_GOOD, 4.5);
  });
});

/* ═══ The classes ═══ */

/* The repo's real Tailwind config, scanning the real style file the way the build does. */
const tokensOf = (v) => (typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : Array.isArray(v) ? v.flatMap(tokensOf) : v && typeof v === 'object' ? Object.values(v).flatMap(tokensOf) : []);
const ALL_TOKENS = [...new Set(tokensOf(MESSAGE_STYLE_MAPS))];
/* The two classes the resolver adds itself, not from a table. */
const EXTRA_TOKENS = ['italic', 'uppercase'];

async function compile() {
  const postcss = require('postcss');
  const tailwind = require('tailwindcss');
  const config = { ...require(path.resolve('tailwind.config.js')), content: [path.resolve('src/components/ui/deliveryMessageStyle.js')] };
  const result = await postcss([tailwind(config)]).process('@tailwind utilities;', { from: undefined });
  return result.root;
}
const unescapeClass = (sel) => sel.replace(/^\./, '').replace(/\\(.)/g, '$1');
const rgbOf = (value, alpha) => {
  const m = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+|var\([^)]*\)))?\s*\)/.exec(value);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : Number.isNaN(Number(m[4])) ? alpha : Number(m[4]);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
};
const hexOf = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const over = (fg, bg) => ({ r: fg.a * fg.r + (1 - fg.a) * bg.r, g: fg.a * fg.g + (1 - fg.a) * bg.g, b: fg.a * fg.b + (1 - fg.a) * bg.b, a: 1 });
const parseHex = (hex) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), a: 1 });

let compiled = null;
const css = async () => {
  if (!compiled) {
    const root = await compile();
    /* class → { selectors, decls } */
    const rules = new Map();
    root.walkRules((rule) => {
      for (const sel of rule.selectors) {
        const name = unescapeClass(sel);
        const entry = rules.get(name) || { decls: {} };
        rule.walkDecls((d) => { entry.decls[d.prop] = d.value; });
        rules.set(name, entry);
      }
    });
    compiled = { root, rules };
  }
  return compiled;
};
const colorOf = (rules, token, prop) => {
  const d = rules.get(token)?.decls;
  if (!d || !d[prop]) return null;
  return rgbOf(d[prop], Number(d['--tw-text-opacity'] ?? d['--tw-bg-opacity'] ?? d['--tw-border-opacity'] ?? 1));
};

describe('the class tables', () => {
  test('every entry is a string of literal class names, written out in the file (nothing assembled at run time)', () => {
    const file = read('src/components/ui/deliveryMessageStyle.js');
    const code = file.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /`/, 'no template literals');
    assert.doesNotMatch(code, /\$\{/);
    assert.doesNotMatch(code, /\b(?:text|bg|border|font|tracking|decoration|ring)-['"]\s*\+/, 'no concatenated class names');
    const walk = (v, where) => {
      if (typeof v === 'string') {
        assert.match(v, /^[A-Za-z0-9\-:[\]#./%\s]*$/, `${where}: ${JSON.stringify(v)}`);
        for (const token of v.split(/\s+/).filter(Boolean)) assert.ok(file.includes(token), `${where}: ${token} is written out in the file`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
      else assert.fail(`${where}: ${typeof v}`);
    };
    walk(MESSAGE_STYLE_MAPS, 'maps');
    assert.ok(ALL_TOKENS.length > 100, `${ALL_TOKENS.length} distinct classes`);
    /* The library holds no Tailwind classes at all. */
    const libCode = read('src/lib/deliveryMessage.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(libCode, /['"\s](?:text|bg|border|font|tracking|decoration|ring|rounded|px|py|h|w|flex|inline)-[a-z0-9[]/);
  });

  test('every table has an entry for everything the library allows (no hole a valid choice could fall into)', () => {
    const M = MESSAGE_STYLE_MAPS;
    assert.deepEqual(Object.keys(M.BASE).sort(), [...SURFACES].sort());
    for (const surface of SURFACES) {
      assert.deepEqual(Object.keys(M.SHAPE[surface]).sort(), [...MODELS].sort(), `shape/${surface}`);
      assert.deepEqual(Object.keys(M.SIZE[surface]).sort(), values('sizes').sort(), `size/${surface}`);
      assert.deepEqual(Object.keys(M.WEIGHT[surface]).sort(), values('weights').sort(), `weight/${surface}`);
      assert.deepEqual(Object.keys(M.TRACKING[surface]).sort(), values('trackings').sort(), `tracking/${surface}`);
      assert.deepEqual(Object.keys(M.AUTO[surface]).sort(), [...MODELS].sort(), `auto/${surface}`);
    }
    assert.deepEqual(Object.keys(M.FONT).sort(), values('fonts').sort());
    for (const env of [M.DARK, M.LIGHT]) {
      assert.deepEqual(Object.keys(env).sort(), [...NAMED].sort());
      for (const tone of NAMED) assert.deepEqual(Object.keys(env[tone]).sort(), [...MODELS].sort(), tone);
    }
    for (const entry of [...Object.values(M.AUTO).flatMap(Object.values), ...[M.DARK, M.LIGHT].flatMap((e) => Object.values(e).flatMap(Object.values))]) {
      assert.equal(entry.length, 2, 'wrapper classes, word classes');
      assert.ok(entry.every((s) => typeof s === 'string'));
    }
  });

  test('the entries that must say something do (an empty string is only ever "the surface’s own")', () => {
    const M = MESSAGE_STYLE_MAPS;
    const nonEmpty = (v, where) => assert.ok(typeof v === 'string' && v.trim() !== '', where);
    nonEmpty(M.FONT.serif, 'serif'); nonEmpty(M.FONT.classic, 'classic');
    nonEmpty(M.BASE.bar, 'bar base'); nonEmpty(M.BASE.badge, 'badge base'); nonEmpty(M.BASE.product, 'product base'); nonEmpty(M.BADGE_WRAPPING, 'wrapping badge');
    nonEmpty(M.UNDERLINE, 'underline');
    for (const surface of SURFACES) {
      for (const model of MODELS.filter((m) => m !== 'text' && m !== 'underline')) nonEmpty(M.SHAPE[surface][model], `shape ${surface}/${model}`);
      for (const k of ['sm', 'lg']) nonEmpty(M.SIZE[surface][k], `size ${surface}/${k}`);
      for (const k of ['medium', 'semibold', 'bold']) nonEmpty(M.WEIGHT[surface][k], `weight ${surface}/${k}`);
      for (const k of ['wide', 'wider']) nonEmpty(M.TRACKING[surface][k], `tracking ${surface}/${k}`);
      /* every model on every named/auto tone says a colour (only the strip’s second state inherits one) */
      for (const model of MODELS) {
        if (!(surface === 'tagline' && (model === 'text' || model === 'underline'))) nonEmpty(M.AUTO[surface][model][0], `auto ${surface}/${model}`);
        for (const tone of NAMED) nonEmpty((surface === 'bar' || surface === 'tagline' ? M.DARK : M.LIGHT)[tone][model][0], `${tone} ${surface}/${model}`);
      }
    }
    for (const env of [M.DARK, M.LIGHT]) for (const tone of NAMED) nonEmpty(env[tone].underline[1], `${tone} underline accent`);
  });

  test('Tailwind, scanning the style file as the build does, generates every class in the tables (a typo, a missing colour or a class built at run time fails here)', async () => {
    const { rules } = await css();
    const missing = [...ALL_TOKENS, ...EXTRA_TOKENS].filter((t) => !rules.has(t));
    assert.deepEqual(missing, []);
    assert.equal(rules.get('font-classic').decls['font-family'], '"Inter Rupee", Georgia, "Times New Roman", serif', 'the new family, not a fallback to something else');
    assert.match(rules.get('font-serif').decls['font-family'], /^"Cormorant Rupee"/);
  });

  test('tailwind.config.js: “classic” is a system stack behind the tiny rupee face — no webfont is added', () => {
    const { theme } = require(path.resolve('tailwind.config.js'));
    assert.deepEqual(theme.extend.fontFamily.classic, ['"Inter Rupee"', 'Georgia', '"Times New Roman"', 'serif']);
    assert.deepEqual(theme.extend.fontFamily.sans.slice(0, 2), ['"Inter Rupee"', 'Inter'], 'the others are untouched');
    assert.deepEqual(theme.extend.fontFamily.serif.slice(0, 2), ['"Cormorant Rupee"', '"Cormorant Garamond"']);
    assert.doesNotMatch(read('src/app/globals.css'), /Georgia|font-classic/, 'no @font-face for it');
  });

  test('every readable pair reads: each tone × model × surface is 4.5:1 or better (text over its background over the surface)', async () => {
    const { rules } = await css();
    const M = MESSAGE_STYLE_MAPS;
    /* The strip’s second state inherits its colour from the tagline paragraph (text-gold-300/70). */
    const inherited = { r: 236, g: 201, b: 107, a: 0.7 };
    const failures = [];
    let checked = 0;
    for (const surface of SURFACES) {
      const ground = parseHex(SURFACE_COLORS[surface === 'tagline' ? 'bar' : surface]);
      for (const tone of ['auto', ...NAMED]) for (const model of MODELS) {
        const [wrapper] = tone === 'auto' ? M.AUTO[surface][model] : (surface === 'bar' || surface === 'tagline' ? M.DARK : M.LIGHT)[tone][model];
        const tokens = wrapper.split(/\s+/).filter(Boolean);
        const fgToken = tokens.find((t) => colorOf(rules, t, 'color'));
        const bgToken = tokens.find((t) => colorOf(rules, t, 'background-color'));
        const surfaceBg = bgToken ? over(colorOf(rules, bgToken, 'background-color'), ground) : ground;
        const fgRaw = fgToken ? colorOf(rules, fgToken, 'color') : inherited;
        if (!fgToken && !(surface === 'tagline' && tone === 'auto' && (model === 'text' || model === 'underline'))) failures.push(`${surface}/${tone}/${model}: no text colour`);
        const ratio = contrastRatio(hexOf(over(fgRaw, surfaceBg)), hexOf(surfaceBg));
        checked += 1;
        if (ratio < CONTRAST_GOOD) failures.push(`${surface}/${tone}/${model}: ${fgToken || 'inherited'} on ${bgToken || 'surface'} = ${ratio.toFixed(2)}`);
        if (bgToken && !modelHasBackground(model)) failures.push(`${surface}/${tone}/${model}: a background on a model that has none`);
        if (!bgToken && modelHasBackground(model)) failures.push(`${surface}/${tone}/${model}: no background`);
      }
    }
    assert.deepEqual(failures, []);
    assert.equal(checked, 4 * 6 * 5);
  });

  test('the tone swatches are the tones’ filled badges', async () => {
    const { rules } = await css();
    for (const tone of NAMED) {
      const [text, bg] = DELIVERY_OPTIONS.tones.find((t) => t.value === tone).swatch;
      const solid = MESSAGE_STYLE_MAPS.LIGHT[tone].solid[0].split(/\s+/);
      const bgHex = hexOf(colorOf(rules, solid.find((t) => colorOf(rules, t, 'background-color')), 'background-color'));
      const fgHex = hexOf(colorOf(rules, solid.find((t) => colorOf(rules, t, 'color')), 'color'));
      /* the light-surface solid badge, or (ivory, whose dark one is a different cream) its dark twin */
      const dark = MESSAGE_STYLE_MAPS.DARK[tone].solid[0].split(/\s+/);
      const darkBg = hexOf(colorOf(rules, dark.find((t) => colorOf(rules, t, 'background-color')), 'background-color'));
      const darkFg = hexOf(colorOf(rules, dark.find((t) => colorOf(rules, t, 'color')), 'color'));
      assert.ok((fgHex === text && bgHex === bg) || (darkFg === text && darkBg === bg), `${tone}: ${text}/${bg} vs light ${fgHex}/${bgHex} dark ${darkFg}/${darkBg}`);
      assert.ok(contrastRatio(text, bg) >= CONTRAST_GOOD, tone);
    }
  });
});

/* ═══ resolveMessageStyle ═══ */

describe('resolveMessageStyle', () => {
  const has = (cls, token) => cls.split(/\s+/).includes(token);

  test('the default configuration is today’s classes on each surface (minus the layout classes the caller owns)', () => {
    /* WelcomeBar today: <span className="hidden min-[820px]:block flex-shrink-0 text-gold-200/80"> */
    const bar = resolveMessageStyle(undefined, 'bar');
    assert.equal(bar.wrapperClass, 'flex-shrink-0 text-gold-200/80');
    assert.equal(bar.textClass, '');
    assert.deepEqual(bar.wrapperStyle, {});
    assert.equal(bar.iconClass, '', 'the strip’s icon is a bare <span aria-hidden>');
    assert.equal(bar.iconKind, 'emoji');
    assert.equal(bar.icon, '🚚');
    assert.equal(bar.iconAfter, true, '“Free Delivery across India 🚚”');
    /* …and the second state: the clause runs on in the tagline paragraph's own colour and size */
    const tagline = resolveMessageStyle(undefined, 'tagline');
    assert.equal(tagline.wrapperClass, '');
    assert.equal(tagline.iconKind, 'none', 'no icon there today');
    assert.equal(tagline.icon, '');
    /* HeroSection today: <li className="inline-flex h-6 items-center gap-2 whitespace-nowrap text-[13px] font-medium text-stone-700"> + <span aria-hidden className="text-base leading-none"> */
    const badge = resolveMessageStyle(undefined, 'badge');
    assert.equal(badge.wrapperClass, 'inline-flex h-6 items-center gap-2 whitespace-nowrap text-[13px] font-medium text-stone-700');
    assert.equal(badge.iconClass, 'text-base leading-none');
    assert.equal(badge.iconAfter, false);
    /* ProductDetail today: <div className="flex items-center gap-2 text-xs text-stone-500"> + <Icon className="text-green-500 flex-shrink-0" /> */
    const product = resolveMessageStyle(undefined, 'product');
    assert.equal(product.wrapperClass, 'flex items-center gap-2 text-xs text-stone-500');
    assert.equal(product.iconKind, 'line', 'the list’s own truck icon');
    assert.equal(product.iconClass, 'text-green-500 flex-shrink-0');
    for (const surface of SURFACES) {
      assert.equal(resolveMessageStyle(undefined, surface).textClass, '');
      assert.deepEqual(resolveMessageStyle(DEFAULT_DELIVERY_MESSAGE, surface), resolveMessageStyle(null, surface));
      assert.deepEqual(resolveMessageStyle({ junk: 1 }, surface), resolveMessageStyle(undefined, surface));
    }
  });

  test('each default choice adds no class of its own: weight “Regular”, size “Standard” and spacing “Standard” are the surface’s own', () => {
    for (const [surface, weight] of [['bar', ''], ['tagline', ''], ['badge', 'font-medium'], ['product', '']]) {
      const base = resolveMessageStyle(undefined, surface).wrapperClass;
      assert.equal(resolveMessageStyle({ style: { weight: 'normal', size: 'md', tracking: 'normal', font: 'sans' } }, surface).wrapperClass, base);
      assert.equal(has(base, 'font-medium'), weight === 'font-medium', `${surface}: the badge is medium weight today`);
      assert.ok(!/\b(font-serif|font-classic|italic|uppercase|tracking-)/.test(base));
    }
    /* …and a choice replaces the surface’s own class instead of adding a rival to it. */
    assert.ok(!has(resolveMessageStyle({ style: { size: 'lg' } }, 'badge').wrapperClass, 'text-[13px]'));
    assert.ok(has(resolveMessageStyle({ style: { size: 'lg' } }, 'badge').wrapperClass, 'text-sm'));
    assert.ok(!has(resolveMessageStyle({ style: { size: 'sm' } }, 'product').wrapperClass, 'text-xs'));
    assert.ok(!has(resolveMessageStyle({ style: { weight: 'bold' } }, 'badge').wrapperClass, 'font-medium'));
    assert.ok(has(resolveMessageStyle({ style: { weight: 'bold' } }, 'badge').wrapperClass, 'font-bold'));
    assert.ok(!has(resolveMessageStyle({ style: { tone: 'gold' } }, 'badge').wrapperClass, 'text-stone-700'));
    assert.ok(!has(resolveMessageStyle({ style: { tone: 'gold' } }, 'bar').wrapperClass, 'text-gold-200/80'));
  });

  test('each font, weight, size and spacing choice reaches the wrapper', () => {
    for (const surface of SURFACES) {
      const w = (style) => resolveMessageStyle({ style }, surface).wrapperClass;
      assert.ok(has(w({ font: 'serif' }), 'font-serif'));
      assert.ok(has(w({ font: 'classic' }), 'font-classic'));
      assert.ok(has(w({ italic: true }), 'italic'));
      assert.ok(has(w({ uppercase: true }), 'uppercase'));
      assert.ok(has(w({ weight: 'semibold' }), 'font-semibold'));
      assert.ok(has(w({ weight: 'medium' }), 'font-medium'));
      assert.notEqual(w({ size: 'sm' }), w({ size: 'md' }));
      assert.notEqual(w({ size: 'lg' }), w({ size: 'md' }));
      assert.notEqual(w({ size: 'sm' }), w({ size: 'lg' }));
      assert.notEqual(w({ tracking: 'wide' }), w({ tracking: 'normal' }));
      assert.notEqual(w({ tracking: 'wider' }), w({ tracking: 'wide' }));
    }
    /* The strip already runs at tracking-wide: “Wide” is one step beyond that. */
    assert.ok(has(resolveMessageStyle({ style: { tracking: 'wide' } }, 'bar').wrapperClass, 'tracking-wider'));
    assert.ok(has(resolveMessageStyle({ style: { tracking: 'wide' } }, 'badge').wrapperClass, 'tracking-wide'));
  });

  test('models on the fixed rows are exactly 24px tall (h-6) or no taller than the row: no padding that grows, no taller class', () => {
    const forbidden = /(^|\s)(?:py-\d|pt-|pb-|p-\d|min-h-|h-(?:7|8|9|10|11|12|\[)|leading-(?:7|8|9|10|loose|relaxed)|text-(?:base|lg|xl|2xl))/;
    for (const surface of ['bar', 'tagline', 'badge']) for (const model of MODELS) for (const size of values('sizes')) for (const tracking of values('trackings')) for (const weight of values('weights')) {
      for (const tone of ['auto', ...NAMED, 'custom']) {
        const r = resolveMessageStyle({ style: { model, size, tracking, weight, tone } }, surface);
        const where = `${surface}/${model}/${size}/${tone}`;
        assert.doesNotMatch(r.wrapperClass, forbidden, where);
        assert.doesNotMatch(r.textClass, forbidden, where);
        if (surface === 'badge') assert.ok(has(r.wrapperClass, 'h-6') && has(r.wrapperClass, 'whitespace-nowrap'), `${where}: the badge row is 24px and one line`);
        if (model === 'pill' || model === 'solid' || model === 'outline') assert.ok(has(r.wrapperClass, 'h-6') || surface === 'badge', `${where}: a drawn shape is 24px`);
        if (model === 'outline' && surface !== 'badge') assert.ok(has(r.wrapperClass, 'leading-[22px]'), `${where}: the 1px borders count: 22 + 2`);
      }
    }
  });

  test('a long text on the hero badge may wrap instead of being cut off; nothing else changes', () => {
    assert.equal(WRAP_AFTER, 28);
    const short = resolveMessageStyle({ style: { model: 'pill' } }, 'badge');
    const long = resolveMessageStyle({ style: { model: 'pill' } }, 'badge', { long: true });
    assert.ok(has(short.wrapperClass, 'h-6') && has(short.wrapperClass, 'whitespace-nowrap'));
    assert.ok(!has(long.wrapperClass, 'h-6') && !has(long.wrapperClass, 'whitespace-nowrap'));
    assert.ok(has(long.wrapperClass, 'min-h-6') && has(long.wrapperClass, 'max-w-full'));
    assert.ok(has(long.wrapperClass, 'rounded-full'), 'same shape and colours');
    for (const surface of ['bar', 'tagline', 'product']) assert.deepEqual(resolveMessageStyle({ style: { model: 'pill' } }, surface, { long: true }), resolveMessageStyle({ style: { model: 'pill' } }, surface), surface);
    /* the defaults are shorter than the limit, so the default badge stays the fixed row */
    assert.ok(DEFAULT_DELIVERY_MESSAGE.badgeText.length <= WRAP_AFTER && DEFAULT_DELIVERY_MESSAGE.barText.length <= WRAP_AFTER);
  });

  test('custom colours become inline style only, as validated lower-case hex, and only where they can be read', () => {
    const style = (model, tone = 'custom') => ({ style: { model, tone, colors: { text: '#FFFFFF', bg: '#8B1A4A' } } });
    assert.deepEqual(resolveMessageStyle(style('pill'), 'badge').wrapperStyle, { color: '#ffffff', backgroundColor: '#8b1a4a' });
    assert.deepEqual(resolveMessageStyle(style('solid'), 'product').wrapperStyle, { color: '#ffffff', backgroundColor: '#8b1a4a' });
    assert.deepEqual(resolveMessageStyle(style('outline'), 'bar').wrapperStyle, { color: '#ffffff', borderColor: '#ffffff' }, 'white outline on the dark strip');
    assert.deepEqual(resolveMessageStyle(style('text'), 'tagline').wrapperStyle, { color: '#ffffff' });
    assert.deepEqual(resolveMessageStyle(style('underline'), 'bar').wrapperStyle, { color: '#ffffff' });
    /* white text on the cream hero cannot be read: that surface falls back to the automatic look; the strip keeps it */
    assert.deepEqual(resolveMessageStyle(style('text'), 'badge').wrapperStyle, {});
    assert.ok(has(resolveMessageStyle(style('text'), 'badge').wrapperClass, 'text-stone-700'));
    assert.deepEqual(resolveMessageStyle(style('outline'), 'product').wrapperStyle, {});
    assert.ok(has(resolveMessageStyle(style('outline'), 'product').wrapperClass, 'border-gold-500'));
    assert.deepEqual(resolveMessageStyle(style('text'), 'bar').wrapperStyle, { color: '#ffffff' });
    assert.ok(!/\btext-/.test(resolveMessageStyle(style('text'), 'bar').wrapperClass.replace(/text-\[|text-(xs|sm)\b/g, '')), 'no colour class competes with the inline colour');
    /* a pill with an unreadable pair is not applied at all */
    const bad = { style: { model: 'pill', tone: 'custom', colors: { text: '#ffffff', bg: '#fafafa' } } };
    assert.deepEqual(resolveMessageStyle(bad, 'badge').wrapperStyle, {});
    assert.deepEqual(resolveMessageStyle(bad, 'badge'), resolveMessageStyle({ style: { model: 'pill', tone: 'auto' } }, 'badge'));
    /* named tones and auto never carry inline style, whatever colours are stored */
    for (const tone of ['auto', ...NAMED]) for (const model of MODELS) for (const surface of SURFACES) assert.deepEqual(resolveMessageStyle(style(model, tone), surface).wrapperStyle, {}, `${tone}/${model}/${surface}`);
    /* hostile colour strings never reach the style */
    const hostile = { style: { model: 'solid', tone: 'custom', colors: { text: 'red;background:url(//evil/x)', bg: 'expression(alert(1))' } } };
    for (const surface of SURFACES) {
      const s = resolveMessageStyle(hostile, surface).wrapperStyle;
      for (const v of Object.values(s)) assert.match(v, /^#[0-9a-f]{6}$/);
    }
  });

  test('icons: the product page keeps its own truck line icon; every other emoji, and the strip’s second state, behave as described', () => {
    assert.equal(resolveMessageStyle({ icon: '✨' }, 'product').iconKind, 'emoji');
    assert.equal(resolveMessageStyle({ icon: '✨' }, 'product').iconClass, 'flex-shrink-0 leading-none');
    assert.equal(resolveMessageStyle({ icon: '' }, 'product').iconKind, 'none');
    assert.equal(resolveMessageStyle({ icon: '' }, 'bar').iconKind, 'none');
    assert.equal(resolveMessageStyle({ icon: '' }, 'badge').icon, '');
    assert.equal(resolveMessageStyle({ icon: '🎁' }, 'badge').icon, '🎁');
    assert.equal(resolveMessageStyle({ icon: '🎁' }, 'tagline').iconKind, 'none');
    /* the green line icon only on the list’s own look; on a coloured shape it follows the text colour */
    assert.equal(resolveMessageStyle({ style: { model: 'solid' } }, 'product').iconClass, 'flex-shrink-0');
    assert.equal(resolveMessageStyle({ style: { tone: 'wine' } }, 'product').iconClass, 'flex-shrink-0');
    assert.equal(resolveMessageStyle({ style: { model: 'underline' } }, 'product').iconClass, 'text-green-500 flex-shrink-0');
    /* the underline accent sits on the words, never on the icon */
    const u = resolveMessageStyle({ style: { model: 'underline' } }, 'badge');
    assert.match(u.textClass, /^underline decoration-2 underline-offset-4 decoration-gold-400$/);
    assert.equal(resolveMessageStyle({ style: { model: 'pill' } }, 'badge').textClass, '');
  });

  test('unknown surfaces and junk never throw: they are drawn as a product-page row', () => {
    for (const surface of [undefined, null, '', 'footer', 'BAR', 'toString', '__proto__', 5, {}, []]) {
      assert.deepEqual(resolveMessageStyle(undefined, surface), resolveMessageStyle(undefined, 'product'), String(surface));
    }
    for (const config of JSON.parse('[null,"x",5,[],{"style":"x"},{"__proto__":{"style":{"model":"pill"}}}]')) {
      assert.doesNotThrow(() => resolveMessageStyle(config, 'bar'));
    }
    assert.deepEqual(MESSAGE_SURFACES, ['bar', 'tagline', 'badge', 'product']);
  });
});

/* ═══ <DeliveryMessage> ═══ */

describe('DeliveryMessage (server render)', { skip }, () => {
  const T = 'Free Delivery across India';
  const B = 'Free Nationwide Shipping';

  test('with the default configuration it is today’s markup on the strip and on the hero', () => {
    /* WelcomeBar: <span className="hidden min-[820px]:block flex-shrink-0 text-gold-200/80">{shippingLine} <span aria-hidden="true">🚚</span></span> */
    assert.equal(
      draw({ text: T, surface: 'bar', className: 'hidden min-[820px]:block' }, { stringify: renderToString }),
      '<span class="hidden min-[820px]:block flex-shrink-0 text-gold-200/80">Free Delivery across India<!-- --> <span aria-hidden="true">🚚</span></span>',
    );
    assert.equal(draw({ text: T, surface: 'bar', className: 'hidden min-[820px]:block' }), '<span class="hidden min-[820px]:block flex-shrink-0 text-gold-200/80">Free Delivery across India <span aria-hidden="true">🚚</span></span>');
    /* HeroSection: <li className="…"><span aria-hidden="true" className="text-base leading-none">{icon}</span>{label}</li> */
    assert.equal(
      draw({ text: B, surface: 'badge', as: 'li' }),
      '<li class="inline-flex h-6 items-center gap-2 whitespace-nowrap text-[13px] font-medium text-stone-700"><span aria-hidden="true" class="text-base leading-none">🚚</span>Free Nationwide Shipping</li>',
    );
    /* the strip’s second state is the bare words: no element at all, as the line always had them */
    assert.equal(draw({ text: T, surface: 'tagline' }), 'Free Delivery across India');
    /* the same with config={defaults}, and the explicit defaults from a normalized value */
    for (const config of [undefined, null, DEFAULT_DELIVERY_MESSAGE, {}, normalizeDeliveryMessage(null), { style: { tone: 'auto', model: 'text' } }]) {
      assert.equal(draw({ text: B, surface: 'badge', as: 'li', config }), draw({ text: B, surface: 'badge', as: 'li' }));
    }
  });

  test('on the product page the default is the list’s own cell: its classes, its green truck, a space, the words in a <span>', () => {
    const html = draw({ text: T, surface: 'product' });
    assert.match(html, /^<div class="flex items-center gap-2 text-xs text-stone-500"><svg [^>]*class="text-green-500 flex-shrink-0"[^>]*>/);
    assert.match(html, /<\/svg> <span>Free Delivery across India<\/span><\/div>$/, 'exactly the markup of the list’s other cells: svg, space, span');
    assert.doesNotMatch(html, /aria-hidden/, 'as the list’s other cells: the truck is a bare line icon');
    assert.equal((html.match(/<svg/g) || []).length, 1);
  });

  test('the default markup is byte for byte what the pages drew before the message was editable', () => {
    /* HEAD, spelled out. Strip (offer state): the clause is bare words, a space, the hidden emoji. */
    assert.equal(
      draw({ text: T, surface: 'bar', className: 'hidden min-[820px]:block' }),
      '<span class="hidden min-[820px]:block flex-shrink-0 text-gold-200/80">Free Delivery across India <span aria-hidden="true">🚚</span></span>',
    );
    /* Strip (tagline state): `{shippingLine} &nbsp;·&nbsp;` — the words and nothing around them, in the line's own text. */
    const line = (clause) => renderToStaticMarkup(React.createElement('p', null, clause, ' \u00a0·\u00a0'));
    assert.equal(line(draw({ text: T, surface: 'tagline' })), line(T));
    assert.equal(renderToStaticMarkup(React.createElement('p', null, React.createElement(DeliveryMessage, { text: T, surface: 'tagline', className: '' }), ' \u00a0·\u00a0')), line(T), 'the strip passes an empty className at the stock look');
    /* Hero badge: the li, the hidden emoji, the bare words. */
    assert.equal(
      draw({ text: B, surface: 'badge', as: 'li' }),
      '<li class="inline-flex h-6 items-center gap-2 whitespace-nowrap text-[13px] font-medium text-stone-700"><span aria-hidden="true" class="text-base leading-none">🚚</span>Free Nationwide Shipping</li>',
    );
    /* Product trust list: the same cell as its other three, which are `<Icon className="text-green-500 flex-shrink-0" /> <span>{label}</span>`. */
    const cell = (Icon, label) => renderToStaticMarkup(React.createElement('div', { className: 'flex items-center gap-2 text-xs text-stone-500' }, React.createElement(Icon, { className: 'text-green-500 flex-shrink-0' }), ' ', React.createElement('span', null, label)));
    assert.equal(draw({ text: T, surface: 'product' }), cell(require('react-icons/fi').FiTruck, T));
  });

  test('a wrapper with nothing on it is not drawn, but an element the caller asked for always is', () => {
    assert.equal(draw({ text: T, surface: 'tagline' }), T);
    assert.equal(draw({ text: T, surface: 'tagline', className: '' }), T);
    assert.equal(draw({ text: T, surface: 'tagline', className: 'max-w-[45%] truncate' }), '<span class="max-w-[45%] truncate">Free Delivery across India</span>');
    assert.equal(draw({ text: T, surface: 'tagline', as: 'span' }), '<span>Free Delivery across India</span>');
    assert.equal(draw({ text: T, surface: 'tagline', config: { icon: '' , style: { weight: 'bold' } } }), '<span class="font-bold">Free Delivery across India</span>');
    assert.match(draw({ text: T, surface: 'tagline', config: { style: { tone: 'custom', colors: { text: '#ffffff', bg: '#000000' } } } }), /^<span style="color:#ffffff">Free Delivery across India<\/span>$/);
    assert.match(draw({ text: T, surface: 'tagline', config: { style: { model: 'underline' } } }), /^<span><span class="underline decoration-2 underline-offset-4 decoration-gold-400\/70">Free Delivery across India<\/span><\/span>$/);
  });

  test('draws nothing for empty or non-text words; trims; never renders markup from the words', () => {
    for (const text of [undefined, null, '', '   ', '\n', 5, true, [], {}, ['Free']]) {
      for (const surface of SURFACES) assert.equal(draw({ text, surface }), '', `${JSON.stringify(text)} on ${surface}`);
    }
    assert.equal(draw({ text: '  Free  ', surface: 'tagline' }), 'Free');
    assert.equal(draw({ text: '  Free  ', surface: 'tagline', className: 'x' }), '<span class="x">Free</span>');
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>&amp; "q" \'s\'';
    for (const surface of SURFACES) for (const model of MODELS) {
      const html = draw({ text: evil, surface, config: { style: { model } } });
      assert.doesNotMatch(html, /<img|<script/i, `${surface}/${model}`);
      assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&lt;script&gt;/);
      assert.match(html, /&amp;amp;/);
      assert.match(html, /&quot;q&quot;/);
    }
  });

  test('every model × tone × surface × font/italic/uppercase renders: one root, escaped text, hidden icon, style only from validated custom colours', () => {
    let rendered = 0;
    const variants = [{}, { italic: true }, { uppercase: true }, { italic: true, uppercase: true, font: 'serif', weight: 'bold', size: 'lg', tracking: 'wider' }];
    for (const surface of SURFACES) for (const model of MODELS) for (const tone of TONES) for (const extra of variants) {
      const config = { style: { model, tone, colors: { text: '#FFFFFF', bg: '#8B1A4A' }, ...extra } };
      const where = JSON.stringify({ surface, model, tone, ...extra });
      let html;
      assert.doesNotThrow(() => { html = draw({ text: 'A & B <i>', surface, config }); }, where);
      rendered += 1;
      /* one root element — except the strip's second state at the stock look, which is just the (escaped) words */
      if (surface === 'tagline' && model === 'text' && tone === 'auto' && !Object.keys(extra).length) assert.equal(html, 'A &amp; B &lt;i&gt;', where);
      else assert.match(html, /^<(span|div)[ >]/, where);
      assert.match(html, /A &amp; B &lt;i&gt;/, where);
      assert.doesNotMatch(html, /<i>/, where);
      if (extra.italic) assert.match(html, /\bitalic\b/, where);
      if (extra.uppercase) assert.match(html, /\buppercase\b/, where);
      if (!extra.italic) assert.doesNotMatch(html, /\bitalic\b/, where);
      if (!extra.uppercase) assert.doesNotMatch(html, /\buppercase\b/, where);
      /* the emoji is never read out */
      for (const m of html.matchAll(/<span([^>]*)>(🚚|✨|🎁|✅|💛)<\/span>/g)) assert.match(m[1], /aria-hidden="true"/, where);
      /* inline style: only custom colours, only validated hex */
      const styleAttr = html.match(/ style="([^"]*)"/);
      if (styleAttr) {
        assert.equal(tone, 'custom', where);
        for (const part of styleAttr[1].split(';')) assert.match(part, /^(?:color|background-color|border-color):#[0-9a-f]{6}$/, where);
      } else if (tone === 'custom') {
        /* white on the cream/white surfaces cannot be read for a model without its own background */
        assert.ok(!modelHasBackground(model) && (surface === 'badge' || surface === 'product'), where);
      }
      /* the one element between the wrapper and the text for the underline model, none otherwise */
      if (model === 'underline') assert.match(html, /<span class="underline decoration-2 underline-offset-4/, where);
      else assert.doesNotMatch(html, /underline/, where);
    }
    assert.equal(rendered, 4 * 5 * 7 * 4);
  });

  test('the inline style carries exactly the validated colours, on the right element', () => {
    const cfg = (model, text, bg) => ({ style: { model, tone: 'custom', colors: { text, bg } } });
    assert.match(draw({ text: T, surface: 'badge', as: 'li', config: cfg('pill', '#FFFFFF', '#8B1A4A') }), /^<li class="[^"]*rounded-full[^"]*" style="color:#ffffff;background-color:#8b1a4a">/);
    assert.match(draw({ text: T, surface: 'bar', config: cfg('outline', '#FFD700', '#000000') }), / style="color:#ffd700;border-color:#ffd700"/);
    assert.match(draw({ text: T, surface: 'product', config: cfg('solid', '#000000', '#FFFFFF') }), / style="color:#000000;background-color:#ffffff"/);
    /* the underline: the words carry the accent, the colour is the text colour */
    const u = draw({ text: T, surface: 'product', config: cfg('underline', '#8b1a4a', '#ffffff') });
    assert.match(u, / style="color:#8b1a4a"/);
    assert.match(u, /<span class="underline decoration-2 underline-offset-4">Free Delivery across India<\/span>/);
    /* hostile colours are the default colours; unusable pairs are not applied */
    const hostile = draw({ text: T, surface: 'badge', config: cfg('solid', 'red;background:url(//evil)', '"><script>alert(1)</script>') });
    assert.doesNotMatch(hostile, /evil|script|url\(/);
    assert.doesNotMatch(draw({ text: T, surface: 'badge', config: cfg('pill', '#ffffff', '#fefefe') }), /style=/);
    assert.doesNotMatch(draw({ text: T, surface: 'bar', config: { style: { tone: 'gold' } } }), /style=/);
  });

  test('icons: placement, hiding and the product page’s truck', () => {
    assert.equal(draw({ text: T, surface: 'bar', config: { icon: '' } }), '<span class="flex-shrink-0 text-gold-200/80">Free Delivery across India</span>', 'no icon, no stray space');
    assert.equal(draw({ text: B, surface: 'badge', as: 'li', config: { icon: '' } }), '<li class="inline-flex h-6 items-center gap-2 whitespace-nowrap text-[13px] font-medium text-stone-700">Free Nationwide Shipping</li>');
    assert.match(draw({ text: T, surface: 'bar', config: { icon: '🎁' } }), /India <span aria-hidden="true">🎁<\/span><\/span>$/, 'after the words on the strip');
    assert.match(draw({ text: B, surface: 'badge', config: { icon: '💛' } }), /><span aria-hidden="true" class="text-base leading-none">💛<\/span>Free Nationwide Shipping<\/span>$/, 'before the words on the hero');
    assert.doesNotMatch(draw({ text: T, surface: 'tagline', config: { icon: '🎁' } }), /🎁/);
    assert.match(draw({ text: T, surface: 'product', config: { icon: '✨' } }), /<span aria-hidden="true" class="flex-shrink-0 leading-none">✨<\/span> <span>Free Delivery across India<\/span><\/div>$/);
    assert.equal(draw({ text: T, surface: 'product', config: { icon: '' } }), '<div class="flex items-center gap-2 text-xs text-stone-500"><span>Free Delivery across India</span></div>', 'no icon, no stray space');
  });

  test('the element can be chosen from a short list; the caller’s classes go first; junk props are ignored', () => {
    assert.match(draw({ text: B, surface: 'badge', as: 'li' }), /^<li /);
    assert.match(draw({ text: B, surface: 'badge', as: 'p' }), /^<p /);
    assert.match(draw({ text: B, surface: 'badge', as: 'div' }), /^<div /);
    assert.match(draw({ text: B, surface: 'badge' }), /^<span /);
    assert.match(draw({ text: B, surface: 'product' }), /^<div /);
    for (const as of ['script', 'a', 'iframe', '__proto__', 'toString', 5, {}, null]) assert.match(draw({ text: B, surface: 'badge', as }), /^<span /, String(as));
    assert.match(draw({ text: B, surface: 'bar', className: 'ml-2 hidden' }), /^<span class="ml-2 hidden flex-shrink-0 text-gold-200\/80">/);
    for (const className of [5, {}, [], null, undefined, true]) assert.match(draw({ text: B, surface: 'bar', className }), /^<span class="flex-shrink-0 text-gold-200\/80">/);
    for (const surface of [undefined, null, 'x', '__proto__']) assert.doesNotThrow(() => draw({ text: B, surface }));
    assert.match(draw({ text: B, surface: 'x' }), /^<div /, 'an unknown surface is a product-style row');
  });

  test('a long text on the hero badge wraps instead of being clipped; the default text keeps the fixed row', () => {
    const long = 'Free delivery on every single order across all of India';
    assert.ok(long.length > WRAP_AFTER && long.length <= DELIVERY_TEXT_MAX);
    const html = draw({ text: long, surface: 'badge', as: 'li' });
    assert.match(html, /min-h-6 max-w-full/);
    assert.doesNotMatch(html, /[ "]h-6[ "]|whitespace-nowrap/);
    assert.match(draw({ text: B, surface: 'badge', as: 'li' }), /[ "]h-6 .*whitespace-nowrap/);
    assert.match(draw({ text: 'x'.repeat(WRAP_AFTER), surface: 'badge' }), /[ "]h-6[ "]/);
    assert.match(draw({ text: 'x'.repeat(WRAP_AFTER + 1), surface: 'badge' }), /min-h-6/);
  });

  test('it is a plain function component: no hooks, no client directive, so it renders on the server and in the browser', () => {
    const file = read('src/components/ui/DeliveryMessage.jsx');
    assert.doesNotMatch(file, /^\s*['"]use client['"]/m);
    assert.doesNotMatch(file, /\buse(State|Effect|Ref|Memo|Callback|Context|SyncExternalStore|Id)\b/);
    assert.doesNotMatch(file, /dangerouslySetInnerHTML/);
    assert.equal(typeof DeliveryMessage, 'function');
  });
});

describe('the whole path: settings → words → markup', { skip }, () => {
  test('what the owner saved is what each surface draws; switched off or paid shipping draws nothing', () => {
    const settings = { deliveryMessage: { barText: 'Free shipping, always', badgeText: '100% free delivery', icon: '🎁', style: { model: 'pill', tone: 'wine', weight: 'semibold' } } };
    const config = pickDeliveryMessage(settings);
    const bar = deliveryMessageFor(config, FREE, 'bar');
    const badge = deliveryMessageFor(config, FREE, 'badge');
    const barHtml = draw({ text: bar, config, surface: 'bar' });
    assert.match(barHtml, /Free shipping, always <span aria-hidden="true">🎁<\/span>/);
    assert.match(barHtml, /\bfont-semibold\b.*\bbg-wine-800 text-wine-50\b/, 'the pill, in the dark strip’s wine');
    assert.match(draw({ text: badge, config, surface: 'badge', as: 'li' }), /^<li class="inline-flex h-6 [^"]*rounded-full[^"]*bg-wine-100 text-wine-900"/);
    /* paid shipping in Smart mode: the words are '' and the component draws nothing */
    for (const surface of ['bar', 'badge', 'product']) assert.equal(draw({ text: deliveryMessageFor(config, PAID, surface), config, surface }), '');
    const off = pickDeliveryMessage({ deliveryMessage: { ...settings.deliveryMessage, enabled: false, mode: 'always' } });
    for (const surface of ['bar', 'badge', 'product']) assert.equal(draw({ text: deliveryMessageFor(off, FREE, surface), config: off, surface }), '');
  });
});

/* ═══ What every storefront page downloads ═══ */

describe('the storefront does not carry the admin’s words', () => {
  /* Every file a page's JavaScript pulls in through static imports ('@/…' is src/…); dynamic import() is lazy, so it does not count. */
  function closure(entry) {
    const seen = new Set();
    const stack = [path.resolve(entry)];
    const find = (base) => ['', '.js', '.jsx', '.mjs', '/index.js'].map((ext) => base + ext).find((f) => { try { return readFileSync(f, 'utf8') !== null && !f.endsWith('/'); } catch { return false; } });
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:\bfrom|\bimport)\s+'([^']+)'/g)) {
        const spec = m[1];
        const base = spec.startsWith('@/') ? path.resolve('src', spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null;
        const next = base && find(base);
        if (next) stack.push(next);
      }
    }
    return [...seen].map((f) => path.relative(path.resolve('.'), f));
  }
  const ADMIN_ONLY = ['src/components/admin/deliveryMessageAdmin.js', 'src/components/admin/DeliveryMessagePanel.jsx'];
  const STOREFRONT = [
    'src/components/layout/WelcomeBar.jsx', // in the root layout: every page
    'src/app/layout.js',
    'src/app/HomeClient.js',
    'src/app/product/[id]/ProductDetail.js',
  ];

  test('no storefront entry point imports the admin’s labels, warning or colour advice (they would ride in every page’s first load)', () => {
    for (const entry of STOREFRONT) {
      const files = closure(entry);
      assert.ok(files.includes('src/lib/deliveryMessage.js'), `${entry} reads the lib (the walk works)`);
      for (const adminFile of ADMIN_ONLY) assert.ok(!files.includes(adminFile), `${entry} must not import ${adminFile}`);
    }
    /* …while the admin page does use them. */
    assert.ok(closure('src/app/admin/settings/page.js').includes('src/components/admin/deliveryMessageAdmin.js'));
  });

  test('the lib keeps to what the storefront needs: plain values, normalising, the truth table, the contrast maths', () => {
    for (const gone of ['DELIVERY_OPTIONS', 'contrastNote', 'deliveryMismatch', 'CONTRAST_GOOD']) assert.equal(gone in lib, false, `${gone} is the admin’s`);
    /* (comments are not shipped, so only the code counts) */
    const src = read('src/lib/deliveryMessage.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const copy of ['Georgia-style', 'Soft pill', 'Extra wide', 'Custom colours', 'Smart (recommended)', 'still charge for delivery', 'jewellery-style serif', 'hard to read']) {
      assert.ok(!src.includes(copy), `the lib must not hold the owner-facing words "${copy}"`);
    }
    for (const kept of ['DELIVERY_CHOICES', 'normalizeDeliveryMessage', 'pickDeliveryMessage', 'sameDeliveryMessage', 'nextDeliveryMessage', 'deliveryMessageFor', 'contrastRatio', 'SURFACE_COLORS', 'CONTRAST_MIN', 'modelHasBackground']) assert.ok(kept in lib, kept);
    /* The admin module is where the words went. */
    const admin = read('src/components/admin/deliveryMessageAdmin.js');
    for (const copy of ['Georgia-style', 'Soft pill', 'still charge for delivery']) assert.ok(admin.includes(copy), copy);
  });
});
