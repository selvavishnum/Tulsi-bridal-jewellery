/* ─────────────────────────────────────────────
   The admin's "Delivery Message" card:

   - src/components/admin/deliveryMessageAdmin.js — the pure logic behind it
     (what a typed value becomes, what the storefront would do right now, what
     to tell the owner about the colours they picked, the reset), tested directly;
   - src/components/admin/DeliveryMessagePanel.jsx — the card itself: rendered
     to HTML with the real React in every state that matters (default, switched
     off, "Always" while shipping is charged, unreadable custom colours, each
     model / tone / font …) and driven through a tiny hook runner (a click, a
     typed word, a half-typed colour) to see what it hands the settings page;
   - src/app/admin/settings/page.js — still imports and renders, with the card
     in the Marketing tab right under the welcome-offer card;
   - the welcome-offer card's help copy points to the new card.

   The JSX files are transpiled here with sucrase (already in node_modules via
   tailwindcss) and wired to stubs by hand; if sucrase is ever missing the JSX
   parts are skipped with that reason, never silently green.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as lib from '../src/lib/deliveryMessage.js';
import * as admin from '../src/components/admin/deliveryMessageAdmin.js';
import * as style from '../src/components/ui/deliveryMessageStyle.js';
import * as welcomeOffer from '../src/lib/welcomeOffer.js';
import { DEFAULT_CHARGES, freeShippingLine } from '../src/lib/storeCharges.js';

const {
  DEFAULT_DELIVERY_MESSAGE, DELIVERY_TEXT_MAX, DEFAULT_BAR_TEXT, DEFAULT_BADGE_TEXT, normalizeDeliveryMessage, contrastRatio,
} = lib;
const {
  DELIVERY_OPTIONS, COLOR_TYPING_HINT, colorRefusal, SAMPLE_WORDS, SURFACE_NAMES, typedText, editableConfig, changeConfig, changeStyle, changeColor, parseHexInput, isCompleteHex,
  lookIsDefault, resetLook, sampleConfig, previewState, contrastNotes,
} = admin;

const FREE = { ...DEFAULT_CHARGES, enable_shipping_fee: false };
const PAID = DEFAULT_CHARGES;

const require = createRequire(import.meta.url);
let sucrase = null;
try { sucrase = require('sucrase'); } catch { /* skipped below */ }
const skip = sucrase ? false : 'sucrase is not installed, so the admin card cannot be transpiled for node --test';
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

