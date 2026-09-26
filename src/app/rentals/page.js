import { absoluteUrl } from '@/lib/seo';
import { Suspense } from 'react';
import RentalContent from './RentalContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const rentDescription = 'Rent bridal jewellery for your wedding or function — kundan, temple and antique sets, chokers and maang tikka on rent at a fraction of the price, with a refundable deposit and delivery across India.';

export const metadata = {
  title: 'Bridal Jewellery on Rent',
  description: rentDescription,
  keywords: ['bridal jewellery on rent', 'jewellery rental', 'rental fashion jewellery', 'wedding jewellery rent', 'antique jewellery set on rent'],
  alternates: { canonical: absoluteUrl('/rentals') },
  openGraph: { title: 'Bridal Jewellery on Rent | Tulsi Bridal Jewellery', description: rentDescription, url: absoluteUrl('/rentals') },
};

export default function RentalsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <RentalContent />
    </Suspense>
  );
}
