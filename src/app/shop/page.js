import { Suspense } from 'react';
import ShopContent from './ShopContent';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { absoluteUrl } from '@/lib/seo';
import AdSlot from '@/components/ads/AdSlot';
import { getAdvertisements } from '@/lib/marketingServer';
import { adsForPlacement } from '@/lib/marketing';

const description = 'Shop modern fashion jewellery online — trending chains, necklaces, earrings, anklets and more for everyday and festive wear.';

export const metadata = {
  title: 'Shop',
  description,
  alternates: { canonical: absoluteUrl('/shop') },
  openGraph: { title: 'Shop | Tulsi Fashion Jewellery', description, url: absoluteUrl('/shop') },
};

/* Rebuilt in the background at most every 5 minutes (and at once when the admin saves the settings), so a
   change to the advertisements shows without a deploy; the banners are in the first HTML. */
export const revalidate = 300;

export default async function ShopPage() {
  const ads = adsForPlacement(await getAdvertisements(), 'shop');
  return (
    <>
      <AdSlot placement="shop" ads={ads} priority className="pt-6" />
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
        <ShopContent />
      </Suspense>
    </>
  );
}
