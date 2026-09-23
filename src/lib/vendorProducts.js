import { PLATFORM_VENDOR_ID, validateVendorPricing } from './settlement.js';

/**
 * Normalises and validates the marketplace fields of a product about to be
 * saved (`merged` = existing document + incoming changes).
 * @returns {Promise<{ error: string } | { vendorId: string, supplyCost: number }>}
 */
export async function checkProductVendor(db, merged) {
  const vendorId = merged.vendorId ? String(merged.vendorId) : PLATFORM_VENDOR_ID;
  if (vendorId !== PLATFORM_VENDOR_ID) {
    const v = await db.collection('vendors').doc(vendorId).get();
    if (!v.exists) return { error: 'That vendor does not exist.' };
  }
  const error = validateVendorPricing({ ...merged, vendorId });
  if (error) return { error };
  return {
    vendorId,
    /* The platform's own stock has no supply cost to retain from itself. */
    supplyCost: vendorId === PLATFORM_VENDOR_ID ? 0 : Number(merged.supplyCost),
  };
}
