import { Suspense } from 'react';
import RentalContent from './RentalContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export const metadata = { title: 'Rental Jewellery — Tulsi Bridal' };

export default function RentalsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <RentalContent />
    </Suspense>
  );
}
