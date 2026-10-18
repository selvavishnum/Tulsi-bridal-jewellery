'use client';

/* "Order on WhatsApp": a secondary action under the main buttons — opens a
   chat with the store, prefilled with this piece's name, SKU, price,
   quantity and link (src/lib/whatsappOrder.js). */
import { useSyncExternalStore } from 'react';
import { whatsappOrderUrl } from '@/lib/whatsappOrder';
import { absoluteUrl } from '@/lib/seoSchema';
import WhatsAppIcon from './WhatsAppIcon';

/* The page's origin, read without a hydration mismatch: the server render
   (and hydration) use the canonical site URL, the browser its own origin. */
const noSubscribe = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscribe, () => window.location.origin, () => '');

export default function OrderOnWhatsApp({ phone, product, productId, qty = 1, className = '' }) {
  const origin = useOrigin();
  const path = `/product/${productId}`;
  const href = whatsappOrderUrl({ phone, product, qty, url: origin ? `${origin}${path}` : absoluteUrl(path) });
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center justify-center gap-2 w-full min-h-[44px] px-4 py-2.5 rounded-xl border-2 border-green-600 bg-white text-green-700 font-semibold text-sm hover:bg-green-50 active:bg-green-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600/40 ${className}`}
    >
      <WhatsAppIcon className="w-[18px] h-[18px] flex-shrink-0" />
      Order on WhatsApp
      <span className="sr-only">(opens WhatsApp)</span>
    </a>
  );
}
