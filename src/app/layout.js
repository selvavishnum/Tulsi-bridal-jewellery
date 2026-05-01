import './globals.css';
import { Cormorant_Garamond, Inter } from 'next/font/google';
import { Providers } from './providers';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: { default: 'Tulsi Bridal Jewellery', template: '%s | Tulsi Bridal Jewellery' },
  description: 'Exquisite handcrafted bridal jewellery — buy or rent for your special day. Kundan, gold-plated and silver pieces curated for the modern bride.',
  keywords: ['bridal jewellery', 'wedding jewellery', 'kundan set', 'gold jewellery', 'jewellery rental', 'bridal set'],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${inter.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
