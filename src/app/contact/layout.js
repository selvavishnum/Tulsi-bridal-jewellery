import { absoluteUrl } from '@/lib/seo';

export const metadata = {
  title: 'Contact Us',
  description: 'Contact Tulsi Bridal Jewellery on WhatsApp, phone or email for bridal jewellery orders, rentals, tracking and returns.',
  alternates: { canonical: absoluteUrl('/contact') },
  openGraph: { title: 'Contact Us | Tulsi Bridal Jewellery', description: 'Contact Tulsi Bridal Jewellery on WhatsApp, phone or email for bridal jewellery orders, rentals, tracking and returns.', url: absoluteUrl('/contact') },
};

export default function Layout({ children }) {
  return children;
}
