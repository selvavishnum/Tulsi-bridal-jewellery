import { absoluteUrl } from '@/lib/seo';
import AdSlot from '@/components/ads/AdSlot';
import { getAdvertisements } from '@/lib/marketingServer';
import { adsForPlacement } from '@/lib/marketing';

export const metadata = {
  title: 'Your Cart',
  alternates: { canonical: absoluteUrl('/cart') },
  robots: { index: false, follow: true },
};

/* Rebuilt in the background at most every 5 minutes (and at once when the admin saves the settings), so a
   change to the advertisements shows without a deploy; the banners are in the first HTML. */
export const revalidate = 300;

/* The page itself is a client component; its offers (Admin → Marketing → Website Advertisements) are drawn here, under it, in the server's HTML. */
export default async function CartLayout({ children }) {
  const ads = adsForPlacement(await getAdvertisements(), 'cart');
  return (
    <>
      {children}
      <AdSlot placement="cart" ads={ads} className="py-8" />
    </>
  );
}
