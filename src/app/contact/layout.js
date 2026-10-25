import { absoluteUrl } from '@/lib/seo';

export const metadata = {
  title: 'Contact Us',
  description: 'Contact Tulsi Fashion Jewellery on WhatsApp, phone or email for orders, tracking and returns.',
  alternates: { canonical: absoluteUrl('/contact') },
  openGraph: { title: 'Contact Us | Tulsi Fashion Jewellery', description: 'Contact Tulsi Fashion Jewellery on WhatsApp, phone or email for orders, tracking and returns.', url: absoluteUrl('/contact') },
};

export default function Layout({ children }) {
  return children;
}
