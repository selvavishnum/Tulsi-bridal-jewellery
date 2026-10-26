'use client';

/* ─────────────────────────────────────────────
   Admin → Settings → Marketing → Website Advertisements: the editor for the
   banners shown on the shop, category, product, cart, checkout, order and
   home pages.

   PLACEHOLDER — the final props are fixed here so the settings page can
   already wire it; the editor itself arrives with the ads manager work.

   It edits the page's draft, not the server: the settings page keeps `value`
   in state and saves it with "Save Settings" (POST /api/admin/settings,
   key `advertisements`).
   ───────────────────────────────────────────── */

/**
 * @typedef {object} Advertisements
 * @property {{ layoutVariant: string, displayMode: string, size: string }} layout
 * @property {{ id: string, isActive: boolean, image: string, focus: object, link: string,
 *   title: string, buttonText: string, placements: string[] }[]} items
 *   (the shape normalizeAdvertisements() in src/lib/marketing.js returns)
 */

/**
 * @param {{ value: Advertisements, onChange: (next: Advertisements) => void }} props
 *   value: the current draft, normalized; onChange: called with the whole new value (never mutated in place)
 */
export default function AdvertisementsManager({ value, onChange }) {
  const count = Array.isArray(value?.items) ? value.items.length : 0;
  return (
    <div data-ads-manager="placeholder" data-editable={typeof onChange === 'function'} className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
      Website advertisements: {count} {count === 1 ? 'banner' : 'banners'}. The editor is coming next.
    </div>
  );
}

export { AdvertisementsManager };
