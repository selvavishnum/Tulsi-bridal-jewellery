import { absoluteUrl } from '@/lib/seo';
import AdSlot from '@/components/ads/AdSlot';
import { getAdvertisements } from '@/lib/marketingServer';
import { adsForPlacement } from '@/lib/marketing';

export const metadata = {
  title: 'Track Your Order',
  description: 'Track your Tulsi Fashion Jewellery order with your order number and email — live courier status for every parcel.',
  alternates: { canonical: absoluteUrl('/track-order') },
  openGraph: { title: 'Track Your Order | Tulsi Fashion Jewellery', description: 'Track your Tulsi Fashion Jewellery order with your order number and email — live courier status for every parcel.', url: absoluteUrl('/track-order') },
};

/* Rebuilt in the background at most every 5 minutes (and at once when the admin saves the settings), so a
   change to the advertisements shows without a deploy; the banners are in the first HTML. */
export const revalidate = 300;

/* The page itself is a client component; its offers (Admin → Marketing → Website Advertisements) are drawn here, under it, in the server's HTML. */
export default async function Layout({ children }) {
  const ads = adsForPlacement(await getAdvertisements(), 'track-order');
  return (
    <>
      {children}
      <AdSlot placement="track-order" ads={ads} className="py-8" />
    </>
  );
}