/* ── Loading a client file with its imports wired by hand ── */
function load(rel, deps) {
  const file = path.resolve(rel);
  const { code } = sucrase.transform(readFileSync(file, 'utf8'), { transforms: ['jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: file });
  const all = { 'react/jsx-runtime': require('react/jsx-runtime'), ...deps };
  const mod = { exports: {} };
  vm.runInThisContext(`(function (exports, require, module) {${code}\n})`, { filename: file })(mod.exports, (id) => {
    if (!Object.hasOwn(all, id)) throw new Error(`${rel} imports ${id}: add a stub for it in this test`);
    return all[id];
  }, mod);
  return mod.exports;
}
const icon = (name) => { const Icon = (props) => React.createElement('svg', { 'data-icon': name, ...props }); Icon.displayName = name; return Icon; };
const icons = new Proxy({}, { get: (_, name) => (typeof name === 'string' && name.startsWith('Fi') ? icon(name) : undefined) });
const esm = (value) => ({ __esModule: true, default: value });

/* The charges the card reads through useCart(), changeable per test. */
const cart = { charges: FREE };
const useCart = () => cart;
const withCharges = (charges, fn) => { const before = cart.charges; cart.charges = charges; try { return fn(); } finally { cart.charges = before; } };

const DeliveryMessage = sucrase ? load('src/components/ui/DeliveryMessage.jsx', { 'react-icons/fi': icons, './deliveryMessageStyle': style }).default : null;
const panelDeps = (react) => ({
  react,
  'react-icons/fi': icons,
  '@/context/CartContext': { useCart },
  '@/components/ui/DeliveryMessage': esm(DeliveryMessage),
  '@/lib/deliveryMessage': lib,
  '@/components/admin/deliveryMessageAdmin': admin,
});
const PANEL = 'src/components/admin/DeliveryMessagePanel.jsx';
const Panel = sucrase ? load(PANEL, panelDeps(React)).default : null;

/* ── Reading the HTML ── */
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = (h) => squash(decode(h.replace(/<[^>]*>/g, ' ')));
const tagAttrs = (tag) => Object.fromEntries([...tag.matchAll(/\s([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g)].map((m) => [m[1], decode(m[2] ?? '')]));
const inputTags = (h) => [...h.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
const radios = (h, name) => inputTags(h).map(tagAttrs).filter((a) => a.type === 'radio' && a.name === name).map((a) => ({ value: a.value, checked: 'checked' in a }));
const checkedRadio = (h, name) => radios(h, name).filter((r) => r.checked).map((r) => r.value);
const inputById = (h, id) => inputTags(h).map(tagAttrs).find((a) => a.id === id);
const section = (h, id) => { const m = h.match(new RegExp(`<section aria-labelledby="${id}".*?</section>`, 's')); assert.ok(m, `section ${id}`); return m[0]; };

/* Render, failing on any React warning (missing keys, bad DOM props …). */
function render(value, charges = FREE, Component = Panel) {
  const warnings = [];
  const orig = console.error;
  console.error = (...args) => { warnings.push(args.map(String).join(' ')); };
  let html;
  try { html = withCharges(charges, () => renderToStaticMarkup(React.createElement(Component, { value, onChange() {} }))); } finally { console.error = orig; }
  assert.deepEqual(warnings, [], 'React warned while rendering');
  return html;
}
/* What the storefront's own component draws, for comparing with the card's preview and samples. */
const draw = (text, config, surface, extra = {}) => renderToStaticMarkup(React.createElement(DeliveryMessage, { text, config, surface, ...extra }));

const custom = (colors, model = 'text', extra = {}) => ({ style: { tone: 'custom', model, colors, ...extra } });

/* ═════════════ deliveryMessageAdmin.js: typed text ═════════════ */

describe('typedText', () => {
  test('keeps what is typed, but no < >, no line breaks, at most 60 characters', () => {
    assert.equal(typedText('Free delivery'), 'Free delivery');
    assert.equal(typedText('<b>Free</b>'), 'bFree/b');
    assert.equal(typedText('a\nb\r\nc\td'), 'a b  c d');
    assert.equal(typedText('x'.repeat(80)), 'x'.repeat(DELIVERY_TEXT_MAX));
    for (const junk of [undefined, null, 5, {}, []]) assert.equal(typedText(junk), '', String(junk));
  });

  test('invisible characters (a paste can carry them) never reach the box; real joiners do', () => {
    assert.equal(typedText('F\u200bre\u2800e\u3164 \u{E0041}ship\u00ad'), 'Free ship');
    assert.equal(typedText('\u2800\u3164\u200b\u2063'), '', 'a paste of nothing visible is an empty box');
    assert.equal(typedText('❤️‍🔥 می\u200cخواهم'), '❤️‍🔥 می\u200cخواهم');
  });

  test('a trailing space survives (it is the start of the next word) and so does an empty box', () => {
    assert.equal(typedText('Free '), 'Free ');
    assert.equal(typedText(''), '');
  });

  test('never cuts inside an emoji', () => {
    const out = typedText(`${'a'.repeat(59)}🚚`);
    assert.equal(out, 'a'.repeat(59), 'the emoji needs two units and only one is left: it goes whole');
    assert.ok(out.length <= DELIVERY_TEXT_MAX);
    assert.equal(typedText('🚚'.repeat(40)).length, DELIVERY_TEXT_MAX);
    assert.doesNotMatch(typedText('🚚'.repeat(40)), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, 'no lone surrogate');
  });
});

/* ═════════════ editableConfig / change* ═════════════ */

describe('editableConfig — the form’s working copy', () => {
  test('nothing saved yet: the complete defaults, as plain fresh JSON', () => {
    for (const v of [undefined, null, 'x', 5, [], {}]) {
      const c = editableConfig(v);
      assert.deepEqual(c, DEFAULT_DELIVERY_MESSAGE, String(v));
      assert.notEqual(c, DEFAULT_DELIVERY_MESSAGE);
      assert.notEqual(c.style, DEFAULT_DELIVERY_MESSAGE.style);
      assert.equal(Object.isFrozen(c), false, 'the owner’s edits must never hit the frozen defaults');
      assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
    }
  });

  test('every choice is on its allow-list, whatever is stored', () => {
    const c = editableConfig({ enabled: 'yes', mode: 'sometimes', icon: '🔥', style: { font: 'comic', weight: 900, size: 'xl', tracking: 'loose', italic: 1, uppercase: 'y', model: 'blink', tone: 'neon', colors: { text: 'red', bg: 5 } } });
    assert.deepEqual(c, DEFAULT_DELIVERY_MESSAGE);
  });

  test('the two texts stay exactly as typed — even empty — so the box never fights the typist', () => {
    assert.equal(editableConfig({ barText: '' }).barText, '');
    assert.equal(editableConfig({ barText: 'Free ' }).barText, 'Free ');
    assert.equal(editableConfig({ badgeText: '' }).badgeText, '');
    assert.equal(editableConfig({}).barText, DEFAULT_BAR_TEXT);
    assert.equal(editableConfig({ barText: 42 }).barText, DEFAULT_BAR_TEXT, 'not a string: the default');
    assert.equal(editableConfig({ barText: '<b>hi</b>' }).barText, 'bhi/b');
    assert.equal(normalizeDeliveryMessage(editableConfig({ barText: '' })).barText, DEFAULT_BAR_TEXT, 'the storefront and the server turn empty into the default words');
  });

  test('a hard-to-read custom colour pair is kept (lenient), so the form can go on warning about it', () => {
    const v = custom({ text: '#888888', bg: '#8a8a8a' }, 'pill');
    assert.equal(editableConfig(v).style.tone, 'custom');
    assert.equal(normalizeDeliveryMessage(v).style.tone, 'auto', 'while the storefront would not use it');
  });

  test('does not read inherited properties or choke on hostile input', () => {
    const hostile = { get style() { throw new Error('boom'); } };
    assert.deepEqual(editableConfig(hostile), DEFAULT_DELIVERY_MESSAGE);
    const proto = JSON.parse('{"__proto__":{"enabled":false},"mode":"always"}');
    assert.equal(editableConfig(proto).mode, 'always');
    assert.equal(editableConfig(proto).enabled, true);
    assert.equal({}.enabled, undefined, 'nothing leaked onto Object.prototype');
  });
});

describe('changeConfig / changeStyle / changeColor — each hands the page the whole new object', () => {
  const base = { enabled: true, mode: 'auto', barText: 'Hi there', badgeText: 'Free shipping', icon: '✨', style: { ...DEFAULT_DELIVERY_MESSAGE.style, model: 'pill', tone: 'gold' } };
  const snapshot = JSON.stringify(base);

  test('changeConfig merges into the top level and leaves the rest alone', () => {
    const next = changeConfig(base, { enabled: false });
    assert.equal(next.enabled, false);
    assert.equal(next.mode, 'auto');
    assert.equal(next.barText, 'Hi there');
    assert.equal(next.style.model, 'pill');
    assert.equal(changeConfig(undefined, { mode: 'always' }).mode, 'always');
    assert.deepEqual(changeConfig(undefined, { mode: 'always' }).style, DEFAULT_DELIVERY_MESSAGE.style);
  });

  test('changeStyle merges into style only', () => {
    const next = changeStyle(base, { font: 'serif', italic: true });
    assert.equal(next.style.font, 'serif');
    assert.equal(next.style.italic, true);
    assert.equal(next.style.model, 'pill');
    assert.equal(next.icon, '✨');
    assert.equal(next.barText, 'Hi there');
  });

  test('changeColor sets one custom colour: "bg" is the background, anything else the text', () => {
    assert.equal(changeColor(base, 'bg', '#123456').style.colors.bg, '#123456');
    assert.equal(changeColor(base, 'bg', '#123456').style.colors.text, DEFAULT_DELIVERY_MESSAGE.style.colors.text);
    assert.equal(changeColor(base, 'text', '#abcdef').style.colors.text, '#abcdef');
    assert.equal(changeColor(base, 'whatever', '#abcdef').style.colors.text, '#abcdef');
  });

  test('none of them touches what it was given', () => {
    changeConfig(base, { enabled: false });
    changeStyle(base, { font: 'serif' });
    changeColor(base, 'bg', '#123456');
    resetLook(base);
    assert.equal(JSON.stringify(base), snapshot);
    const frozen = changeConfig(DEFAULT_DELIVERY_MESSAGE, { enabled: false });
    assert.equal(frozen.enabled, false);
    assert.equal(DEFAULT_DELIVERY_MESSAGE.enabled, true);
  });

  test('every choice the card offers survives the server’s own normalizing', () => {
    const { fonts, weights, sizes, trackings, models, tones } = DELIVERY_OPTIONS;
    const lists = { font: fonts, weight: weights, size: sizes, tracking: trackings, model: models, tone: tones };
    for (const [key, list] of Object.entries(lists)) {
      for (const o of list) {
        const sent = changeStyle(undefined, { [key]: o.value });
        assert.equal(normalizeDeliveryMessage(sent).style[key], o.value, `${key}=${o.value}`);
      }
    }
    for (const o of DELIVERY_OPTIONS.icons) assert.equal(normalizeDeliveryMessage(changeConfig(undefined, { icon: o.value })).icon, o.value, `icon "${o.value}"`);
    for (const o of DELIVERY_OPTIONS.modes) assert.equal(normalizeDeliveryMessage(changeConfig(undefined, { mode: o.value })).mode, o.value, o.value);
    for (const flag of ['italic', 'uppercase']) {
      assert.equal(normalizeDeliveryMessage(changeStyle(undefined, { [flag]: true })).style[flag], true);
      assert.equal(normalizeDeliveryMessage(changeStyle(undefined, { [flag]: false })).style[flag], false);
    }
    assert.equal(normalizeDeliveryMessage(changeConfig(undefined, { enabled: false })).enabled, false);
  });
});

/* ═════════════ colour typing ═════════════ */

describe('parseHexInput / isCompleteHex', () => {
  test('a colour code, with or without #, in any case, or the 3-digit short form', () => {
    assert.equal(parseHexInput('#683F1A'), '#683f1a');
    assert.equal(parseHexInput('683f1a'), '#683f1a');
    assert.equal(parseHexInput('  #683f1a  '), '#683f1a');
    assert.equal(parseHexInput('#fa0'), '#ffaa00');
    assert.equal(parseHexInput('FA0'), '#ffaa00');
  });

  test('anything else is null', () => {
    for (const bad of ['', '#', '#12', '#12345', '#1234567', '#gggggg', 'red', 'rgb(1,2,3)', '#12 456', undefined, null, 5, {}]) {
      assert.equal(parseHexInput(bad), null, JSON.stringify(bad));
    }
  });

  test('applied as you type only once there are six digits (the short form waits for you to leave the box)', () => {
    assert.equal(isCompleteHex('#683f1a'), true);
    assert.equal(isCompleteHex('683F1A'), true);
    assert.equal(isCompleteHex('#fa0'), false);
    assert.equal(isCompleteHex('#68'), false);
    assert.equal(isCompleteHex(''), false);
    assert.equal(isCompleteHex(undefined), false);
  });
});

/* ═════════════ the look, reset, samples ═════════════ */

describe('lookIsDefault / resetLook', () => {
  test('the defaults are the default look; the words, the switch and the rule are not part of it', () => {
    assert.equal(lookIsDefault(undefined), true);
    assert.equal(lookIsDefault(DEFAULT_DELIVERY_MESSAGE), true);
    assert.equal(lookIsDefault({ enabled: false, mode: 'always', barText: 'Hello', badgeText: 'World' }), true);
  });

  test('any icon or style change is not the default look', () => {
    assert.equal(lookIsDefault({ icon: '✨' }), false);
    assert.equal(lookIsDefault({ icon: '' }), false);
    for (const patch of [{ font: 'serif' }, { weight: 'bold' }, { size: 'lg' }, { tracking: 'wide' }, { italic: true }, { uppercase: true }, { model: 'pill' }, { tone: 'gold' }]) {
      assert.equal(lookIsDefault({ style: patch }), false, JSON.stringify(patch));
    }
    assert.equal(lookIsDefault({ style: { colors: { text: '#111111' } } }), false, 'a picked custom colour is part of the look');
  });

  test('resetLook puts the look back and nothing else', () => {
    const before = { enabled: false, mode: 'always', barText: 'Ships free', badgeText: 'Free shipping', icon: '🎁', style: { font: 'classic', weight: 'bold', size: 'lg', tracking: 'wider', italic: true, uppercase: true, model: 'solid', tone: 'custom', colors: { text: '#111111', bg: '#eeeeee' } } };
    const after = resetLook(before);
    assert.equal(lookIsDefault(after), true);
    assert.equal(after.enabled, false);
    assert.equal(after.mode, 'always');
    assert.equal(after.barText, 'Ships free');
    assert.equal(after.badgeText, 'Free shipping');
    assert.equal(after.icon, DEFAULT_DELIVERY_MESSAGE.icon);
    assert.deepEqual(after.style, DEFAULT_DELIVERY_MESSAGE.style);
  });

  test('the reset look is a copy: editing it later cannot reach the frozen defaults', () => {
    const after = resetLook({ icon: '🎁' });
    assert.notEqual(after.style, DEFAULT_DELIVERY_MESSAGE.style);
    assert.notEqual(after.style.colors, DEFAULT_DELIVERY_MESSAGE.style.colors);
    assert.equal(Object.isFrozen(after.style), false);
    after.style.model = 'pill';
    assert.equal(DEFAULT_DELIVERY_MESSAGE.style.model, 'text');
  });
});

describe('sampleConfig — the small sample on each option card', () => {
  test('keeps the owner’s font, weight, italic and colours; fixes the things that would not fit a phone-width card', () => {
    const owner = { icon: '🎁', style: { font: 'serif', weight: 'bold', size: 'lg', tracking: 'wider', italic: true, uppercase: true, model: 'text', tone: 'wine' } };
    const s = sampleConfig(owner, { model: 'pill' });
    assert.equal(s.icon, '');
    assert.equal(s.style.model, 'pill');
    assert.equal(s.style.size, 'sm');
    assert.equal(s.style.tracking, 'normal');
    assert.equal(s.style.uppercase, false);
    assert.equal(s.style.font, 'serif');
    assert.equal(s.style.weight, 'bold');
    assert.equal(s.style.italic, true);
    assert.equal(s.style.tone, 'wine');
  });

  test('each of the five models draws differently, and the sample words are short', () => {
    assert.ok(SAMPLE_WORDS.length <= 16);
    const drawn = DELIVERY_OPTIONS.models.map((m) => draw(SAMPLE_WORDS, sampleConfig(undefined, { model: m.value }), 'badge'));
    assert.equal(new Set(drawn).size, DELIVERY_OPTIONS.models.length);
  });
});

/* ═════════════ previewState ═════════════ */

describe('previewState — what the storefront would do right now', () => {
  test('on, Smart, and shipping free for everyone: live', () => {
    const s = previewState(undefined, FREE);
    assert.equal(s.live, true);
    assert.equal(s.reason, '');
    assert.deepEqual(s.words, { bar: DEFAULT_BAR_TEXT, badge: DEFAULT_BADGE_TEXT, product: DEFAULT_BAR_TEXT });
  });

  test('switched off: hidden, and it says so', () => {
    const s = previewState({ enabled: false }, FREE);
    assert.equal(s.live, false);
    assert.match(s.reason, /^Hidden on the storefront right now because the message is switched off/);
  });

  test('Smart while shipping is charged: hidden, naming the real rule and the way out', () => {
    const s = previewState(undefined, PAID);
    assert.equal(s.live, false);
    assert.match(s.reason, /^Hidden on the storefront right now because “Smart” shows it only while delivery is free on every order/);
    assert.ok(s.reason.includes(freeShippingLine(PAID)), s.reason);
    assert.match(s.reason, /choose “Always”/);
  });

  test('switched off wins over everything: the reason is the switch, not the rule', () => {
    assert.match(previewState({ enabled: false, mode: 'auto' }, PAID).reason, /switched off/);
    assert.match(previewState({ enabled: false, mode: 'always' }, FREE).reason, /switched off/);
  });

  test('Always: live whatever the shipping rule is', () => {
    for (const charges of [FREE, PAID, undefined]) assert.equal(previewState({ mode: 'always' }, charges).live, true);
  });

  test('the words are the owner’s (empty → default), so the preview draws what a customer would read', () => {
    const s = previewState({ mode: 'always', barText: 'Ships free over ₹999', badgeText: '' }, PAID);
    assert.deepEqual(s.words, { bar: 'Ships free over ₹999', badge: DEFAULT_BADGE_TEXT, product: 'Ships free over ₹999' });
  });

  test('the configuration is the strict one: a custom pair the storefront would not use is already Automatic here', () => {
    assert.equal(previewState(custom({ text: '#888888', bg: '#8a8a8a' }, 'pill'), FREE).config.style.tone, 'auto');
    assert.equal(previewState(custom({ text: '#ffffff', bg: '#047857' }, 'pill'), FREE).config.style.tone, 'custom');
  });

  test('it agrees with the storefront’s own rule on every surface', () => {
    for (const charges of [FREE, PAID]) {
      for (const v of [{}, { enabled: false }, { mode: 'always' }, { mode: 'always', enabled: false }]) {
        const shown = ['bar', 'badge', 'product'].map((s) => lib.deliveryMessageFor(v, charges, s) !== '');
        assert.deepEqual(shown, [shown[0], shown[0], shown[0]], 'one rule for all three places');
        assert.equal(previewState(v, charges).live, shown[0], JSON.stringify(v));
      }
    }
  });
});

/* ═════════════ contrastNotes ═════════════ */

describe('contrastNotes — what to tell the owner about their own colours', () => {
  test('nothing unless the tone is Custom (the curated tones are already checked)', () => {
    for (const tone of ['auto', 'gold', 'wine', 'emerald', 'ivory', 'night']) assert.deepEqual(contrastNotes({ style: { tone, colors: { text: '#ffffff', bg: '#ffffff' } } }), [], tone);
    assert.deepEqual(contrastNotes(undefined), []);
  });

  test('a pill or solid badge is judged text against its own background: one note for every place', () => {
    for (const model of ['pill', 'solid']) {
      const bad = contrastNotes(custom({ text: '#777777', bg: '#888888' }, model));
      assert.equal(bad.length, 1);
      assert.equal(bad[0].level, 'unusable');
      assert.match(bad[0].text, /too close in colour \(1\.26:1\)/);
      assert.match(bad[0].text, /will not be used: customers see the Automatic look instead/);
      const ratio = contrastRatio('#808080', '#ffffff');
      assert.ok(ratio > 3 && ratio < 4.5, 'the fixture really is in the "hard to read" band');
      const low = contrastNotes(custom({ text: '#808080', bg: '#ffffff' }, model));
      assert.equal(low.length, 1);
      assert.equal(low[0].level, 'low');
      assert.match(low[0].text, /hard to read on this background \(3\.94:1\)/);
      assert.deepEqual(contrastNotes(custom({ text: '#ffffff', bg: '#047857' }, model)), []);
    }
  });

  test('the ratio shown never promises more than there is (rounded down)', () => {
    const r = contrastRatio('#777777', '#888888');
    const shown = Number(contrastNotes(custom({ text: '#777777', bg: '#888888' }, 'pill'))[0].text.match(/\((\d+\.\d\d):1\)/)[1]);
    assert.ok(shown <= r + 1e-9 && r - shown < 0.01, `${shown} vs ${r}`);
  });

  test('text, outline and underline sit on each place’s own ground, so each place is judged — and named', () => {
    for (const model of ['text', 'outline', 'underline']) {
      const white = contrastNotes(custom({ text: '#ffffff', bg: '#faf0d0' }, model));
      assert.equal(white.length, 1, model);
      assert.equal(white[0].level, 'unusable');
      assert.match(white[0].text, /home page badge \(1\.0\d:1\) and product page \(1\.00:1\)/, 'white words vanish on the light places');
      assert.doesNotMatch(white[0].text, /top strip/, 'but they read fine on the dark strip');
      assert.match(white[0].text, /the Automatic look is used there instead/);

      const dark = contrastNotes(custom({ text: '#1a0b05', bg: '#faf0d0' }, model));
      assert.equal(dark.length, 1, model);
      assert.match(dark[0].text, /top strip/, 'dark words vanish on the dark strip');
      assert.doesNotMatch(dark[0].text, /home page badge|product page/);
    }
  });

  test('a mid-tone text colour is amber on every place, and each is named with its own ratio', () => {
    const notes = contrastNotes(custom({ text: '#808080', bg: '#000000' }, 'text'));
    assert.deepEqual(notes.map((n) => n.level), ['low']);
    assert.match(notes[0].text, /^This text colour is hard to read on the top strip \(\d\.\d\d:1\), home page badge \(\d\.\d\d:1\) and product page \(3\.94:1\)\./);
  });

  test('no single text colour reads comfortably on the dark strip and on the light places at once, so there is always something to say', () => {
    for (const text of ['#000000', '#ffffff', '#808080', '#7f1d1d', '#047857']) {
      for (const model of ['text', 'outline', 'underline']) assert.ok(contrastNotes(custom({ text, bg: '#ffffff' }, model)).length >= 1, `${text} ${model}`);
    }
  });

  test('surface names are the owner’s words', () => {
    assert.deepEqual({ ...SURFACE_NAMES }, { bar: 'top strip', badge: 'home page badge', product: 'product page' });
    assert.ok(Object.isFrozen(SURFACE_NAMES));
  });
});

/* ═════════════ DeliveryMessagePanel.jsx: what it renders ═════════════ */

describe('DeliveryMessagePanel — default look', { skip }, () => {
  test('nothing saved yet, shipping free for everyone: on, Smart, the default words, live', () => {
    const h = render(undefined, FREE);
    assert.match(h, /<h2 id="dm-title"[^>]*>Delivery Message<\/h2>/);
    assert.match(h, /<button type="button" role="switch" aria-checked="true" aria-labelledby="dm-title"/);
    assert.deepEqual(checkedRadio(h, 'dm-mode'), ['auto']);
    assert.equal(inputById(h, 'dm-bar-text').value, DEFAULT_BAR_TEXT);
    assert.equal(inputById(h, 'dm-badge-text').value, DEFAULT_BADGE_TEXT);
    assert.deepEqual(checkedRadio(h, 'dm-icon'), ['🚚']);
    assert.deepEqual(checkedRadio(h, 'dm-font'), ['sans']);
    assert.deepEqual(checkedRadio(h, 'dm-weight'), ['normal']);
    assert.deepEqual(checkedRadio(h, 'dm-size'), ['md']);
    assert.deepEqual(checkedRadio(h, 'dm-tracking'), ['normal']);
    assert.deepEqual(checkedRadio(h, 'dm-model'), ['text']);
    assert.deepEqual(checkedRadio(h, 'dm-tone'), ['auto']);
    assert.match(h, /<div role="status" aria-live="polite"[^>]*>Showing on your shop: customers see it on the top strip/);
    assert.match(h, /Showing on your shop<\/span>/, 'the preview badge');
    assert.doesNotMatch(h, /Check your delivery charges/);
    assert.doesNotMatch(h, /dm-color-text/, 'no colour boxes unless the tone is Custom');
  });

  test('the counters say how much of the 60 characters is used', () => {
    const t = textOf(render(undefined, FREE));
    assert.match(t, new RegExp(`${DEFAULT_BAR_TEXT.length}/${DELIVERY_TEXT_MAX}`));
    assert.match(t, new RegExp(`${DEFAULT_BADGE_TEXT.length}/${DELIVERY_TEXT_MAX}`));
    assert.equal(inputById(render(undefined, FREE), 'dm-bar-text').maxLength, String(DELIVERY_TEXT_MAX));
  });

  test('the helper text says the changes are saved with the page’s Save Settings button, in plain words', () => {
    const t = textOf(render(undefined, FREE));
    assert.match(t, /Your changes go live when you press the Save Settings button at the top of the page\./);
    assert.match(t, /They reach your shop when you press Save Settings\./);
    assert.match(t, /Turn it off, change the words, or restyle it\./);
  });

  test('"Reset look to default" has nothing to do at the default look (but it stays focusable: it never drops the keyboard), and the default-words links are not offered', () => {
    const h = render(undefined, FREE);
    assert.match(h, /<button id="dm-reset-look" type="button" aria-disabled="true"[^>]*>[^]*?Reset look to default/);
    assert.doesNotMatch(h, /<button[^>]*\sdisabled=/, 'no native disabled button in the card: a focused button that became disabled would lose the focus');
    assert.doesNotMatch(h, /Use the default words/);
  });

  test('the same words are in the three preview rows, drawn by the storefront’s own component', () => {
    const h = render(undefined, FREE);
    const cfg = editableConfig(undefined);
    assert.ok(h.includes(draw(DEFAULT_BAR_TEXT, cfg, 'bar')), 'top strip');
    assert.ok(h.includes(draw(DEFAULT_BADGE_TEXT, cfg, 'badge', { as: 'li' })), 'home page badge');
    assert.ok(h.includes(draw(DEFAULT_BAR_TEXT, cfg, 'product')), 'product page');
    assert.match(h, />Top strip<\/span>/);
    assert.match(h, />Home page<\/span>/);
    assert.match(h, />Product page<\/span>/);
  });

  test('renders from any stored shape without a warning (missing, partial, garbage, hostile)', () => {
    const hostile = { get style() { throw new Error('boom'); } };
    const stored = [undefined, null, 'x', 5, true, [], {}, { style: null }, { style: { colors: 'x' } }, { style: [] }, { barText: 7 }, hostile, JSON.parse('{"__proto__":{"enabled":false}}')];
    stored.forEach((v, i) => assert.ok(render(v, FREE).includes('Delivery Message'), `stored shape #${i}`));
  });

  test('the words are plain text: markup typed or stored is never markup', () => {
    const h = render({ barText: '<img src=x onerror=alert(1)>', badgeText: '<script>alert(1)</script>' }, FREE);
    assert.doesNotMatch(h, /<img|<script/i);
    assert.equal(inputById(h, 'dm-bar-text').value, 'img src=x onerror=alert(1)');
  });

  test('works without an onChange (nothing to hand the page to)', () => {
    assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(Panel, { value: undefined })));
  });
});

describe('DeliveryMessagePanel — switched off, or hidden by the rule', { skip }, () => {
  test('switched off: the switch is off, the card says why nothing shows, the preview is marked and dimmed', () => {
    const h = render({ enabled: false }, FREE);
    assert.match(h, /role="switch" aria-checked="false"/);
    assert.match(h, /<div role="status" aria-live="polite"[^>]*>Hidden on the storefront right now because the message is switched off\./);
    assert.match(h, /Not showing right now<\/span>/);
    assert.match(h, /space-y-1\.5 opacity-60/);
    assert.doesNotMatch(h, /Showing on your shop/);
    assert.ok(h.includes(draw(DEFAULT_BAR_TEXT, editableConfig({ enabled: false }), 'bar')), 'still drawn, so the owner can go on styling it');
  });

  test('Smart while shipping is charged: not live, with the real rule in the sentence', () => {
    const h = render(undefined, PAID);
    const t = textOf(h);
    assert.match(t, /Hidden on the storefront right now because “Smart” shows it only while delivery is free on every order/);
    assert.ok(t.includes(freeShippingLine(PAID)));
    assert.match(h, /Not showing right now/);
    assert.doesNotMatch(h, /Check your delivery charges/, 'Smart never needs the warning: it cannot say "free" untruthfully');
  });

  test('the status line is a polite live region (the owner’s screen reader hears it change)', () => {
    for (const v of [undefined, { enabled: false }]) assert.match(render(v, FREE), /role="status" aria-live="polite"/);
  });
});

describe('DeliveryMessagePanel — "Always" while shipping is still charged', { skip }, () => {
  const v = { mode: 'always', barText: 'Free delivery above ₹999' };

  test('a prominent amber warning that names the real shipping rule, with a one-tap way back to Smart', () => {
    const h = render(v, PAID);
    assert.match(h, /<div aria-live="polite"><div class="mt-3 flex gap-2 rounded-lg border border-amber-300 bg-amber-50/);
    const t = textOf(h);
    assert.match(t, /Check your delivery charges/);
    assert.ok(t.includes(admin.deliveryMismatch(v, PAID)), 'the very sentence the library gives');
    assert.ok(t.includes(freeShippingLine(PAID)));
    assert.match(t, /Shipping charges are set in this page under Business → Shipping & Payment Charges ?\./, 'and where to change them (the ChargesCard of the Business tab)');
    assert.match(h, /<button type="button"[^>]*>Switch to Smart<\/button>/);
    assert.deepEqual(checkedRadio(h, 'dm-mode'), ['always']);
  });

  test('it is a warning, never a block: the message is still live (and the status line says to check)', () => {
    const h = render(v, PAID);
    assert.match(h, /Showing on your shop<\/span>/);
    assert.match(textOf(h), /Showing on your shop, but your shipping settings still charge for delivery\. Check the warning under “Show when”\./);
    assert.doesNotMatch(h, /Hidden on the storefront/);
  });

  test('no warning when shipping really is free for everyone, or when the message is switched off', () => {
    assert.doesNotMatch(render(v, FREE), /Check your delivery charges/);
    assert.doesNotMatch(render({ ...v, enabled: false }, PAID), /Check your delivery charges/);
    assert.match(textOf(render(v, FREE)), /Showing on your shop: customers see it/);
  });

  test('the words section tells the owner the words are theirs to keep true', () => {
    assert.match(textOf(render(v, PAID)), /In Always mode you decide the words, so make sure they are true for every order/);
    assert.match(textOf(render(undefined, FREE)), /In Smart mode the words show only while delivery is free on every order/);
  });
});

describe('DeliveryMessagePanel — the words', { skip }, () => {
  test('empty boxes say what happens (the default words) and where the hide switch is', () => {
    const h = render({ barText: '', badgeText: '' }, FREE);
    assert.equal(inputById(h, 'dm-bar-text').value, '');
    assert.equal(textOf(h).match(/Empty: the default words are shown\. To hide the message, use the switch at the top of this card\./g).length, 2);
    assert.match(textOf(h), /0\/60/);
    assert.equal(inputById(h, 'dm-bar-text').placeholder, DEFAULT_BAR_TEXT);
    assert.ok(h.includes(draw(DEFAULT_BAR_TEXT, {}, 'bar')), 'the preview shows the default words while the box is empty');
  });

  test('words with nothing visible in them (joiners, marks) are empty too: the box says the default words are shown, and the preview draws them', () => {
    for (const blank of ['\u200c', '\u200d\u200d', '\u0301', '\ufe0f']) {
      const h = render({ barText: blank, badgeText: blank }, FREE);
      assert.equal((textOf(h).match(/Empty: the default words are shown\./g) || []).length, 2, JSON.stringify(blank));
      assert.ok(h.includes(draw(DEFAULT_BAR_TEXT, editableConfig(undefined), 'bar')), 'the preview is the default words, never an empty label');
      assert.ok(h.includes(draw(DEFAULT_BADGE_TEXT, editableConfig(undefined), 'badge', { as: 'li' })));
    }
    /* A blank filler is stripped before it gets into the box, so the box is simply empty. */
    const h = render({ barText: '\u3164\u2800' }, FREE);
    assert.equal(inputById(h, 'dm-bar-text').value, '');
    assert.match(textOf(h), /Empty: the default words are shown\./);
  });

  test('reworded text: the counter follows, the "default words" link appears, the preview draws it', () => {
    const h = render({ mode: 'always', barText: 'Free delivery above ₹999' }, FREE);
    assert.match(textOf(h), new RegExp(`${'Free delivery above ₹999'.length}/60`));
    assert.equal((h.match(/Use the default words/g) || []).length, 1, 'only the changed box offers it');
    assert.ok(h.includes(draw('Free delivery above ₹999', editableConfig({ mode: 'always' }), 'bar')));
    assert.ok(h.includes(draw('Free delivery above ₹999', editableConfig({ mode: 'always' }), 'product')), 'the product page line uses the same words');
  });

  test('a full box says so (amber counter)', () => {
    const h = render({ barText: 'x'.repeat(80) }, FREE);
    assert.match(h, /text-amber-700">60\/60<\/span>/);
  });
});

describe('DeliveryMessagePanel — every model, tone, font and icon', { skip }, () => {
  test('each of the five models selected: its card is the checked one and the previews are drawn in it', () => {
    assert.deepEqual(DELIVERY_OPTIONS.models.map((m) => m.value), ['text', 'pill', 'outline', 'solid', 'underline']);
    for (const m of DELIVERY_OPTIONS.models) {
      for (const tone of ['auto', 'wine']) {
        const v = { style: { model: m.value, tone } };
        const h = render(v, FREE);
        assert.deepEqual(checkedRadio(h, 'dm-model'), [m.value], m.value);
        assert.equal(radios(h, 'dm-model').length, 5);
        const cfg = editableConfig(v);
        assert.ok(h.includes(draw(DEFAULT_BAR_TEXT, cfg, 'bar')), `${m.value}/${tone}: top strip`);
        assert.ok(h.includes(draw(DEFAULT_BADGE_TEXT, cfg, 'badge', { as: 'li' })), `${m.value}/${tone}: home page`);
        assert.ok(h.includes(draw(DEFAULT_BAR_TEXT, cfg, 'product')), `${m.value}/${tone}: product page`);
      }
    }
  });

  test('every model card carries a small live sample of its own shape, drawn by the storefront’s component', () => {
    const h = render({ style: { tone: 'gold', font: 'serif', weight: 'semibold' } }, FREE);
    const models = section(h, 'dm-model');
    const cfg = editableConfig({ style: { tone: 'gold', font: 'serif', weight: 'semibold' } });
    for (const m of DELIVERY_OPTIONS.models) {
      assert.ok(models.includes(draw(SAMPLE_WORDS, sampleConfig(cfg, { model: m.value }), 'badge')), `sample of ${m.value}`);
      assert.match(textOf(models), new RegExp(m.label));
      assert.match(textOf(models), new RegExp(m.hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.equal(models.split(SAMPLE_WORDS).length - 1, 5, 'five samples');
  });

  test('each tone selected: its card is checked, and the colour boxes appear only for Custom', () => {
    assert.deepEqual(DELIVERY_OPTIONS.tones.map((t) => t.value), ['auto', 'gold', 'wine', 'emerald', 'ivory', 'night', 'custom']);
    for (const t of DELIVERY_OPTIONS.tones) {
      const h = render({ style: { tone: t.value } }, FREE);
      assert.deepEqual(checkedRadio(h, 'dm-tone'), [t.value], t.value);
      assert.equal(h.includes('id="dm-color-text"'), t.value === 'custom', t.value);
      assert.equal(h.includes('id="dm-color-bg"'), t.value === 'custom', t.value);
      assert.match(textOf(section(h, 'dm-design')), new RegExp(t.label));
    }
  });

  test('the tone cards show their own swatch (the Custom card shows the owner’s colours)', () => {
    const h = render({ style: { tone: 'custom', colors: { text: '#112233', bg: '#ddeeff' } } }, FREE);
    const design = section(h, 'dm-design');
    assert.match(design, /style="color:#112233;background-color:#ddeeff"/);
    assert.match(design, /style="color:#1a0b05;background-color:#e4b040"/, 'Gold');
    assert.match(design, /style="color:#f4dfa0;background-color:#0f172a"/, 'Night');
  });

  test('fonts, weights, sizes, spacing: each choice shown, the current one checked', () => {
    const v = { style: { font: 'classic', weight: 'bold', size: 'lg', tracking: 'wider', italic: true, uppercase: true } };
    const h = render(v, FREE);
    assert.deepEqual(radios(h, 'dm-font').map((r) => r.value), ['sans', 'serif', 'classic']);
    assert.deepEqual(checkedRadio(h, 'dm-font'), ['classic']);
    assert.deepEqual(checkedRadio(h, 'dm-weight'), ['bold']);
    assert.deepEqual(checkedRadio(h, 'dm-size'), ['lg']);
    assert.deepEqual(checkedRadio(h, 'dm-tracking'), ['wider']);
    const checks = inputTags(h).map(tagAttrs).filter((a) => a.type === 'checkbox');
    assert.deepEqual(checks.map((a) => [a.name, 'checked' in a]), [['dm-italic', true], ['dm-uppercase', true]]);
    assert.deepEqual(radios(h, 'dm-weight').map((r) => r.value), DELIVERY_OPTIONS.weights.map((o) => o.value));
    assert.deepEqual(radios(h, 'dm-size').map((r) => r.value), DELIVERY_OPTIONS.sizes.map((o) => o.value));
    assert.deepEqual(radios(h, 'dm-tracking').map((r) => r.value), DELIVERY_OPTIONS.trackings.map((o) => o.value));
    assert.match(h, /font-classic/, 'a font card is drawn in its own font');
    assert.match(textOf(h), /Elegant[^]*it runs small: try Large/, 'the strip’s serif runs small: the card says so');
  });

  test('the icon picker lists every icon, including "No icon"; each has a name a screen reader can read', () => {
    const h = render({ icon: '' }, FREE);
    assert.deepEqual(radios(h, 'dm-icon').map((r) => r.value), ['🚚', '✨', '🎁', '✅', '💛', '']);
    assert.deepEqual(checkedRadio(h, 'dm-icon'), ['']);
    const icon = section(h, 'dm-icon');
    for (const o of DELIVERY_OPTIONS.icons) assert.match(icon, new RegExp(`<span class="sr-only">${o.label}</span>`), o.label);
    assert.deepEqual(checkedRadio(render({ icon: '💛' }, FREE), 'dm-icon'), ['💛']);
  });

  test('"Reset look to default" is on as soon as the look is not the default', () => {
    const off = /<button id="dm-reset-look" type="button" aria-disabled="true"/;
    assert.match(render({ style: { model: 'pill' } }, FREE), /<button id="dm-reset-look" type="button" aria-disabled="false"/);
    assert.match(render({ icon: '✨' }, FREE), /<button id="dm-reset-look" type="button" aria-disabled="false"/);
    assert.doesNotMatch(render({ style: { model: 'pill' } }, FREE), off);
    assert.doesNotMatch(render({ icon: '✨' }, FREE), off);
    assert.match(render({ enabled: false, barText: 'x' }, FREE), off, 'words and the switch are not part of the look');
  });
});

describe('DeliveryMessagePanel — custom colours and their notes', { skip }, () => {
  test('readable colours: the colour boxes show the colours, and the card says they are easy to read', () => {
    const h = render(custom({ text: '#ffffff', bg: '#047857' }, 'solid'), FREE);
    assert.equal(inputById(h, 'dm-color-text').value, '#ffffff');
    assert.equal(inputById(h, 'dm-color-bg').value, '#047857');
    assert.match(textOf(h), /These colours are easy to read\./);
    assert.doesNotMatch(h, /Won’t be used|Hard to read/);
    assert.match(textOf(h), /Behind the words\./);
  });

  test('a pill whose colours are too close: the red "Won’t be used" note, and the preview already shows the Automatic look', () => {
    const v = custom({ text: '#777777', bg: '#888888' }, 'pill');
    const h = render(v, FREE);
    assert.match(h, /border-red-200 bg-red-50 text-red-900/);
    assert.match(textOf(h), /Won’t be used\. The text and the background are too close in colour \(1\.26:1\)/);
    assert.deepEqual(checkedRadio(h, 'dm-tone'), ['custom'], 'the owner’s choice is not snapped back while they type');
    assert.ok(h.includes(draw(DEFAULT_BAR_TEXT, v, 'bar')), 'the preview is the storefront’s own drawing…');
    assert.equal(draw(DEFAULT_BAR_TEXT, v, 'bar'), draw(DEFAULT_BAR_TEXT, { style: { model: 'pill', tone: 'auto' } }, 'bar'), '…which is the Automatic look');
    assert.doesNotMatch(h, /These colours are easy to read/);
  });

  test('white words on the light places: unusable there, fine on the strip', () => {
    const v = custom({ text: '#ffffff', bg: '#faf0d0' }, 'text');
    const t = textOf(render(v, FREE));
    assert.match(t, /Won’t be used\. This text colour can hardly be seen on the home page badge \(1\.0\d:1\) and product page \(1\.00:1\), so the Automatic look is used there instead\./);
    assert.match(textOf(render(v, FREE)), /Not used by this model: only Soft pill and Solid badge have a background\./);
  });

  test('colours in between: the amber "Hard to read" note', () => {
    const h = render(custom({ text: '#808080', bg: '#ffffff' }, 'solid'), FREE);
    assert.match(h, /border-amber-200 bg-amber-50 text-amber-900/);
    assert.match(textOf(h), /Hard to read\. The text is hard to read on this background \(3\.94:1\)/);
    assert.doesNotMatch(textOf(h), /Won’t be used/);
  });

  test('a half-typed colour is an error on that box only, in plain words', () => {
    const h = render(custom({ text: '#683f1a', bg: '#faf0d0' }, 'pill'), FREE);
    assert.equal(inputById(h, 'dm-color-text')['aria-invalid'], 'false');
    assert.match(textOf(h), /The colour of the words\./);
  });

  test('both pickers of each colour are labelled (the native colour picker and the code box)', () => {
    const h = render(custom({ text: '#683f1a', bg: '#faf0d0' }, 'pill'), FREE);
    const colorPickers = inputTags(h).map(tagAttrs).filter((a) => a.type === 'color');
    assert.deepEqual(colorPickers.map((a) => [a['aria-label'], a.value]), [['Text colour: pick a colour', '#683f1a'], ['Background colour: pick a colour', '#faf0d0']]);
    assert.match(h, /<label for="dm-color-text"[^>]*>Text colour<\/label>/);
    assert.match(h, /<label for="dm-color-bg"[^>]*>Background colour<\/label>/);
  });
});

describe('DeliveryMessagePanel — made for a phone and for assistive technology', { skip }, () => {
  const states = [
    ['default', undefined, FREE],
    ['off', { enabled: false }, FREE],
    ['always while charged', { mode: 'always' }, PAID],
    ['custom pill', custom({ text: '#777777', bg: '#888888' }, 'pill'), FREE],
    ['custom text', custom({ text: '#ffffff', bg: '#ffffff' }, 'text'), FREE],
    ['empty words', { barText: '', badgeText: '' }, FREE],
  ];

  test('every control has a name: a <label> around it or pointing at it, or an aria-label', () => {
    for (const [name, v, charges] of states) {
      const h = render(v, charges);
      const labels = [...h.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)].map((m) => m[0]);
      for (const tag of inputTags(h)) {
        const a = tagAttrs(tag);
        const named = 'aria-label' in a || (a.id && labels.some((l) => l.includes(`for="${a.id}"`))) || labels.some((l) => l.includes(tag));
        assert.ok(named, `${name}: unlabeled ${tag}`);
      }
      for (const l of labels.filter((x) => x.includes('type="radio"') || x.includes('type="checkbox"'))) {
        assert.ok(textOf(l).length > 0 || /sr-only/.test(l), `${name}: an option with no words: ${l.slice(0, 120)}`);
      }
    }
  });

  test('ids are unique and every aria-labelledby / aria-describedby points at a real element', () => {
    for (const [name, v, charges] of states) {
      const h = render(v, charges);
      const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(new Set(ids).size, ids.length, `${name}: duplicate id`);
      for (const m of h.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) {
        for (const id of m[1].split(/\s+/)) assert.ok(ids.includes(id), `${name}: ${id} does not exist`);
      }
    }
  });

  test('radio groups are named by their heading, and every radio of one group shares a name', () => {
    const h = render(undefined, FREE);
    for (const id of ['dm-when', 'dm-icon', 'dm-model', 'dm-design']) assert.match(h, new RegExp(`role="radiogroup" aria-labelledby="${id}"`), id);
    assert.match(h, /role="radiogroup" aria-labelledby="dm-font-family"/);
    for (const g of ['dm-mode', 'dm-icon', 'dm-font', 'dm-weight', 'dm-size', 'dm-tracking', 'dm-model', 'dm-tone']) assert.ok(radios(h, g).length >= 2, g);
    for (const g of ['dm-weight', 'dm-size', 'dm-tracking']) assert.match(h, new RegExp(`<legend[^>]*>${{ 'dm-weight': 'Weight', 'dm-size': 'Size', 'dm-tracking': 'Letter spacing' }[g]}</legend>`), g);
  });

  test('the on/off switch is a real switch with a name, and the preview is a labelled group', () => {
    const h = render(undefined, FREE);
    assert.equal((h.match(/role="switch"/g) || []).length, 1);
    assert.match(h, /role="group" aria-label="Live preview"/);
    assert.match(h, /<span aria-hidden="true"[^>]*>On<\/span>/, 'the visible On/Off is decoration: the switch state is announced by aria-checked');
  });

  test('touch targets: the switch, the options, the chips and the text boxes are at least 44px tall', () => {
    const h = render(custom({ text: '#683f1a', bg: '#faf0d0' }, 'pill'), FREE);
    assert.match(h, /<button type="button" role="switch"[^>]*class="[^"]*\bh-11\b/);
    assert.match(h, /flex h-11 min-w-\[44px\] items-center justify-center/, 'icons');
    assert.equal((h.match(/flex min-h-\[44px\] items-center justify-center whitespace-nowrap/g) || []).length, 3 + 3 + 4, 'weight, size, spacing buttons');
    assert.equal((h.match(/flex min-h-\[44px\] items-center justify-center gap-1\.5 rounded-xl/g) || []).length, 2, 'italic, UPPERCASE');
    for (const tag of inputTags(h).map(tagAttrs).filter((a) => a.type === 'text')) assert.match(tag.class, /\bmin-h-\[44px\]/, tag.id);
    for (const tag of inputTags(h).map(tagAttrs).filter((a) => a.type === 'color')) assert.match(tag.class, /\bh-11\b/);
    assert.match(h, /inline-flex min-h-\[44px\] items-center gap-2 rounded-lg border border-gray-400 bg-white px-4/, 'reset button');
  });

  test('text on a phone keeps the 16px a text box needs (iOS Safari zooms into anything smaller)', () => {
    const h = render(custom({ text: '#683f1a', bg: '#faf0d0' }, 'pill'), FREE);
    for (const tag of inputTags(h).map(tagAttrs).filter((a) => a.type === 'text')) assert.match(tag.class, /\btext-base\b/, tag.id);
  });

  test('on a phone the preview stays in view while the owner scrolls through the options, on a computer it sits beside them', () => {
    const h = render(undefined, FREE);
    assert.match(h, /role="group" aria-label="Live preview" class="sticky -top-4 z-20 /);
    assert.match(h, /lg:order-2/);
    assert.match(h, /lg:grid-cols-\[minmax\(0,1fr\)_20rem\]/);
  });

  test('the pinned preview sits flush with the top of the scrolling page area: its offsets cancel the admin layout’s padding', () => {
    /* A sticky box sticks inside its scroller's padding, so with `top-0` a strip of scrolling options (the layout's p-4 / md:p-6) would
       show above it. It must be -top-N for each N of the <main> padding, and a plain top-4 only from lg (a side panel, space around it by design). */
    const main = readFileSync('src/app/admin/layout.js', 'utf8').match(/<main className="([^"]*)"/)?.[1];
    assert.ok(main, 'the admin layout’s scrolling <main>');
    const pad = (prefix) => main.match(new RegExp(`(?:^|\\s)${prefix}p-(\\d+)(?:\\s|$)`))?.[1];
    assert.ok(pad('') && pad('md:'), `<main> pads at phone and tablet widths: ${main}`);
    const h = render(undefined, FREE);
    const cls = h.match(/role="group" aria-label="Live preview" class="([^"]*)"/)[1].split(/\s+/);
    assert.ok(cls.includes(`-top-${pad('')}`), `phone: -top-${pad('')} cancels p-${pad('')}`);
    assert.ok(cls.includes(`md:-top-${pad('md:')}`), `tablet: md:-top-${pad('md:')} cancels md:p-${pad('md:')}`);
    assert.ok(cls.includes('lg:top-4'), 'desktop: the side panel keeps a little room');
    assert.ok(!cls.includes('top-0'), 'top-0 would leave the padding showing above it');
    /* From lg the preview is not pinned to the edge, so the layout must not pad it differently than this test assumes. */
    assert.ok(pad('lg:'), 'lg padding exists');
  });

  test('keyboard focus is always visible: the switch and the text boxes ring in amber-600 (3:1 on white), never amber-400 (1.7:1)', () => {
    const src = readFileSync(PANEL, 'utf8');
    assert.doesNotMatch(src, /(?:focus|focus-visible):(?:ring|outline|border)-amber-[1-5]00\b/, 'a light amber focus cue cannot be seen on the white card');
    const h = render(custom({ text: '#683f1a', bg: '#faf0d0' }, 'pill'), FREE);
    assert.match(h, /<button type="button" role="switch"[^>]*class="[^"]*focus-visible:ring-2 focus-visible:ring-amber-600/);
    for (const tag of inputTags(h).map(tagAttrs).filter((a) => a.type === 'text')) assert.match(tag.class, /\bfocus:ring-2 focus:ring-amber-600\b/, tag.id);
    /* amber-600 is #d97706 in Tailwind's palette; WCAG 1.4.11 asks 3:1 of a focus indicator against the white card. */
    const amber600 = require('tailwindcss/colors').amber[600];
    assert.equal(amber600, '#d97706');
    assert.ok(contrastRatio(amber600, '#ffffff') >= 3, 'focus ring contrast');
    assert.ok(contrastRatio(require('tailwindcss/colors').amber[400], '#ffffff') < 3, 'and that is why amber-400 is not used');
    /* Every other focus cue in the card already was amber-600. */
    for (const cue of src.matchAll(/(?:peer-)?focus(?:-visible)?:(?:ring|outline)-(?:amber|red|gray)-\d+/g)) assert.match(cue[0], /amber-600/, cue[0]);
  });

  test('colour is never the only clue: the chosen card or icon also has a tick, and the preview badge has words', () => {
    const h = render(undefined, FREE);
    assert.equal((h.match(/-right-1\.5 -top-1\.5/g) || []).length, 5, 'one tick each: Show when, icon, font, model, design');
    assert.equal((render({ icon: '' }, FREE).match(/-right-1\.5 -top-1\.5/g) || []).length, 5, '"No icon" is a choice too');
    assert.match(h, /Showing on your shop<\/span>/);
    assert.match(render({ enabled: false }, FREE), /Not showing right now<\/span>/);
  });

  test('no network calls and no browser storage: it only hands the page its new value', () => {
    const src = readFileSync(PANEL, 'utf8');
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
    const helperSrc = readFileSync('src/components/admin/deliveryMessageAdmin.js', 'utf8');
    assert.doesNotMatch(helperSrc, /\bfetch\(|localStorage|from 'react'/);
  });
});

/* ═════════════ DeliveryMessagePanel.jsx: what a click or a keystroke does ═════════════ */

/* A tiny runner: the card's own state (the half-typed colour) lives in a hook, and the page owns `value`,
   so each change is handed back as new props — exactly as settings/page.js does with upd(). */
let active = null;
const runnerReact = { ...React, useState: (init) => active.useState(init) };
const PanelForRunner = sucrase ? load(PANEL, panelDeps(runnerReact)).default : null;

function expand(el) {
  if (el === null || el === undefined || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return el;
  if (Array.isArray(el)) return el.map(expand);
  if (typeof el.type === 'function') return expand(el.type(el.props));
  return { ...el, props: { ...el.props, children: expand(el.props?.children) } };
}
function walk(el, fn) {
  if (el === null || el === undefined || typeof el !== 'object') return;
  if (Array.isArray(el)) { el.forEach((c) => walk(c, fn)); return; }
  fn(el);
  walk(el.props?.children, fn);
}
const nodes = (tree, pred) => { const out = []; walk(tree, (e) => { if (pred(e)) out.push(e); }); return out; };
const nodeText = (el) => { let s = ''; walk(el, (e) => { for (const c of [].concat(e.props?.children ?? [])) if (typeof c === 'string' || typeof c === 'number') s += c; }); return s; };

function mount(value, charges = FREE) {
  const slots = [];
  let cursor = 0;
  const emitted = [];
  const h = { value, tree: null, emitted };
  const self = {
    useState(init) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = { value: typeof init === 'function' ? init() : init };
        slot.set = (next) => { const v = typeof next === 'function' ? next(slot.value) : next; if (Object.is(v, slot.value)) return; slot.value = v; h.render(); };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
  };
  h.render = () => {
    cursor = 0;
    active = self;
    try { h.tree = withCharges(charges, () => expand(PanelForRunner({ value: h.value, onChange: (next) => { emitted.push(next); h.value = next; h.render(); } }))); } finally { active = null; }
  };
  h.input = (props) => {
    const hit = nodes(h.tree, (e) => e.type === 'input' && Object.entries(props).every(([k, v]) => e.props[k] === v))[0];
    assert.ok(hit, `no <input ${JSON.stringify(props)}>`);
    return hit;
  };
  h.button = (text) => {
    const hit = nodes(h.tree, (e) => e.type === 'button' && nodeText(e).includes(text))[0];
    assert.ok(hit, `no button "${text}"`);
    return hit;
  };
  h.hasButton = (text) => nodes(h.tree, (e) => e.type === 'button' && nodeText(e).includes(text)).length > 0;
  h.choose = (name, val) => h.input({ type: 'radio', name, value: val }).props.onChange({ target: { value: val, checked: true } });
  h.tick = (name, checked) => h.input({ type: 'checkbox', name }).props.onChange({ target: { checked } });
  h.type = (id, text) => h.input({ id }).props.onChange({ target: { value: text } });
  h.blur = (id) => h.input({ id }).props.onBlur();
  h.pick = (label, hex) => nodes(h.tree, (e) => e.type === 'input' && e.props.type === 'color' && e.props['aria-label'] === `${label}: pick a colour`)[0].props.onChange({ target: { value: hex } });
  h.render();
  return h;
}

describe('DeliveryMessagePanel — what each control hands the settings page', { skip }, () => {
  test('the switch: off, then on again', () => {
    const h = mount(undefined);
    const sw = () => nodes(h.tree, (e) => e.type === 'button' && e.props.role === 'switch')[0];
    assert.equal(sw().props['aria-checked'], true);
    sw().props.onClick();
    assert.equal(h.emitted.at(-1).enabled, false);
    assert.equal(sw().props['aria-checked'], false);
    sw().props.onClick();
    assert.equal(h.emitted.at(-1).enabled, true);
  });

  test('every change is the whole new configuration, complete and valid', () => {
    const h = mount(undefined);
    h.choose('dm-mode', 'always');
    assert.deepEqual(h.emitted.at(-1), { ...DEFAULT_DELIVERY_MESSAGE, mode: 'always', style: { ...DEFAULT_DELIVERY_MESSAGE.style, colors: { ...DEFAULT_DELIVERY_MESSAGE.style.colors } } });
    assert.deepEqual(JSON.parse(JSON.stringify(h.emitted.at(-1))), h.emitted.at(-1));
  });

  test('Show when: Always, then back to Smart', () => {
    const h = mount(undefined, PAID);
    h.choose('dm-mode', 'always');
    assert.equal(h.emitted.at(-1).mode, 'always');
    assert.ok(h.hasButton('Switch to Smart'), 'the warning appeared with it');
    h.button('Switch to Smart').props.onClick();
    assert.equal(h.emitted.at(-1).mode, 'auto');
    assert.equal(h.hasButton('Switch to Smart'), false);
  });

  test('typing the words: kept as typed, <> removed, 60 at most, empty allowed', () => {
    const h = mount(undefined);
    h.type('dm-bar-text', 'Free delivery above ₹999 ');
    assert.equal(h.emitted.at(-1).barText, 'Free delivery above ₹999 ');
    h.type('dm-bar-text', '<b>Free</b>');
    assert.equal(h.emitted.at(-1).barText, 'bFree/b');
    h.type('dm-badge-text', 'y'.repeat(100));
    assert.equal(h.emitted.at(-1).badgeText.length, DELIVERY_TEXT_MAX);
    h.type('dm-bar-text', '');
    assert.equal(h.emitted.at(-1).barText, '');
    assert.equal(h.emitted.at(-1).badgeText.length, DELIVERY_TEXT_MAX, 'the other box is untouched');
  });

  test('"Use the default words" appears once a box differs from the default, and puts the default back', () => {
    const h = mount(undefined);
    assert.equal(h.hasButton('Use the default words'), false);
    h.type('dm-bar-text', 'Hello');
    assert.equal(h.hasButton('Use the default words'), true);
    h.button('Use the default words').props.onClick();
    assert.equal(h.emitted.at(-1).barText, DEFAULT_BAR_TEXT);
    assert.equal(h.hasButton('Use the default words'), false);
    h.type('dm-badge-text', '');
    h.button('Use the default words').props.onClick();
    assert.equal(h.emitted.at(-1).badgeText, DEFAULT_BADGE_TEXT);
  });

  test('icon, font, weight, size, spacing, model and tone each change exactly their own field', () => {
    const h = mount(undefined);
    h.choose('dm-icon', '🎁');
    assert.equal(h.emitted.at(-1).icon, '🎁');
    h.choose('dm-icon', '');
    assert.equal(h.emitted.at(-1).icon, '', '"No icon" is a real choice');
    h.choose('dm-font', 'classic');
    h.choose('dm-weight', 'semibold');
    h.choose('dm-size', 'lg');
    h.choose('dm-tracking', 'wide');
    h.choose('dm-model', 'outline');
    h.choose('dm-tone', 'emerald');
    const last = h.emitted.at(-1);
    assert.deepEqual(last.style, { ...DEFAULT_DELIVERY_MESSAGE.style, font: 'classic', weight: 'semibold', size: 'lg', tracking: 'wide', model: 'outline', tone: 'emerald', colors: { ...DEFAULT_DELIVERY_MESSAGE.style.colors } });
    assert.equal(last.icon, '');
    assert.equal(h.emitted.length, 8, 'one change per click');
  });

  test('Italic and UPPERCASE are on/off boxes', () => {
    const h = mount(undefined);
    h.tick('dm-italic', true);
    h.tick('dm-uppercase', true);
    assert.equal(h.emitted.at(-1).style.italic, true);
    assert.equal(h.emitted.at(-1).style.uppercase, true);
    h.tick('dm-italic', false);
    assert.equal(h.emitted.at(-1).style.italic, false);
    assert.equal(h.emitted.at(-1).style.uppercase, true);
  });

  test('what the owner clicks is what the server will keep', () => {
    const h = mount(undefined);
    h.choose('dm-model', 'solid');
    h.choose('dm-tone', 'wine');
    h.choose('dm-font', 'serif');
    h.tick('dm-uppercase', true);
    h.type('dm-badge-text', 'Free shipping on all orders');
    assert.deepEqual(normalizeDeliveryMessage(h.emitted.at(-1)), normalizeDeliveryMessage({ ...h.value }));
    assert.equal(normalizeDeliveryMessage(h.emitted.at(-1)).style.model, 'solid');
    assert.equal(normalizeDeliveryMessage(h.emitted.at(-1)).badgeText, 'Free shipping on all orders');
  });

  test('the Custom tone shows the colour boxes; the other tones hide them', () => {
    const h = mount(undefined);
    assert.equal(nodes(h.tree, (e) => e.type === 'input' && e.props.id === 'dm-color-text').length, 0);
    h.choose('dm-tone', 'custom');
    assert.equal(nodes(h.tree, (e) => e.type === 'input' && e.props.id === 'dm-color-text').length, 1);
    h.choose('dm-tone', 'gold');
    assert.equal(nodes(h.tree, (e) => e.type === 'input' && e.props.id === 'dm-color-text').length, 0);
  });

  test('"Reset look to default": inert at the default look; afterwards the look is back and the words, switch and rule stay', () => {
    const h = mount({ enabled: false, mode: 'always', barText: 'Ships free', icon: '🎁', style: { model: 'pill', tone: 'gold', font: 'serif' } });
    const reset = () => h.button('Reset look to default');
    assert.equal(reset().props['aria-disabled'], false);
    reset().props.onClick();
    const out = h.emitted.at(-1);
    assert.equal(lookIsDefault(out), true);
    assert.equal(out.enabled, false);
    assert.equal(out.mode, 'always');
    assert.equal(out.barText, 'Ships free');
    assert.equal(reset().props['aria-disabled'], true, 'nothing left to reset');
    assert.equal(reset().props.disabled, undefined, 'never natively disabled: a focused button that became disabled would drop the keyboard on the page');
    reset().props.onClick();
    assert.equal(h.emitted.length, 1, 'pressing it again (it is still focusable) changes nothing');
  });

  test('"Reset look" says what happened (a polite status line) and offers Undo, because the custom colours are otherwise gone', () => {
    const before = { enabled: false, mode: 'always', barText: 'Ships free', icon: '🎁', style: { model: 'pill', tone: 'custom', colors: { text: '#ff0000', bg: '#00ff00' }, font: 'serif' } };
    const h = mount(before);
    const status = () => nodes(h.tree, (e) => e.type === 'div' && e.props.role === 'status' && e.props['aria-live'] === 'polite' && e.props.className === undefined)[0];
    assert.equal(status() !== undefined, true, 'the live region is in the page before anything happens (so a screen reader hears it appear)');
    assert.equal(nodeText(status()), '');
    assert.equal(h.hasButton('Undo'), false);
    h.button('Reset look to default').props.onClick();
    assert.match(nodeText(status()), /The look is back to the original\. Press Save Settings to keep it\./);
    assert.equal(h.hasButton('Undo'), true);
    assert.equal(nodes(h.tree, (e) => e.type === 'input' && e.props.id === 'dm-color-text').length, 0, 'the colour boxes are gone with the look');
    h.button('Undo').props.onClick();
    assert.deepEqual(h.emitted.at(-1), editableConfig(before), 'everything is back: the colours, the icon, the model');
    assert.equal(h.input({ id: 'dm-color-text' }).props.value, '#ff0000');
    assert.equal(h.hasButton('Undo'), false, 'and the note is gone');
    assert.equal(nodeText(status()), '');
    assert.equal(h.button('Reset look to default').props['aria-disabled'], false);
  });

  test('"Reset look" note goes away as soon as the owner changes anything else, and Undo cannot reach back past that', () => {
    const h = mount({ style: { model: 'pill', tone: 'gold' } });
    h.button('Reset look to default').props.onClick();
    assert.equal(h.hasButton('Undo'), true);
    h.choose('dm-model', 'outline');
    assert.equal(h.hasButton('Undo'), false);
    h.button('Reset look to default').props.onClick();
    h.choose('dm-mode', 'always');
    assert.equal(h.hasButton('Undo'), false, 'the rule is not part of the look, but it is a change');
    h.button('Reset look to default').props.onClick();
    h.type('dm-bar-text', 'Hello');
    assert.equal(h.hasButton('Undo'), false);
  });

  test('keyboard focus is never left on a control that goes away: Undo hands it back to the Reset button, "Use the default words" to its text box', () => {
    const focused = [];
    const doc = globalThis.document;
    globalThis.document = { getElementById: (id) => ({ focus: () => focused.push(id) }) };
    try {
      const h = mount({ barText: 'Hello', style: { model: 'pill' } });
      h.button('Use the default words').props.onClick();
      assert.deepEqual(focused, ['dm-bar-text'], 'the link vanishes once the words are the default: the box keeps the keyboard');
      h.button('Reset look to default').props.onClick();
      h.button('Undo').props.onClick();
      assert.deepEqual(focused, ['dm-bar-text', 'dm-reset-look'], 'the Undo button vanishes: the Reset button keeps the keyboard');
    } finally {
      if (doc === undefined) delete globalThis.document; else globalThis.document = doc;
    }
  });
});

describe('DeliveryMessagePanel — typing a colour', { skip }, () => {
  const start = () => mount(custom({ text: '#683f1a', bg: '#faf0d0' }, 'pill'));
  const box = (h, id) => h.input({ id });

  test('the native picker applies a colour at once', () => {
    const h = start();
    h.pick('Text colour', '#112233');
    assert.equal(h.emitted.at(-1).style.colors.text, '#112233');
    h.pick('Background colour', '#ddeeff');
    assert.equal(h.emitted.at(-1).style.colors.bg, '#ddeeff');
    assert.equal(h.emitted.at(-1).style.colors.text, '#112233', 'the other colour is untouched');
  });

  const say = (h, id) => nodeText(nodes(h.tree, (e) => e.type === 'p' && e.props.id === id)[0]);

  test('half-typed codes are kept in the box and not applied — and are not called a mistake while the owner is still typing', () => {
    const h = start();
    h.type('dm-color-text', '#6');
    assert.equal(h.emitted.length, 0, 'nothing is sent while the code is unfinished');
    assert.equal(box(h, 'dm-color-text').props.value, '#6', 'the typist’s text is not overwritten');
    assert.equal(box(h, 'dm-color-text').props['aria-invalid'], false, 'the very first keystroke is not an error');
    assert.doesNotMatch(box(h, 'dm-color-text').props.className, /border-red/);
    assert.equal(say(h, 'dm-color-text-hint'), COLOR_TYPING_HINT, 'a plain, neutral hint says what is expected');
    assert.equal(say(h, 'dm-color-text-note'), '', 'and nothing is announced');
    const hint = nodes(h.tree, (e) => e.type === 'p' && e.props.id === 'dm-color-text-hint')[0];
    assert.doesNotMatch(hint.props.className, /red/);
    for (const typed of ['#', '#f', '#68', '#683', '#683f', '#683f1']) {
      h.type('dm-color-text', typed);
      assert.equal(box(h, 'dm-color-text').props.value, typed);
      assert.equal(box(h, 'dm-color-text').props['aria-invalid'], false, typed);
      assert.equal(say(h, 'dm-color-text-note'), '', typed);
    }
    assert.equal(h.emitted.length, 0, 'none of them is a finished code');
  });

  test('the sixth digit applies the colour, in lower case, and the box shows the applied colour', () => {
    const h = start();
    h.type('dm-color-text', '#6');
    h.type('dm-color-text', '#ABCDEF');
    assert.equal(h.emitted.length, 1);
    assert.equal(h.emitted.at(-1).style.colors.text, '#abcdef');
    assert.equal(box(h, 'dm-color-text').props['aria-invalid'], false);
  });

  test('leaving the box with the 3-digit short form applies it; leaving with nonsense puts the colour in use back', () => {
    const h = start();
    h.type('dm-color-bg', 'fa0');
    assert.equal(h.emitted.length, 0);
    assert.equal(box(h, 'dm-color-bg').props['aria-invalid'], false, 'a short form is a colour, not a mistake');
    h.blur('dm-color-bg');
    assert.equal(h.emitted.at(-1).style.colors.bg, '#ffaa00');
    assert.equal(box(h, 'dm-color-bg').props.value, '#ffaa00');
    assert.equal(box(h, 'dm-color-bg').props['aria-invalid'], false);

    h.type('dm-color-text', 'banana');
    h.blur('dm-color-text');
    assert.equal(h.emitted.length, 1, 'nonsense is never sent');
    assert.equal(box(h, 'dm-color-text').props.value, '#683f1a', 'back to the colour in use');
  });

  test('leaving the box holding nonsense is the error: red, and it says the colour was not changed (and that is announced)', () => {
    const h = start();
    h.type('dm-color-text', 'banana');
    assert.equal(say(h, 'dm-color-text-note'), '', 'not while typing');
    h.blur('dm-color-text');
    assert.equal(box(h, 'dm-color-text').props['aria-invalid'], true);
    assert.match(box(h, 'dm-color-text').props.className, /border-red-500/);
    assert.equal(say(h, 'dm-color-text-note'), '“banana” is not a colour code, so the colour was not changed. Use a code like #683f1a (6 letters or numbers after the #).');
    const note = nodes(h.tree, (e) => e.type === 'p' && e.props.id === 'dm-color-text-note')[0];
    assert.equal(note.props['aria-live'], 'polite', 'the live region already exists, so its text is read out when it fills');
    assert.match(note.props.className, /text-red-700/);
    assert.match(box(h, 'dm-color-text').props['aria-describedby'], /dm-color-text-note/);
    assert.equal(box(h, 'dm-color-bg').props['aria-invalid'], false, 'the other box is untouched');
    assert.equal(say(h, 'dm-color-bg-note'), '');
    /* A half-typed code that is left is refused the same way. */
    h.type('dm-color-bg', '#fa');
    h.blur('dm-color-bg');
    assert.equal(say(h, 'dm-color-bg-note'), colorRefusal('#fa'));
    assert.equal(box(h, 'dm-color-bg').props.value, '#faf0d0');
    /* An emptied box too. */
    h.type('dm-color-text', '');
    h.blur('dm-color-text');
    assert.match(say(h, 'dm-color-text-note'), /^No colour code was typed, so the colour was not changed\./);
    assert.equal(box(h, 'dm-color-text').props['aria-invalid'], true);
    assert.equal(h.emitted.length, 0, 'nothing was ever sent');
  });

  test('the error goes as soon as the owner types again or picks a colour', () => {
    const h = start();
    h.type('dm-color-text', 'banana');
    h.blur('dm-color-text');
    assert.equal(box(h, 'dm-color-text').props['aria-invalid'], true);
    h.type('dm-color-text', '#');
    assert.equal(box(h, 'dm-color-text').props['aria-invalid'], false);
    assert.equal(say(h, 'dm-color-text-note'), '');
    h.blur('dm-color-text');
    assert.equal(box(h, 'dm-color-text').props['aria-invalid'], true, 'left unfinished again');
    h.pick('Text colour', '#112233');
    assert.equal(box(h, 'dm-color-text').props['aria-invalid'], false);
    assert.equal(say(h, 'dm-color-text-note'), '');
    /* "Reset look" clears it too. */
    h.type('dm-color-bg', 'zz');
    h.blur('dm-color-bg');
    assert.equal(box(h, 'dm-color-bg').props['aria-invalid'], true);
    h.button('Reset look to default').props.onClick();
    h.choose('dm-tone', 'custom');
    assert.equal(box(h, 'dm-color-bg').props['aria-invalid'], false);
    assert.equal(say(h, 'dm-color-bg-note'), '');
  });

  test('colorRefusal: names what was typed, plain text only', () => {
    assert.equal(colorRefusal('  zz '), '“zz” is not a colour code, so the colour was not changed. Use a code like #683f1a (6 letters or numbers after the #).');
    assert.match(colorRefusal(''), /^No colour code was typed/);
    for (const junk of [undefined, null, 5, {}, []]) assert.match(colorRefusal(junk), /^No colour code was typed/);
    assert.equal(COLOR_TYPING_HINT, 'Type 6 letters or numbers after the #, like #683f1a.');
  });

  test('leaving an untouched box, or one that already holds the colour, sends nothing', () => {
    const h = start();
    h.blur('dm-color-text');
    h.type('dm-color-text', '683F1A');
    h.blur('dm-color-text');
    assert.equal(h.emitted.filter((e) => e.style.colors.text !== '#683f1a').length, 0);
  });

  test('picking with the native picker drops a half-typed code in that box', () => {
    const h = start();
    h.type('dm-color-text', '#6');
    h.pick('Text colour', '#112233');
    assert.equal(box(h, 'dm-color-text').props.value, '#112233');
  });

  test('"Reset look" also clears any half-typed colour', () => {
    const h = start();
    h.type('dm-color-text', '#6');
    h.button('Reset look to default').props.onClick();
    assert.equal(nodes(h.tree, (e) => e.type === 'input' && e.props.id === 'dm-color-text').length, 0, 'back to Automatic: no colour boxes');
    h.choose('dm-tone', 'custom');
    assert.equal(box(h, 'dm-color-text').props.value, DEFAULT_DELIVERY_MESSAGE.style.colors.text);
  });

  test('colours that cannot be read are kept in the form, warned about, and dropped to Automatic only for the storefront', () => {
    const h = start();
    h.pick('Text colour', '#fafad0');
    const sent = h.emitted.at(-1);
    assert.equal(sent.style.tone, 'custom', 'the form keeps what the owner is trying');
    assert.deepEqual(contrastNotes(sent).map((n) => n.level), ['unusable']);
    assert.equal(normalizeDeliveryMessage(sent).style.tone, 'auto', 'the server would not store it as Custom');
    assert.equal(normalizeDeliveryMessage(sent).style.colors.text, '#fafad0', 'but it keeps the colour, so fixing the other one brings it back');
  });
});

/* ═════════════ settings/page.js and the welcome-offer card ═════════════ */

describe('the settings page', { skip }, () => {
  const AnnouncementSettingsPanel = sucrase
    ? load('src/components/admin/AnnouncementSettingsPanel.jsx', {
      react: React,
      'next/link': esm(({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children)),
      'react-icons/fi': icons,
      '@/context/CartContext': { useCart },
      '@/lib/welcomeOffer': welcomeOffer,
      '@/components/layout/WelcomeBar': {
        BAR_BG: 'bar-bg', CODE_CHIP: 'code-chip', DEFAULT_SITE_PHONE: '+91 76958 68787', TAGLINE: 'tagline', shortOffer: (m) => m,
      },
      '@/components/ui/DeliveryMessage': esm(DeliveryMessage),
    }).default
    : null;

  let tab = 'Business';
  const pageReact = { ...React, useState: (init) => React.useState(init === 'Business' ? tab : init) };
  const stub = (name) => function Stub() { return React.createElement('div', { 'data-stub': name }); };
  const SettingsPage = sucrase
    ? load('src/app/admin/settings/page.js', {
      react: pageReact,
      'react-icons/fi': icons,
      'next/image': esm((props) => React.createElement('img', { alt: '', ...props })),
      'react-hot-toast': esm({ success() {}, error() {} }),
      '@/components/admin/showcase/CategoryShowcaseManager': esm(stub('CategoryShowcaseManager')),
      '@/components/admin/AnnouncementSettingsPanel': esm(AnnouncementSettingsPanel),
      '@/components/admin/DeliveryMessagePanel': esm(Panel),
      '@/components/admin/AvatarUploadField': esm(stub('AvatarUploadField')),
      '@/context/CartContext': { useCart: () => ({ ...cart, refreshCharges() {} }) },
    }).default
    : null;
  const renderPage = (which) => {
    tab = which;
    const warnings = [];
    const orig = console.error;
    console.error = (...args) => { warnings.push(args.map(String).join(' ')); };
    try { return renderToStaticMarkup(React.createElement(SettingsPage)); } finally { console.error = orig; tab = 'Business'; assert.deepEqual(warnings, [], 'React warned while rendering'); }
  };

  test('still imports and renders (every tab)', () => {
    for (const t of ['Business', 'Website', 'Marketing', 'Social & Email', 'Defaults']) {
      const h = renderPage(t);
      assert.match(h, /Admin Settings/, t);
      assert.match(h, /Save Settings/, t);
    }
  });

  test('Marketing: the Delivery Message card sits right under the Welcome Offer card, above the hero photo card', () => {
    const h = renderPage('Marketing');
    const offer = h.indexOf('Welcome Offer Bar');
    const delivery = h.indexOf('id="dm-title"');
    const hero = h.indexOf('Homepage Hero Photo');
    assert.ok(offer > 0 && delivery > offer && hero > delivery, `${offer} < ${delivery} < ${hero}`);
    assert.equal((h.match(/id="dm-title"/g) || []).length, 1, 'once');
    assert.doesNotMatch(h.slice(offer, delivery), /Homepage Hero Photo|Instagram Feed/, 'nothing in between');
  });

  test('it is only in the Marketing tab', () => {
    for (const t of ['Business', 'Website', 'Social & Email', 'Defaults']) assert.doesNotMatch(renderPage(t), /id="dm-title"/, t);
  });

  test('it is wired to settings.deliveryMessage, and the page’s Save sends it (it is not a field the page leaves out)', () => {
    const src = readFileSync('src/app/admin/settings/page.js', 'utf8');
    assert.match(src, /<DeliveryMessagePanel value=\{settings\.deliveryMessage\} onChange=\{\(d\) => upd\('deliveryMessage', d\)\} \/>/);
    const retired = src.match(/const SHOWCASE_FIELDS = \[([^\]]*)\]/)[1];
    assert.doesNotMatch(retired, /deliveryMessage/, 'withoutShowcase must not strip it from the Save');
    assert.match(src, /JSON\.stringify\(\{ \.\.\.withoutShowcase\(settings\), heroSlides, testimonials, instagramFeed \}\)/);
  });

  test('the welcome-offer card’s own preview follows the Delivery Message card (switched off there, gone here)', () => {
    const preview = (props) => {
      const h = withCharges(FREE, () => renderToStaticMarkup(React.createElement(AnnouncementSettingsPanel, { onChange() {}, value: undefined, ...props })));
      return textOf(h).split(' Preview ')[1];
    };
    assert.match(preview({}), /Use Code: TULSI100 \| Free Delivery across India 🚚/);
    assert.match(preview({ deliveryMessage: { enabled: false } }), /Use Code: TULSI100(?! \| Free Delivery)/);
    assert.doesNotMatch(preview({ deliveryMessage: { enabled: false } }), /Free Delivery across India/);
    assert.match(preview({ deliveryMessage: { barText: 'We ship free' } }), /Use Code: TULSI100 \| We ship free 🚚/);
  });

  test('the welcome-offer card’s help copy points to the new card instead of saying the line is only about shipping settings', () => {
    const t = textOf(withCharges(FREE, () => renderToStaticMarkup(React.createElement(AnnouncementSettingsPanel, { onChange() {}, value: undefined }))));
    assert.match(t, /The delivery line has its own card, Delivery Message ?, just below: switch it off, reword it or restyle it there\./);
    assert.match(t, /By default \(“Smart”\) “Free Delivery across India” appears only when shipping is switched off for every order in your Shipping & Payment Charges\./);
    assert.doesNotMatch(t, /The delivery line comes from your Shipping/);
  });
});
