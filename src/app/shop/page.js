import { Suspense } from 'react';
import ShopContent from './ShopContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export const metadata = { title: 'Shop' };

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <ShopContent />
    </Suspense>
  );
}
