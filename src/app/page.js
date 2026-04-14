/* ─────────────────────────────────────────────────────────────────
   Homepage — Swastik-inspired catalog layout
   Sections (top → bottom):
   1. CatalogHero   — white, crown, brand name
   2. WelcomeSection — dark velvet, split layout
   3. OrderingProcess — cream, split layout
   4. TrendingGrid   — 4-col product grid
   ────────────────────────────────────────────────────────────── */

import CatalogHero from '@/components/catalog/CatalogHero';
import WelcomeSection from '@/components/catalog/WelcomeSection';
import OrderingProcess from '@/components/catalog/OrderingProcess';
import TrendingGrid from '@/components/catalog/TrendingGrid';
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <CatalogHero />
      <WelcomeSection />
      <OrderingProcess />
      <TrendingGrid />

      {/* Quick-enquiry CTA strip */}
      <div className="bg-velvet-800 py-6 text-center px-4">
        <p className="text-white text-sm tracking-wider mb-3">
          Browse our full collection &amp; enquire for rental pricing
        </p>
        <div className="flex justify-center gap-3 flex-wrap">
          <Link
            href="/catalog"
            className="px-7 py-2.5 bg-gold-600 text-white text-xs font-bold tracking-catalog uppercase hover:bg-gold-700 transition"
          >
            View Catalogue
          </Link>
          <a
            href="https://wa.me/919876543210?text=Hi,%20I%27m%20interested%20in%20your%20bridal%20jewellery%20collection."
            target="_blank"
            rel="noopener noreferrer"
            className="px-7 py-2.5 border border-white text-white text-xs font-bold tracking-catalog uppercase hover:bg-white hover:text-velvet-800 transition"
          >
            WhatsApp Us
          </a>
        </div>
      </div>
    </div>
  );
}
