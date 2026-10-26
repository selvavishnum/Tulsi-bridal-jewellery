'use client';

/* ─────────────────────────────────────────────
   Admin → Settings → Marketing → Website Advertisements: the banners shown on the
   home, shop, category, product, cart, checkout, order-success and track-order pages.

   The same features as the other photo sections (layout bar, cards with order / show-hide /
   upload, Preview with the crop editor — PhotoSectionManager), plus each ad's own fields: a
   title and button text drawn over the banner, where a tap goes, and which pages it appears on.
   The preview has a "Page" picker: it draws that page's slot.

   It edits the page's draft, not the server: the settings page keeps `value` in state and saves
   it with "Save Settings" (POST /api/admin/settings, key `advertisements`).
   ───────────────────────────────────────────── */
import { useState } from 'react';
import { newItem, normalizeLayout, safeAdLink, visible, SECTIONS, LIMITS, PLACEMENTS } from '@/lib/marketing';
import PhotoSectionManager from './PhotoSectionManager';
import { MODE_CHOICES } from './MarketingPanels';

const inputCls = 'w-full min-h-10 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-600';

/* Where each banner appears, in plain words (the page names themselves come from PLACEMENTS). */
export const PLACEMENT_NOTES = {
  home: 'Between the categories and the products',
  shop: 'At the top of the Shop page',
  category: 'At the top of every category page',
  product: 'Under the product',
  cart: 'Under the cart',
  checkout: 'Under the checkout form',
  'order-success': 'Under the order confirmation',
  'track-order': 'Under order tracking',
};

/**
 * @typedef {object} Advertisements
 * @property {{ layoutVariant: string, displayMode: string, size: string }} layout
 * @property {{ id: string, isActive: boolean, image: string, focus: object, link: string,
 *   title: string, buttonText: string, placements: string[] }[]} items
 *   (the shape normalizeAdvertisements() in src/lib/marketing.js returns)
 */

/** How many shown ads each page has: [{ value, label, count }] — what the owner sees as "Shop: 2". */
export function placementCounts(items) {
  const shown = visible(items, 'ads');
  return PLACEMENTS.map((p) => ({ value: p.value, label: p.label, count: shown.filter((ad) => (ad.placements || []).includes(p.value)).length }));
}

/** The note under an ad's link box ('' when the link is fine or empty). */
export function linkProblem(link) {
  const typed = typeof link === 'string' ? link.trim() : '';
  return typed && safeAdLink(typed) !== typed ? 'Use a page on this site (like /shop or /catalog?category=earrings) or a full link that starts with https://' : '';
}

const LAYOUT_PROPS = { shapes: SECTIONS.ads.shapes, modes: SECTIONS.ads.modes.map((m) => MODE_CHOICES[m]), sizes: SECTIONS.ads.sizes };

/**
 * @param {{ value: Advertisements, onChange: (next: Advertisements) => void }} props
 *   value: the current draft, normalized; onChange: called with the whole new value (never mutated in place)
 */
