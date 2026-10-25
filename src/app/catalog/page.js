/* ─────────────────────────────────────────────
   /catalog  — Full jewellery catalogue, filtered by category
   (?category=necklace | earrings | anklet …) — the header's category links
   open it. The grid is the shared ProductCard.
   ───────────────────────────────────────────── */
import { Suspense } from 'react';
import CatalogContent from './CatalogContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { absoluteUrl } from '@/lib/seo';

const description = 'Browse the full Tulsi Fashion Jewellery catalogue by category — chains and necklaces, earrings, anklets, bracelets, bangles and rings.';

export const metadata = {
  title: 'Jewellery Catalogue',
  description,
  alternates: { canonical: absoluteUrl('/catalog') },
  openGraph: { title: 'Jewellery Catalogue | Tulsi Fashion Jewellery', description, url: absoluteUrl('/catalog') },
};

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <CatalogContent />
    </Suspense>
  );
}
