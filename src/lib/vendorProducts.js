import { PLATFORM_VENDOR_ID, validateVendorPricing, marginFor, vendorShippingOf, MARGIN_MODES } from './settlement.js';

/**
 * Normalises and validates the marketplace fields of a product about to be
 * saved (`merged` = existing document + incoming changes).
 * @returns {Promise<{ error: string } | { vendorId, supplyCost, marginMode, marginPercent, vendorShipping }>}
 *   supplyCost is the per-piece margin in rupees — for a percentage margin,
 *   worked out from the current selling price (and recomputed on every
 *   save, so it follows price changes).
 */
export async function checkProductVendor(db, merged) {
  const vendorId = merged.vendorId ? String(merged.vendorId) : PLATFORM_VENDOR_ID;
  /* The platform's own stock has no margin to retain from itself. */
  if (vendorId === PLATFORM_VENDOR_ID) {
    return { vendorId, supplyCost: 0, marginMode: 'fixed', marginPercent: 0, vendorShipping: null };
  }
  const v = await db.collection('vendors').doc(vendorId).get();
  if (!v.exists) return { error: 'That vendor does not exist.' };

  const marginMode = MARGIN_MODES.includes(merged.marginMode) ? merged.marginMode : 'fixed';
  const normalized = {
    ...merged,
    vendorId,
    marginMode,
    marginPercent: marginMode === 'percent' ? Number(merged.marginPercent) : 0,
    vendorShipping: vendorShippingOf(merged) ?? (merged.vendorShipping === '' || merged.vendorShipping == null ? null : merged.vendorShipping),
  };
  const error = validateVendorPricing(normalized);
  if (error) return { error };
  return {
    vendorId,
    marginMode,
    marginPercent: normalized.marginPercent,
    supplyCost: marginFor(normalized),
    vendorShipping: vendorShippingOf(normalized),
  };
}
