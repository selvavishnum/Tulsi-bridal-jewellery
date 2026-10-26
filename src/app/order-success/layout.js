/* Private / transactional page — kept out of search results. */
import AdSlot from '@/components/ads/AdSlot';
import { getAdvertisements } from '@/lib/marketingServer';
import { adsForPlacement } from '@/lib/marketing';

export const metadata = { title: 'Order placed', robots: { index: false, follow: false } };

/* Rebuilt in the background at most every 5 minutes (and at once when the admin saves the settings), so a
   change to the advertisements shows without a deploy; the banners are in the first HTML. */
export const revalidate = 300;

/* The page itself is a client component; its offers (Admin → Marketing → Website Advertisements) are drawn here, under it, in the server's HTML. */
export default async function Layout({ children }) {
  const ads = adsForPlacement(await getAdvertisements(), 'order-success');
  return (
    <>
      {children}
      <AdSlot placement="order-success" ads={ads} className="py-8" />
    </>
  );
}
