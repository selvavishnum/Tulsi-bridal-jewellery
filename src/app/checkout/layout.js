import { absoluteUrl } from '@/lib/seo';

export const metadata = {
  title: 'Checkout',
  alternates: { canonical: absoluteUrl('/checkout') },
  robots: { index: false, follow: true },
};

export default function CheckoutLayout({ children }) {
  return children;
}
