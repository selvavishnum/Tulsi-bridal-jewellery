import { Noto_Sans_Tamil } from 'next/font/google';
import { absoluteUrl, JsonLd, buildBreadcrumbJsonLd } from '@/lib/seo';
import VendorApplicationForm from './VendorApplicationForm';

const tamil = Noto_Sans_Tamil({ subsets: ['tamil'], weight: ['400', '600', '700'], display: 'swap' });

const description = 'Instagram jewellery sellers: become an official Tulsi Jewels vendor. Your own dashboard, automatic orders and labels, doorstep courier pickup, weekly bank settlement — lifetime free with 0% platform fee and zero commission.';

export const metadata = {
  title: 'Become a Vendor — Sell Your Jewellery on Tulsi',
  description,
  alternates: { canonical: absoluteUrl('/become-a-vendor') },
  openGraph: { title: 'Become a Vendor | Tulsi Bridal Jewellery', description, url: absoluteUrl('/become-a-vendor') },
};

const BENEFITS = [
  'Your own vendor dashboard — update products, prices and stock yourself',
  'Automatic orders and one-tap shipping-label printing',
  'Courier network that picks up parcels from your warehouse or home',
  'Chat with customers right from your dashboard',
  'Transparent accounts and weekly direct bank settlement',
];

export default function BecomeAVendorPage() {
  return (
    <main className="min-h-screen bg-ivory">
      <JsonLd data={buildBreadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Become a Vendor', path: '/become-a-vendor' }])} />

      <section className="bg-luxury-gradient text-white relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #c9973a 0, #c9973a 1px, transparent 0, transparent 40px)' }} />
        <div className="relative max-w-5xl mx-auto px-4 py-12 md:py-16 grid gap-10 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <p className="text-[11px] tracking-[0.35em] uppercase text-gold-300 mb-4">Tulsi Jewels · Seller Partner</p>
            <h1 className="font-serif text-3xl md:text-5xl font-bold leading-tight text-balance">
              Selling jewellery on Instagram? Take your business to the next level! 💍🚀
            </h1>
            <p className="mt-5 text-white/80 text-[15px] md:text-base leading-relaxed">
              Stop quoting prices in DMs and waiting for payment screenshots. Join Tulsi Jewels as an official vendor and sell your jewellery to customers across Tamil Nadu and India! 🌟
            </p>
            <a href="#apply" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-6 py-3 font-semibold text-maroon-950 shadow-gold hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300">
              Apply now — it&apos;s free
            </a>
          </div>

          <div className="rounded-2xl bg-white/[0.07] ring-1 ring-white/15 p-6 backdrop-blur-sm">
            <h2 className="font-semibold text-gold-200 mb-4">✨ What you get</h2>
            <ul className="space-y-3 text-[15px] leading-relaxed">
              {BENEFITS.map((b) => (
                <li key={b} className="flex gap-2.5"><span aria-hidden className="text-gold-300">🔹</span><span>{b}</span></li>
              ))}
            </ul>
            <div className="mt-5 rounded-xl bg-gold-400/15 ring-1 ring-gold-300/40 px-4 py-3">
              <p className="font-bold text-gold-200">🎁 Lifetime free</p>
              <p className="mt-1 text-[15px] leading-relaxed">0% platform fee · Zero commission · No hidden charges — ever.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="apply" className="max-w-3xl mx-auto px-4 py-10 md:py-14 scroll-mt-20">
        <h2 className="font-serif text-3xl font-bold text-maroon-950">Seller application</h2>
        <p className="mt-1 mb-6 text-sm text-stone-500">Four short steps, about 5 minutes. Keep your GST / Enrolment ID and bank details handy.</p>
        <VendorApplicationForm tamilClass={tamil.className} />
      </section>
    </main>
  );
}
