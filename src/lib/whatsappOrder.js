/* "Order on WhatsApp": a wa.me link prefilled with the piece the shopper
   is looking at. Pure module. */

export const DEFAULT_WHATSAPP = '917695868787';

/** Digits only, with India's 91 prefix for a 10-digit mobile number.
 *  wa.me needs the international form, so the result never starts with 0:
 *  a "00" dialling prefix is dropped, anything else unusable → fallback. */
export function whatsappNumber(raw, fallback = DEFAULT_WHATSAPP) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  if (/^[1-9]\d{10,14}$/.test(d)) return d;
  return fallback;
}

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/**
 * @param {{ phone: string, product: { name: string, sku?: string, price?: number, discountPrice?: number }, qty?: number, url?: string }} o
 */
export function whatsappOrderUrl({ phone, product, qty = 1, url = '' }) {
  const price = Number(product?.discountPrice) || Number(product?.price) || 0;
  const lines = [
    "Hi Tulsi Jewels! I'd like to order:",
    `*${String(product?.name || 'this piece').slice(0, 120)}*`,
    product?.sku ? `SKU: ${String(product.sku).slice(0, 40)}` : null,
    price ? `Price: ${rupees(price)}` : null,
    qty > 1 ? `Quantity: ${qty}` : null,
    url ? String(url).slice(0, 300) : null,
  ].filter(Boolean);
  return `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(lines.join('\n'))}`;
}
