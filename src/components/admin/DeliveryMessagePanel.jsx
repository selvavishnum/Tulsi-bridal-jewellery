'use client';

/* ─────────────────────────────────────────────
   Admin card for the delivery message — the "Free Delivery across India"
   line (top strip, product pages) and the "Free Nationwide Shipping" badge
   (home page) — settings/site.deliveryMessage.

   The owner can switch it off, choose when it shows, reword it, pick an icon,
   and change its font, model (shape) and design (colours), watching a live
   preview of all three places as they go. The preview and the small samples
   are drawn by the very component the storefront uses (<DeliveryMessage/>), so
   what the owner sees here is what a customer gets.

   Controlled: `value` is settings.deliveryMessage (may be missing, partial or
   garbage — the defaults then apply) and `onChange(next)` gets the whole new
   configuration. Saved with the settings page's Save Settings button; no
   network calls here. The shipping rule it is checked against comes from
   useCart().charges, as the welcome-offer card does.

   The logic (what a typed value becomes, what the storefront would do, the
   colour advice) is in deliveryMessageAdmin.js; this file is the markup.
   Every control is a native radio / checkbox / input (keyboard and screen
   reader friendly) at least 44px tall, and it works at 360px wide.
   ───────────────────────────────────────────── */
import { useState } from 'react';
import { FiAlertCircle, FiAlertTriangle, FiCheck, FiCheckCircle, FiRotateCcw } from 'react-icons/fi';
import { useCart } from '@/context/CartContext';
import DeliveryMessage from '@/components/ui/DeliveryMessage';
import { DELIVERY_TEXT_MAX, DEFAULT_BAR_TEXT, DEFAULT_BADGE_TEXT, modelHasBackground, hasVisibleText } from '@/lib/deliveryMessage';
import {
  DELIVERY_OPTIONS, SAMPLE_WORDS, COLOR_TYPING_HINT, editableConfig, changeConfig, changeStyle, changeColor, typedText, parseHexInput,
  isCompleteHex, colorRefusal, lookIsDefault, resetLook, sampleConfig, previewState, contrastNotes, deliveryMismatch,
} from '@/components/admin/deliveryMessageAdmin';

/* The strip's dark gradient (the same classes as WelcomeBar's BAR_BG). */
const BAR_BG = 'bg-velvet-950 bg-gradient-to-r from-velvet-950 via-wine-950 to-velvet-950';

/* Focus rings are amber-600 (3.2:1 on white), not amber-400 (1.7:1): where outline-none removes the browser's
   own, the ring is the only sign of where the keyboard is. */
const fieldCls = 'w-full min-h-[44px] scroll-mt-44 rounded-lg border border-gray-400 px-3 py-2 text-base outline-none focus:ring-2 focus:ring-amber-600 sm:text-sm lg:scroll-mt-4';
const linkBtn = 'inline-flex min-h-[44px] items-center rounded-md px-1 text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600';

/* Shown in the font cards and weight buttons, so each choice is drawn the way it will look. */
const FONT_CLASS = { sans: 'font-sans', serif: 'font-serif', classic: 'font-classic' };
const WEIGHT_CLASS = { normal: 'font-normal', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' };
const TONE_HINT = { auto: 'Matches each place on your shop', custom: 'Pick your own colours' };

/* ── Small building blocks ── */

function Section({ id, title, help, children }) {
  return (
    <section aria-labelledby={id} className="border-t border-gray-100 pt-5">
      <h3 id={id} className="text-sm font-bold text-gray-800">{title}</h3>
      <p className="mb-3 mt-0.5 text-xs leading-relaxed text-gray-600">{help}</p>
      {children}
    </section>
  );
}

/* The tick on the corner of the chosen card: the choice is never told by colour alone. */
function CornerTick() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-600 text-white shadow">
      <FiCheck className="h-3 w-3" />
    </span>
  );
}

