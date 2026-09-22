import { absoluteUrl } from '@/lib/seo';

export const metadata = {
  title: 'Your Cart',
  alternates: { canonical: absoluteUrl('/cart') },
  robots: { index: false, follow: true },
};

export default function CartLayout({ children }) {
  return children;
}
