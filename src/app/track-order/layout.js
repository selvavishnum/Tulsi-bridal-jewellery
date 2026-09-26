import { absoluteUrl } from '@/lib/seo';

export const metadata = {
  title: 'Track Your Order',
  description: 'Track your Tulsi Bridal Jewellery order with your order number and email — live courier status for every parcel.',
  alternates: { canonical: absoluteUrl('/track-order') },
  openGraph: { title: 'Track Your Order | Tulsi Bridal Jewellery', description: 'Track your Tulsi Bridal Jewellery order with your order number and email — live courier status for every parcel.', url: absoluteUrl('/track-order') },
};

export default function Layout({ children }) {
  return children;
}