/* One choice among several, drawn as a card. The radio is the real control (hidden, but focusable). */
function OptionCard({ name, value, checked, onSelect, children, className = '' }) {
  return (
    <label className={`relative block cursor-pointer ${className}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onSelect(value)} className="peer sr-only" />
      <span className="block h-full rounded-xl border-2 border-gray-200 bg-white p-3 transition-colors hover:border-gray-300 peer-checked:border-amber-500 peer-checked:bg-amber-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-amber-600">
        {children}
      </span>
      {checked && <CornerTick />}
    </label>
  );
}

/* A short row of choices (weight, size, spacing). */
function Segmented({ legend, name, value, options, onSelect, optionClass }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 p-0 text-xs font-semibold text-gray-700">{legend}</legend>
      <div className="flex gap-0.5 rounded-xl bg-gray-100 p-0.5 min-[400px]:gap-1 min-[400px]:p-1">
        {options.map((o) => (
          <label key={o.value} className="relative block min-w-0 flex-1 cursor-pointer">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onSelect(o.value)} className="peer sr-only" />
            <span className={`flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg px-0 text-center text-[10px] text-gray-700 min-[360px]:text-[11px] peer-checked:bg-white peer-checked:text-gray-900 peer-checked:shadow-sm peer-checked:ring-2 peer-checked:ring-amber-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-amber-600 min-[400px]:text-xs sm:text-sm ${optionClass ? optionClass[o.value] : ''}`}>
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* An on/off choice drawn as a button-like chip (italic, UPPERCASE). */
function CheckChip({ name, checked, onToggle, label, labelClass = '' }) {
  return (
    <label className="relative block cursor-pointer">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onToggle(e.target.checked)} className="peer sr-only" />
      <span className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border-2 border-gray-200 bg-white px-3 text-sm text-gray-800 peer-checked:border-amber-500 peer-checked:bg-amber-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-amber-600 ${labelClass}`}>
        <FiCheck aria-hidden="true" className={`h-4 w-4 flex-shrink-0 text-amber-700 ${checked ? '' : 'invisible'}`} />
        {label}
      </span>
    </label>
  );
}

/* A control that takes itself away when used (or is switched off) would drop the keyboard on the page: put it on a
   stable element instead. (Browser only; the click handlers are the sole callers.) */
function keepFocus(id) {
  if (typeof document !== 'undefined') document.getElementById(id)?.focus();
}

function WordsField({ id, label, help, value, fallback, onType, onReset }) {
  const full = value.length >= DELIVERY_TEXT_MAX;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-gray-700">{label}</label>
        <span className={`text-xs tabular-nums ${full ? 'font-semibold text-amber-700' : 'text-gray-600'}`}>{value.length}/{DELIVERY_TEXT_MAX}</span>
      </div>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={DELIVERY_TEXT_MAX}
        onChange={(e) => onType(e.target.value)}
        placeholder={fallback}
        aria-describedby={`${id}-help`}
        className={fieldCls}
      />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
        <p id={`${id}-help`} className="text-xs text-gray-600">
          {hasVisibleText(value) ? help : 'Empty: the default words are shown. To hide the message, use the switch at the top of this card.'}
        </p>
        {value !== fallback && (
          <button type="button" onClick={() => { onReset(); keepFocus(id); }} className={linkBtn}>
            <FiRotateCcw aria-hidden="true" className="mr-1 h-3 w-3" />Use the default words
          </button>
        )}
      </div>
    </div>
  );
}

/* While the owner types, an unfinished code is not a mistake yet: a plain hint. Only leaving the box holding something
   that is not a colour (`refused`: what it held) is told as an error, and says the colour did not change. */
