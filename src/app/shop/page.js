import { Suspense } from 'react';
import ShopContent from './ShopContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { absoluteUrl } from '@/lib/seo';

const description = 'Shop handcrafted bridal jewellery — necklaces, earrings, bangles, rings and more. Kundan, gold-plated and silver pieces for the modern bride.';

export const metadata = {
  title: 'Shop',
  description,
  alternates: { canonical: absoluteUrl('/shop') },
  openGraph: { title: 'Shop | Tulsi Bridal Jewellery', description, url: absoluteUrl('/shop') },
};

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <ShopContent />
    </Suspense>
  );
}
