import './globals.css';
import { Cormorant_Garamond, Inter } from 'next/font/google';
import Script from 'next/script';
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

const DESCRIPTION = 'Handcrafted bridal jewellery to buy or rent — kundan, temple and antique-finish necklaces, chokers, bridal sets, jhumkas, bangles and maang tikka. Free delivery across India, COD available.';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  category: 'shopping',
  keywords: [
    'bridal jewellery', 'wedding jewellery', 'bridal jewellery on rent', 'jewellery rental', 'rental fashion jewellery',
    'antique jewellery set', 'temple jewellery', 'kundan bridal set', 'bridal choker', 'south indian bridal jewellery',
    'gold-plated jewellery', 'jhumka', 'maang tikka',
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

