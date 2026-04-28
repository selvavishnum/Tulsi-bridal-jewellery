/* ─────────────────────────────────────────────
   /catalog  — Full jewellery catalog listing
   Exactly matches Swastik's product display:
   category section headings + CatalogProductItem
   ───────────────────────────────────────────── */
import { Suspense } from 'react';
import CatalogContent from './CatalogContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export const metadata = { title: 'Jewellery Catalogue' };

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <CatalogContent />
    </Suspense>
  );
}
