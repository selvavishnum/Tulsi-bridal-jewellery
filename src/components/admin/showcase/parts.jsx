'use client';

/* Small pieces shared by the Category Showcase manager and its preview
   modal: shape glyphs, segmented controls, the layout controls, and a
   photo framed exactly like the storefront crops it. */
import { useState } from 'react';
import { FiImage } from 'react-icons/fi';
import { LAYOUT_VARIANTS, DISPLAY_MODES, SIZES, showcaseImageUrl, showcaseSrcSet, focusStyle } from '@/lib/categoryShowcase';

/* Frame per shape (full class strings so Tailwind ships them). */
export const FRAME = {
  circle: 'aspect-square rounded-full',
  square: 'aspect-square rounded-xl',
  king_size: 'aspect-[4/5] rounded-xl',
  wide: 'aspect-video rounded-xl',
};

export const SHAPE_LABEL = { circle: 'Circle', square: 'Square 1:1', king_size: 'King Size 4:5', wide: 'Wide Banner' };
export const SHAPE_SHORT = { circle: 'Circle', square: 'Square', king_size: 'King', wide: 'Wide' };

export const sameLayout = (a, b) => !!a && !!b && a.layoutVariant === b.layoutVariant && a.displayMode === b.displayMode && a.size === b.size;
export const sameFocus = (a, b) => !!a && !!b && a.gravity === b.gravity && a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/** Tiny outline of a shape, drawn to its real proportions. */
export function ShapeGlyph({ variant, className = 'h-4 w-4' }) {
  const common = { fill: 'currentColor', fillOpacity: 0.15, stroke: 'currentColor', strokeWidth: 1.5 };
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      {variant === 'circle' && <circle cx="8" cy="8" r="6.25" {...common} />}
      {variant === 'square' && <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="1.5" {...common} />}
      {variant === 'king_size' && <rect x="3" y="1.25" width="10" height="13.5" rx="1.5" {...common} />}
      {variant === 'wide' && <rect x="0.75" y="3.75" width="14.5" height="8.5" rx="1.5" {...common} />}
    </svg>
  );
}

export function ModeGlyph({ mode, className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false" fill="currentColor">
      {mode === 'grid'
        ? <><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" /><rect x="9" y="1.5" width="5.5" height="5.5" rx="1" /><rect x="1.5" y="9" width="5.5" height="5.5" rx="1" /><rect x="9" y="9" width="5.5" height="5.5" rx="1" /></>
        : <><rect x="0.5" y="3" width="5" height="10" rx="1" /><rect x="7" y="3" width="5" height="10" rx="1" /><rect x="13.5" y="3" width="2.5" height="10" rx="1" fillOpacity="0.45" /></>}
    </svg>
  );
}

/**
 * A row of toggle buttons (aria-pressed) where exactly one is on.
 * options: [{ value, label, icon?, title?, hideLabelOnMobile? }]
 */
export function Segmented({ label, options, value, onChange, compact = false }) {
  return (
    <div className="min-w-0">
      <p className={`text-xs font-semibold text-gray-600 ${compact ? 'mb-1' : 'mb-1.5'}`}>{label}</p>
      <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              title={o.title}
              onClick={() => { if (!on) onChange(o.value); }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${on ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 hover:bg-amber-50 hover:text-amber-700'}`}
            >
              {o.icon}
              <span className={o.hideLabelOnMobile ? 'sr-only sm:not-sr-only' : ''}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Shape / Display mode / Density for the section (edits a layout draft). */
export function LayoutControls({ layout, onChange, compact = false }) {
  const set = (k) => (v) => onChange({ ...layout, [k]: v });
  const hint = LAYOUT_VARIANTS.find((v) => v.value === layout.layoutVariant)?.hint;
  return (
    <div className={`flex flex-wrap items-start ${compact ? 'gap-x-4 gap-y-2' : 'gap-x-6 gap-y-3'}`}>
      <div className="min-w-0">
        <Segmented
          label="Shape"
          compact={compact}
          value={layout.layoutVariant}
          onChange={set('layoutVariant')}
          options={LAYOUT_VARIANTS.map((v) => ({
            value: v.value,
            label: compact ? SHAPE_SHORT[v.value] : SHAPE_LABEL[v.value],
            title: `${SHAPE_LABEL[v.value]} — ${v.hint}`,
            icon: <ShapeGlyph variant={v.value} />,
            hideLabelOnMobile: compact,
          }))}
        />
        {!compact && hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      </div>
      <Segmented
        label="Display mode"
        compact={compact}
        value={layout.displayMode}
        onChange={set('displayMode')}
        options={DISPLAY_MODES.map((m) => ({
          value: m.value,
          label: m.label,
          title: m.value === 'slider' ? 'One swipeable row (arrows on desktop)' : 'Rows that wrap',
          icon: <ModeGlyph mode={m.value} />,
        }))}
      />
      <Segmented
        label="Density"
        compact={compact}
        value={layout.size}
        onChange={set('size')}
        options={SIZES.map((s) => ({ value: s, label: cap(s), title: s === 'small' ? 'More cards per row' : s === 'large' ? 'Fewer, bigger cards' : undefined }))}
      />
    </div>
  );
}

/**
 * The category photo inside a frame of `variant`, cropped the way the
 * storefront crops it (same URL + focus style). Emoji placeholder when
 * there is no photo, or when it fails to load.
 */
export function ShowcasePhoto({ item, variant, focus = item.focus, width = 400, sizes = '200px', className = '', emojiClass = 'text-3xl' }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const src = item.image ? showcaseImageUrl(item.image, { variant, focus, width }) : '';
  const failed = !!src && failedSrc === src;
  return (
    <span className={`relative block overflow-hidden bg-stone-50 ${FRAME[variant]} ${className}`}>
      {src && !failed ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          srcSet={showcaseSrcSet(item.image, { variant, focus }, [160, 240, 400, 600])}
          sizes={sizes}
          alt=""
          draggable={false}
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 h-full w-full"
          style={focusStyle(focus)}
        />
      ) : (
        <span className={`absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br ${item.color}`}>
          <span className={emojiClass} aria-hidden="true">{item.emoji}</span>
          {failed && <span className="flex items-center gap-1 text-[10px] font-medium text-gray-500"><FiImage aria-hidden="true" /> Photo didn&apos;t load</span>}
        </span>
      )}
    </span>
  );
}
