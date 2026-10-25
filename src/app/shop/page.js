import { Suspense } from 'react';
import ShopContent from './ShopContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { absoluteUrl } from '@/lib/seo';

const description = 'Shop modern fashion jewellery online — trending chains, necklaces, earrings, anklets and more for everyday and festive wear.';

export const metadata = {
  title: 'Shop',
  description,
  alternates: { canonical: absoluteUrl('/shop') },
  openGraph: { title: 'Shop | Tulsi Fashion Jewellery', description, url: absoluteUrl('/shop') },
};

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <ShopContent />
    </Suspense>
  );
}
