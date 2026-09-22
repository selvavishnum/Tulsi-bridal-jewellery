/* ─────────────────────────────────────────────
   /catalog  — Full jewellery catalog listing
   Exactly matches Swastik's product display:
   category section headings + CatalogProductItem
   ───────────────────────────────────────────── */
import { Suspense } from 'react';
import CatalogContent from './CatalogContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { absoluteUrl } from '@/lib/seo';

const description = 'Browse the full Tulsi Bridal Jewellery catalogue by category — necklaces, earrings, bangles, rings, maang tikkas and bridal sets.';

export const metadata = {
  title: 'Jewellery Catalogue',
  description,
  alternates: { canonical: absoluteUrl('/catalog') },
  openGraph: { title: 'Jewellery Catalogue | Tulsi Bridal Jewellery', description, url: absoluteUrl('/catalog') },
};

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <CatalogContent />
    </Suspense>
  );
}