function ColorField({ id, label, hint, value, draft, refused, onPick, onType, onEnd }) {
  const typing = draft !== undefined && parseHexInput(draft) === null;
  const invalid = refused !== undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-gray-700">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onPick(e.target.value)}
          aria-label={`${label}: pick a colour`}
          className="h-11 w-14 flex-shrink-0 cursor-pointer rounded-lg border border-gray-400 bg-white p-1"
        />
        <input
          id={id}
          type="text"
          inputMode="text"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          maxLength={7}
          value={draft === undefined ? value : draft}
          onChange={(e) => onType(e.target.value)}
          onBlur={onEnd}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint ${id}-note`}
          className={`${fieldCls} font-mono ${invalid ? 'border-red-500' : ''}`}
        />
      </div>
      <p id={`${id}-hint`} className="mt-1 text-xs text-gray-600">{typing ? COLOR_TYPING_HINT : hint}</p>
      <p id={`${id}-note`} aria-live="polite" className={invalid ? 'mt-1 text-xs text-red-700' : undefined}>{invalid ? colorRefusal(refused) : ''}</p>
    </div>
  );
}

/* ── The live preview ── */

function PreviewRow({ label, children }) {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2 lg:grid-cols-1 lg:gap-1">
      <span className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-600">{label}</span>
      {children}
    </div>
  );
}

/* The pinned preview sticks inside the scrolling <main>'s padding (p-4 / md:p-6, see src/app/admin/layout.js),
   not at its edge: -top-4 / md:-top-6 cancel that padding so no strip of scrolling options shows above it.
   From lg it is a side panel (top-4), with room around it by design. */
function Preview({ config, state }) {
  const { live, words } = state;
  return (
    <div
      role="group"
      aria-label="Live preview"
      className="sticky -top-4 z-20 -mx-5 mb-5 border-b border-gray-200 bg-white px-5 pb-3 pt-2 shadow-sm md:-top-6 lg:top-4 lg:order-2 lg:mx-0 lg:mb-0 lg:self-start lg:rounded-xl lg:border lg:bg-gray-50 lg:p-4 lg:shadow-none"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">Live preview</h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
          {live ? 'Showing on your shop' : 'Not showing right now'}
        </span>
      </div>
      <div className={`space-y-1.5 ${live ? '' : 'opacity-60'}`}>
        <PreviewRow label="Top strip">
          <div className={`h-8 overflow-x-auto overflow-y-hidden rounded-md [scrollbar-width:none] ${BAR_BG}`}>
            <p className="flex h-8 w-max min-w-full items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs tracking-wide text-gold-200">
              <DeliveryMessage text={words.bar} config={config} surface="bar" />
            </p>
          </div>
        </PreviewRow>
        <PreviewRow label="Home page">
          <div className="flex min-h-8 items-center justify-center rounded-md bg-[#FAF8F5] px-3 py-1">
            <ul role="list" className="m-0 flex list-none flex-wrap items-center justify-center gap-x-5 gap-y-1 p-0">
              <DeliveryMessage text={words.badge} config={config} surface="badge" as="li" />
            </ul>
          </div>
        </PreviewRow>
        <PreviewRow label="Product page">
          <div className="min-h-8 rounded-md border border-gray-200 bg-white px-3 py-1.5">
            <DeliveryMessage text={words.product} config={config} surface="product" />
          </div>
        </PreviewRow>
      </div>
      <p className="mt-2 hidden text-[11px] leading-snug text-gray-600 lg:block">
        Changes show here at once. They reach your shop when you press Save Settings.
      </p>
    </div>
  );
}

/* ── The card ── */

export default function DeliveryMessagePanel({ value, onChange }) {
  const { charges } = useCart();
  /* A colour box mid-typing: { text?: '#68', bg?: … }. A complete colour is applied at once; this only keeps half-typed text from being overwritten. */
  const [drafts, setDrafts] = useState({});
  /* A colour box the owner left holding something that is not a colour: { text?: 'banana', … } (what it held), until they type or pick again. */
  const [refused, setRefused] = useState({});
  /* The card as it was just before "Reset look" (null: no reset to undo). Any other change forgets it. */
  const [undo, setUndo] = useState(null);

  const cfg = editableConfig(value);
  const { style } = cfg;
  const state = previewState(cfg, charges);
  const mismatch = deliveryMismatch(cfg, charges);
  const notes = contrastNotes(cfg);
  const usesBackground = modelHasBackground(style.model);

  const emit = (next) => { setUndo(null); if (typeof onChange === 'function') onChange(next); };
  const setTop = (patch) => emit(changeConfig(cfg, patch));
  const setStyle = (patch) => emit(changeStyle(cfg, patch));

  const pickColor = (which, hex) => {
    setDrafts((d) => ({ ...d, [which]: undefined }));
    setRefused((r) => ({ ...r, [which]: undefined }));
    emit(changeColor(cfg, which, hex));
  };
  const typeColor = (which, text) => {
    setDrafts((d) => ({ ...d, [which]: text }));
    setRefused((r) => ({ ...r, [which]: undefined }));
    if (isCompleteHex(text)) emit(changeColor(cfg, which, parseHexInput(text)));
  };
  /* Leaving the box: a finished colour (the short form too) is applied; anything else goes back to the colour in use, and says so. */
  const endColor = (which) => {
    const typed = drafts[which];
    if (typed === undefined) return;
    setDrafts((d) => ({ ...d, [which]: undefined }));
    const hex = parseHexInput(typed);
    if (!hex) setRefused((r) => ({ ...r, [which]: typed }));
    else if (hex !== style.colors[which]) emit(changeColor(cfg, which, hex));
  };

  /* The button stays focusable (aria-disabled) at the default look, so using it never drops the keyboard on the page; the
     note below it says what happened, and offers the way back (the custom colours are otherwise gone). */
  const lookIsOriginal = lookIsDefault(cfg);
  const resetTheLook = () => {
    if (lookIsOriginal) return;
    setDrafts({});
    setRefused({});
    emit(resetLook(cfg));
    setUndo(cfg);
  };
  const undoTheReset = () => {
    if (!undo) return;
    setDrafts({});
    setRefused({});
    emit(undo);
    keepFocus('dm-reset-look');
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dm-title" className="mb-1 font-bold text-gray-800">Delivery Message</h2>
          <p className="text-xs leading-relaxed text-gray-600">
            The &ldquo;Free Delivery across India&rdquo; line on your top strip, home page and product pages. Turn it off, change the words, or restyle it. Your changes go live when you press the <span className="font-semibold">Save Settings</span> button at the top of the page.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={cfg.enabled}
          aria-labelledby="dm-title"
          onClick={() => setTop({ enabled: !cfg.enabled })}
          className="flex h-11 flex-shrink-0 items-center gap-2 rounded-full pl-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
        >
          <span aria-hidden="true" className={`w-6 text-right text-xs font-bold ${cfg.enabled ? 'text-amber-800' : 'text-gray-600'}`}>{cfg.enabled ? 'On' : 'Off'}</span>
          <span aria-hidden="true" className={`relative block h-6 w-12 rounded-full transition-colors duration-200 ${cfg.enabled ? 'bg-amber-500' : 'bg-gray-400'}`}>
            <span className={`absolute left-0.5 top-0.5 block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${cfg.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
          </span>
        </button>
      </div>

      <div
        role="status"
        aria-live="polite"
        className={`mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed ${state.live && !mismatch ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
      >
        {!state.live && state.reason}
        {state.live && !mismatch && 'Showing on your shop: customers see it on the top strip (computers), the home page and product pages.'}
        {state.live && mismatch && 'Showing on your shop, but your shipping settings still charge for delivery. Check the warning under “Show when”.'}
      </div>

      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
        <Preview config={cfg} state={state} />

        <div className="min-w-0 space-y-5 lg:order-1">
          <Section id="dm-when" title="Show when" help="Choose when customers can see it.">
            <div role="radiogroup" aria-labelledby="dm-when" className="grid gap-2 sm:grid-cols-2">
              {DELIVERY_OPTIONS.modes.map((m) => (
                <OptionCard key={m.value} name="dm-mode" value={m.value} checked={cfg.mode === m.value} onSelect={(v) => setTop({ mode: v })}>
                  <span className="block text-sm font-semibold text-gray-900">{m.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-gray-600">{m.hint}</span>
                </OptionCard>
              ))}
            </div>
            <div aria-live="polite">
              {mismatch && (
                <div className="mt-3 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                  <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
                  <div>
                    <p className="font-semibold">Check your delivery charges</p>
                    <p className="mt-0.5">{mismatch}</p>
                    <p className="mt-1">Shipping charges are set in this page under <span className="font-semibold">Business &rarr; Shipping &amp; Payment Charges</span>.</p>
                    <button type="button" onClick={() => setTop({ mode: 'auto' })} className={`${linkBtn} -ml-1`}>Switch to Smart</button>
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section
            id="dm-words"
            title="Words"
            help="Plain text, up to 60 characters. Leave a box empty to use the default words."
          >
            <p className="mb-3 text-xs leading-relaxed text-gray-600">
              {cfg.mode === 'auto'
                ? 'In Smart mode the words show only while delivery is free on every order, so keep them about free delivery for everyone.'
                : 'In Always mode you decide the words, so make sure they are true for every order (for example “Free delivery above ₹999” if that is your rule).'}
            </p>
            <div className="space-y-4">
              <WordsField
                id="dm-bar-text"
                label="Top strip and product page"
                help="Shown in the strip at the top of every page (computers) and in the list on each product page."
                value={cfg.barText}
                fallback={DEFAULT_BAR_TEXT}
                onType={(t) => setTop({ barText: typedText(t) })}
                onReset={() => setTop({ barText: DEFAULT_BAR_TEXT })}
              />
              <WordsField
                id="dm-badge-text"
                label="Home page badge"
                help="Shown in the row of small badges under the big home page photo."
                value={cfg.badgeText}
                fallback={DEFAULT_BADGE_TEXT}
                onType={(t) => setTop({ badgeText: typedText(t) })}
                onReset={() => setTop({ badgeText: DEFAULT_BADGE_TEXT })}
              />
            </div>
          </Section>

          <Section id="dm-icon" title="Icon" help="A small picture next to the words.">
            <div role="radiogroup" aria-labelledby="dm-icon" className="flex flex-wrap gap-1.5 min-[420px]:gap-2">
              {DELIVERY_OPTIONS.icons.map((o) => (
                <label key={o.value || 'none'} className="relative block cursor-pointer">
                  <input type="radio" name="dm-icon" value={o.value} checked={cfg.icon === o.value} onChange={() => setTop({ icon: o.value })} className="peer sr-only" />
                  <span className="flex h-11 min-w-[44px] items-center justify-center rounded-xl border-2 border-gray-200 bg-white px-2 text-xl leading-none peer-checked:border-amber-500 peer-checked:bg-amber-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-amber-600">
                    {o.value ? <span aria-hidden="true">{o.value}</span> : <span aria-hidden="true" className="text-xs font-medium text-gray-700">None</span>}
                    <span className="sr-only">{o.label}</span>
                  </span>
                  {cfg.icon === o.value && <CornerTick />}
                </label>
              ))}
            </div>
          </Section>

          <Section id="dm-font" title="Font style" help="How the letters look.">
            <div className="space-y-4">
              <div role="radiogroup" aria-labelledby="dm-font-family" className="space-y-1.5">
                <p id="dm-font-family" className="text-xs font-semibold text-gray-700">Font</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {DELIVERY_OPTIONS.fonts.map((f) => (
                    <OptionCard key={f.value} name="dm-font" value={f.value} checked={style.font === f.value} onSelect={(v) => setStyle({ font: v })}>
                      <span className={`block text-lg leading-tight text-gray-900 ${FONT_CLASS[f.value]}`}>Free Delivery</span>
                      <span className="mt-1 block text-sm font-semibold text-gray-900">{f.label}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-gray-600">{f.hint}</span>
                    </OptionCard>
                  ))}
                </div>
              </div>
              <Segmented legend="Weight" name="dm-weight" value={style.weight} options={DELIVERY_OPTIONS.weights} optionClass={WEIGHT_CLASS} onSelect={(v) => setStyle({ weight: v })} />
              <Segmented legend="Size" name="dm-size" value={style.size} options={DELIVERY_OPTIONS.sizes} onSelect={(v) => setStyle({ size: v })} />
              <Segmented legend="Letter spacing" name="dm-tracking" value={style.tracking} options={DELIVERY_OPTIONS.trackings} onSelect={(v) => setStyle({ tracking: v })} />
              <div className="grid grid-cols-2 gap-2">
                <CheckChip name="dm-italic" checked={style.italic} onToggle={(on) => setStyle({ italic: on })} label="Italic" labelClass="italic" />
                <CheckChip name="dm-uppercase" checked={style.uppercase} onToggle={(on) => setStyle({ uppercase: on })} label="UPPERCASE" labelClass="tracking-wide" />
              </div>
            </div>
          </Section>

          <Section id="dm-model" title="Model" help="The shape the message is drawn in.">
            <div role="radiogroup" aria-labelledby="dm-model" className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-3">
              {DELIVERY_OPTIONS.models.map((m) => (
                <OptionCard key={m.value} name="dm-model" value={m.value} checked={style.model === m.value} onSelect={(v) => setStyle({ model: v })}>
                  <span className="mb-2 flex h-12 items-center justify-center overflow-hidden rounded-lg bg-[#FAF8F5] px-0.5">
                    <DeliveryMessage text={SAMPLE_WORDS} config={sampleConfig(cfg, { model: m.value })} surface="badge" />
                  </span>
                  <span className="block text-sm font-semibold text-gray-900">{m.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-gray-600">{m.hint}</span>
                </OptionCard>
              ))}
            </div>
          </Section>

          <Section id="dm-design" title="Design" help="The colours.">
            <div role="radiogroup" aria-labelledby="dm-design" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DELIVERY_OPTIONS.tones.map((t) => {
                const [text, bg] = t.value === 'custom' ? [style.colors.text, style.colors.bg] : t.swatch;
                return (
                  <OptionCard key={t.value} name="dm-tone" value={t.value} checked={style.tone === t.value} onSelect={(v) => setStyle({ tone: v })}>
                    <span
                      aria-hidden="true"
                      style={{ color: text, backgroundColor: bg }}
                      className="mb-2 flex h-9 items-center justify-center rounded-lg border border-black/10 text-sm font-semibold"
                    >
                      Aa
                    </span>
                    <span className="block text-sm font-semibold text-gray-900">{t.label}</span>
                    {TONE_HINT[t.value] && <span className="mt-0.5 block text-xs leading-snug text-gray-600">{TONE_HINT[t.value]}</span>}
                  </OptionCard>
                );
              })}
            </div>

            {style.tone === 'custom' && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ColorField
                    id="dm-color-text"
                    label="Text colour"
                    hint="The colour of the words."
                    value={style.colors.text}
                    draft={drafts.text}
                    refused={refused.text}
                    onPick={(hex) => pickColor('text', hex)}
                    onType={(t) => typeColor('text', t)}
                    onEnd={() => endColor('text')}
                  />
                  <ColorField
                    id="dm-color-bg"
                    label="Background colour"
                    hint={usesBackground ? 'Behind the words.' : 'Not used by this model: only Soft pill and Solid badge have a background.'}
                    value={style.colors.bg}
                    draft={drafts.bg}
                    refused={refused.bg}
                    onPick={(hex) => pickColor('bg', hex)}
                    onType={(t) => typeColor('bg', t)}
                    onEnd={() => endColor('bg')}
                  />
                </div>
                <ul role="list" id="dm-contrast-notes" aria-live="polite" className="mt-3 space-y-2">
                  {notes.length === 0 && (
                    <li className="flex gap-2 text-xs text-green-800">
                      <FiCheckCircle aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>These colours are easy to read.</span>
                    </li>
                  )}
                  {notes.map((n) => (
                    <li
                      key={n.level}
                      className={`flex gap-2 rounded-lg border p-3 text-xs leading-relaxed ${n.level === 'unusable' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
                    >
                      {n.level === 'unusable'
                        ? <FiAlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-700" />
                        : <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />}
                      <span><span className="font-semibold">{n.level === 'unusable' ? 'Won’t be used. ' : 'Hard to read. '}</span>{n.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                id="dm-reset-look"
                type="button"
                aria-disabled={lookIsOriginal}
                onClick={resetTheLook}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-400 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 aria-disabled:cursor-not-allowed aria-disabled:border-gray-300 aria-disabled:bg-gray-50 aria-disabled:text-gray-500"
              >
                <FiRotateCcw aria-hidden="true" className="h-4 w-4" />Reset look to default
              </button>
              <p className="min-w-0 flex-1 basis-56 text-xs leading-snug text-gray-600">
                Puts the icon, font, model and colours back to the original look. Your words and the switch stay as they are.
              </p>
            </div>
            <div role="status" aria-live="polite">
              {undo && (
                <p className="mt-3 flex flex-wrap items-center gap-x-3 rounded-lg border border-green-200 bg-green-50 px-3 py-1 text-xs leading-relaxed text-green-900">
                  <FiCheckCircle aria-hidden="true" className="h-4 w-4 flex-shrink-0" />
                  <span>The look is back to the original. Press Save Settings to keep it.</span>
                  <button type="button" onClick={undoTheReset} className={linkBtn}>Undo</button>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
