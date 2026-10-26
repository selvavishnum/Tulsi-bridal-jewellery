/* ─────────────────────────────────────────────
   /catalog  — Full jewellery catalogue, filtered by category
   (?category=necklace | earrings | anklet …) — the header's category links
   open it. The grid is the shared ProductCard.
   ───────────────────────────────────────────── */
import { Suspense } from 'react';
import CatalogContent from './CatalogContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { absoluteUrl } from '@/lib/seo';
import AdSlot from '@/components/ads/AdSlot';
import { getAdvertisements } from '@/lib/marketingServer';
import { adsForPlacement } from '@/lib/marketing';

const description = 'Browse the full Tulsi Fashion Jewellery catalogue by category — chains and necklaces, earrings, anklets, bracelets, bangles and rings.';

export const metadata = {
  title: 'Jewellery Catalogue',
  description,
  alternates: { canonical: absoluteUrl('/catalog') },
  openGraph: { title: 'Jewellery Catalogue | Tulsi Fashion Jewellery', description, url: absoluteUrl('/catalog') },
};

/* Rebuilt in the background at most every 5 minutes (and at once when the admin saves the settings), so a
   change to the advertisements shows without a deploy; the banners are in the first HTML. */
export const revalidate = 300;

export default async function CatalogPage() {
  const ads = adsForPlacement(await getAdvertisements(), 'category');
  return (
    <>
      <AdSlot placement="category" ads={ads} priority className="pt-6" />
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
        <CatalogContent />
      </Suspense>
    </>
  );
}