export default function AdvertisementsManager({ value, onChange }) {
  const items = Array.isArray(value?.items) ? value.items : [];
  const layout = normalizeLayout(value?.layout, 'ads');
  const [previewPage, setPreviewPage] = useState('shop');
  const setItems = (next) => onChange({ layout, items: next });
  const setLayout = (next) => onChange({ layout: next, items });
  const counts = placementCounts(items);

  const picker = (
    <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
      Page
      <select value={previewPage} onChange={(e) => setPreviewPage(e.target.value)} aria-label="Preview the banners of this page"
        className="min-h-9 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 outline-none focus:ring-2 focus:ring-amber-600">
        {PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
    </label>
  );

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        Banners with your own photo, a line of text and a button. Choose which pages show each one; with none on a page, nothing is drawn there.
      </p>
      <ul className="mb-4 flex flex-wrap gap-1.5" aria-label="Banners per page">
        {counts.map((c) => (
          <li key={c.value} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${c.count ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
            {c.label.replace(/ page$/, '')}: {c.count}
          </li>
        ))}
      </ul>
      <PhotoSectionManager
        section="ads"
        items={items}
        onItemsChange={setItems}
        layout={layout}
        onLayoutChange={setLayout}
        photoField="image"
        itemName={(ad, i) => (ad.title && ad.title.trim()) || `Ad ${i + 1}`}
        uploadFolder="tulsi-bridal/ads"
        makeItem={() => newItem('ads', { id: `ad-${Date.now().toString(36)}`, placements: ['home'] })}
        gridClass="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1360px]:grid-cols-3"
        renderDetails={(ad, i, update) => {
          const problem = linkProblem(ad.link);
          const has = (v) => (ad.placements || []).includes(v);
          const togglePlacement = (v) => update({ placements: has(v) ? ad.placements.filter((p) => p !== v) : [...(ad.placements || []), v] });
          return (
            <div className="grid gap-3">
              <div>
                <label htmlFor={`ad-title-${i}`} className="mb-1 block text-xs font-medium text-gray-600">Title (over the photo)</label>
                <input id={`ad-title-${i}`} value={ad.title || ''} maxLength={LIMITS.adTitle} onChange={(e) => update({ title: e.target.value })} placeholder="e.g. Festive chains, from ₹499" className={inputCls} />
              </div>
              <div>
                <label htmlFor={`ad-btn-${i}`} className="mb-1 block text-xs font-medium text-gray-600">Button text</label>
                <input id={`ad-btn-${i}`} value={ad.buttonText || ''} maxLength={LIMITS.adButton} onChange={(e) => update({ buttonText: e.target.value })} placeholder="e.g. Shop now" className={inputCls} />
              </div>
              <div>
                <label htmlFor={`ad-link-${i}`} className="mb-1 block text-xs font-medium text-gray-600">Where a tap goes</label>
                <input id={`ad-link-${i}`} value={ad.link || ''} maxLength={LIMITS.link} onChange={(e) => update({ link: e.target.value })} placeholder="/shop or https://…"
                  aria-invalid={!!problem} aria-describedby={`ad-link-hint-${i}`} className={`${inputCls} ${problem ? 'border-red-300' : ''}`} />
                <p id={`ad-link-hint-${i}`} className={`mt-1 text-[11px] ${problem ? 'text-red-600' : 'text-gray-400'}`}>
                  {problem || 'A page on this site (/shop), or a full link (https://…). Leave empty for a banner that is not clickable.'}
                </p>
              </div>
              <fieldset>
                <legend className="mb-1 text-xs font-medium text-gray-600">Show on these pages</legend>
                <div className="grid gap-1">
                  {PLACEMENTS.map((p) => (
                    <label key={p.value} className="flex min-h-9 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                      <input type="checkbox" checked={has(p.value)} onChange={() => togglePlacement(p.value)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-amber-500" />
                      <span>
                        <span className="font-medium">{p.label}</span>
                        <span className="block text-[11px] text-gray-400">{PLACEMENT_NOTES[p.value]}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {(ad.placements || []).length === 0 && <p className="mt-1 text-[11px] text-amber-700">Not on any page yet — this banner is not shown.</p>}
              </fieldset>
            </div>
          );
        }}
        layoutProps={LAYOUT_PROPS}
        previewConfig={{
          src: '/marketing-preview?section=ads',
          title: 'Advertisement preview',
          message: 'tj-marketing-preview',
          note: 'The banners of the page chosen below, exactly as shoppers see them — nothing is saved until you click Save Settings.',
          itemLabel: 'Ad',
          extra: { placement: previewPage },
          extraControls: picker,
        }}
        copy={{
          noun: 'ad', nouns: 'Advertisements', emoji: '📣', shownWord: 'Shown', addLabel: 'Add ad', max: SECTIONS.ads.maxItems,
          emptyTitle: 'No advertisements yet',
          emptyHint: 'Add a banner and choose the pages it appears on.',
          uploadHint: 'A wide photo (16:9, about 1600×900) works best.',
          footnote: 'A banner needs a photo and at least one page to be shown. Hidden banners keep their photo and pages.',
        }}
      />
    </div>
  );
}

export { AdvertisementsManager };
