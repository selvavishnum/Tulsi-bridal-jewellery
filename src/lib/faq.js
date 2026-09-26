/* ─────────────────────────────────────────────
   Store FAQ — one source for the visible /faq page, its FAQPage JSON-LD
   and /llms.txt. Every answer states the store's real rules (checkout
   limits, refund page, live shipping/COD settings), so what AI engines
   quote is what customers actually get. Pure module.
   ───────────────────────────────────────────── */
import { normalizeCharges } from './storeCharges.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/**
 * @param {object} p  { charges (store_settings), phone, email }
 * @returns {Array<{ q: string, a: string, group: string }>}
 */
export function buildFaqs({ charges, phone = '+91 76958 68787', email = 'tulsibridaljewellery@gmail.com' } = {}) {
  const c = normalizeCharges(charges);
  const shippingFee = !c.enable_shipping_fee
    ? 'Delivery is free on every order.'
    : c.free_shipping_threshold > 0
      ? `Delivery is free on orders of ${inr(c.free_shipping_threshold)} or more; below that a flat ${inr(c.shipping_fee_amount)} shipping fee applies.`
      : `A flat ${inr(c.shipping_fee_amount)} shipping fee applies to every order.`;
  const codFee = !c.enable_cod_fee
    ? 'There is no extra charge for Cash on Delivery.'
    : c.cod_fee_waive_above
      ? `A ${inr(c.cod_fee_amount)} COD handling fee applies to orders under ${inr(c.cod_fee_waive_above)}.`
      : `A ${inr(c.cod_fee_amount)} COD handling fee applies.`;

  return [
    { group: 'Shipping', q: 'How long does delivery take?', a: `Orders are packed and handed to our courier partners after confirmation, and usually arrive within 2–4 business days of dispatch anywhere in India. You get the tracking number by email and WhatsApp, and can follow it on our Track Order page.` },
    { group: 'Shipping', q: 'How much is shipping?', a: shippingFee },
    { group: 'Shipping', q: 'Do you deliver across India?', a: 'Yes — we ship pan-India through tracked courier partners. Cash on Delivery depends on whether a courier serves your pincode, which the checkout checks for you.' },
    { group: 'Payment', q: 'Do you offer Cash on Delivery (COD)?', a: `Yes, Cash on Delivery is available for orders up to ${inr(20000)} on serviceable pincodes. ${codFee} Larger orders can be paid online.` },
    { group: 'Payment', q: 'Which online payment methods do you accept?', a: 'UPI, credit and debit cards, net banking and wallets through Razorpay’s secure checkout.' },
    { group: 'Returns', q: 'What is your return policy?', a: 'We accept returns within 7 days of delivery if the item arrives damaged or defective, or if a wrong item was delivered. An unboxing video is required for every return claim. Change of mind, minor colour variation from photos, worn or used items and custom orders are not eligible.' },
    { group: 'Returns', q: 'How are refunds paid?', a: 'Approved refunds go back to the original payment method within 5–7 business days. We arrange the return pickup for approved returns.' },
    { group: 'Products', q: 'What materials is your jewellery made from?', a: 'Our collection includes gold-plated, silver-plated, kundan, meenakari and polki pieces, alongside gold and silver designs. Each product page lists its material, finish, weight and stones — please check the listing for the exact piece.' },
    { group: 'Products', q: 'What kind of jewellery do you sell?', a: 'Handcrafted bridal and wedding jewellery: necklaces and chokers, bridal sets, earrings and jhumkas, bangles, maang tikka, nose rings, rings and anklets — including temple and antique-finish designs.' },
    { group: 'Rentals', q: 'Can I rent bridal jewellery instead of buying?', a: 'Yes. Selected pieces are available to rent for your wedding or function. You pick the dates, pay the rental charge plus a refundable security deposit (30% of the item price), and choose delivery or self pickup and return.' },
    { group: 'Contact', q: 'How can I contact Tulsi Bridal Jewellery?', a: `WhatsApp or call ${phone}, or email ${email}. You can also use the contact form on our website.` },
  ];
}

export function buildFaqJsonLd(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
