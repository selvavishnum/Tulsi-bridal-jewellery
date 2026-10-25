import './globals.css';
import { Cormorant_Garamond, Inter } from 'next/font/google';
import Script from 'next/script';
import { preload } from 'react-dom';
import { Providers } from './providers';
import { SITE_URL, SITE_NAME, JsonLd, buildStoreJsonLd, buildWebSiteJsonLd } from '@/lib/seo';

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

const DESCRIPTION = 'Modern minimalist fashion jewellery — trending chains, necklaces, earrings and anklets for everyday and festive wear. Delivered across India, Cash on Delivery available.';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  category: 'shopping',
  keywords: [
    'fashion jewellery online India', 'trending chains', 'necklaces', 'earrings', 'anklets',
    'daily-wear jewellery', 'casual jewellery', 'festive jewellery', 'anti-tarnish jewellery',
    'minimalist jewellery', 'layered chains', 'gold-plated jewellery',
  ],
  /* No site-wide canonical: every page sets its own. A canonical of "/"
     here was inherited by pages without one, telling Google they were all
     copies of the homepage. */
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION && {
    verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION },
  }),
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: DESCRIPTION,
    url: SITE_URL,
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: DESCRIPTION,
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#8b1a4a',
};

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default async function RootLayout({ children }) {
  /* The ₹ glyph (see globals.css): ~1 KB each, used by the offer bar and the prices —
     fetched with the document instead of after the CSS. */
  for (const file of ['inter-rupee', 'cormorant-rupee']) preload(`/fonts/${file}.woff2`, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  const storeJsonLd = await buildStoreJsonLd();

  return (
    <html lang="en" className={`${cormorant.variable} ${inter.variable}`}>
      <body>
        <JsonLd data={storeJsonLd} />
        <JsonLd data={buildWebSiteJsonLd()} />
        {GA_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">{`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_ID}', { page_path: window.location.pathname });
            `}</Script>
          </>
        )}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

