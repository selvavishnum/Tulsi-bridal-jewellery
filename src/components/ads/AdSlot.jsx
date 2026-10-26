/* ─────────────────────────────────────────────
   One website-advertisement slot: the banner(s) an admin placed on a page
   (Admin → Settings → Marketing → Website Advertisements).

   STUB — the final props are fixed here so the pages can already use it; the
   banner, slider and link markup arrive with the ads storefront work.

   Usage, on a server page / layout (nothing here needs the browser):

     const ads = adsForPlacement(await getAdvertisements(), 'shop');
     <AdSlot placement="shop" ads={ads} />

   Draws nothing when there is no visible ad, so a page without ads is exactly
   the page it was.
   ───────────────────────────────────────────── */

/**
 * @typedef {object} AdSlotProps
 * @property {'home'|'shop'|'category'|'product'|'cart'|'checkout'|'order-success'|'track-order'} placement
 *   which page the slot is on (one of PLACEMENT_VALUES in src/lib/marketing.js)
 * @property {{ layout: { layoutVariant: string, displayMode: string, size: string }, items: object[] }} [ads]
 *   what adsForPlacement(ads, placement) returned: the visible ads of this page, in order, and the
 *   layout. Omitted (or no items) → nothing is drawn.
 * @property {string} [className]  extra classes for the slot's wrapper (spacing around it)
 */

/**
 * @param {AdSlotProps} props
 * @returns {null}
 */
export default function AdSlot() {
  return null;
}

export { AdSlot };
