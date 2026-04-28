import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: { default: 'Tulsi Bridal Jewellery', template: '%s | Tulsi Bridal Jewellery' },
  description: 'Exquisite bridal jewellery — buy or rent for your special day. Handcrafted kundan, gold-plated and silver pieces.',
  keywords: ['bridal jewellery', 'wedding jewellery', 'kundan set', 'gold jewellery', 'jewellery rental'],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
