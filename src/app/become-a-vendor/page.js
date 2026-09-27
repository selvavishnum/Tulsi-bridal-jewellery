import { Noto_Sans_Tamil } from 'next/font/google';
import { absoluteUrl, JsonLd, buildBreadcrumbJsonLd } from '@/lib/seo';
import VendorApplicationForm from './VendorApplicationForm';

const tamil = Noto_Sans_Tamil({ subsets: ['tamil'], weight: ['400', '600', '700'], display: 'swap' });

const description = 'Instagram jewellery sellers: become an official Tulsi Jewels vendor. Your own dashboard, automatic orders and labels, doorstep courier pickup, weekly bank settlement and 0% hidden charges.';

export const metadata = {
  title: 'Become a Vendor — Sell Your Jewellery on Tulsi',
  description,
  alternates: { canonical: absoluteUrl('/become-a-vendor') },
  openGraph: { title: 'Become a Vendor | Tulsi Bridal Jewellery', description, url: absoluteUrl('/become-a-vendor') },
};

const BENEFITS = [
  'தனி வெண்டார் டேஷ்போர்டு (தயாரிப்பு, விலை, ஸ்டாக் நீங்களே மாற்றலாம்)',
  'தானியங்கி ஆர்டர் & லேபிள் பிரிண்ட் வசதி',
  'உங்கள் வேர்ஹவுஸ் / வீட்டிற்கே வந்து பார்சல் எடுக்கும் கொரியர் நெட்வொர்க்',
  'வெளிப்படையான கணக்கு & வாராந்திர நேரடி பேங்க் செட்டில்மென்ட்',
  '0% மறைமுகக் கட்டணங்கள்!',
];

export default function BecomeAVendorPage() {
  return (
    <main className="min-h-screen bg-ivory">
      <JsonLd data={buildBreadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Become a Vendor', path: '/become-a-vendor' }])} />

      <section lang="ta" className={`${tamil.className} bg-luxury-gradient text-white relative overflow-hidden`}>
        <div aria-hidden className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #c9973a 0, #c9973a 1px, transparent 0, transparent 40px)' }} />
        <div className="relative max-w-5xl mx-auto px-4 py-12 md:py-16 grid gap-10 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <p className="text-[11px] tracking-[0.35em] uppercase text-gold-300 font-sans mb-4">Tulsi Jewels · Seller Partner</p>
            <h1 className="text-2xl md:text-4xl font-bold leading-snug text-balance">
              இன்ஸ்டாகிராம் நகை விற்பனையாளர்களா நீங்கள்? உங்கள் பிசினஸை அடுத்த கட்டத்திற்கு கொண்டு செல்லுங்கள்! 💍🚀
            </h1>
            <p className="mt-5 text-white/80 text-[15px] md:text-base leading-relaxed">
              DM-ல் விலை சொல்வதையும், பேமெண்ட் ஸ்கிரீன்ஷாட்டுகளுக்காக காத்திருப்பதையும் நிறுத்துங்கள். துளசி ஜூவல்ஸ் பிளாட்ஃபார்மில் அதிகாரப்பூர்வ Vendor-ஆக இணைந்து உங்கள் நகைகளைத் தமிழ்நாடு முழுவதும் விற்பனை செய்யுங்கள்! 🌟
            </p>
            <a href="#apply" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-6 py-3 font-sans font-semibold text-maroon-950 shadow-gold hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300">
              இப்போதே விண்ணப்பிக்கவும் · Apply now
            </a>
          </div>

          <div className="rounded-2xl bg-white/[0.07] ring-1 ring-white/15 p-6 backdrop-blur-sm">
            <h2 className="font-semibold text-gold-200 mb-4">✨ உங்களுக்குக் கிடைக்கும் வசதிகள்:</h2>
            <ul className="space-y-3 text-[15px] leading-relaxed">
              {BENEFITS.map((b) => (
                <li key={b} className="flex gap-2.5"><span aria-hidden className="text-gold-300">🔹</span><span>{b}</span></li>
              ))}
            </ul>
            <p className="mt-5 rounded-xl bg-gold-400/15 ring-1 ring-gold-300/40 px-4 py-3 text-[15px] leading-relaxed">
              <span className="font-bold text-gold-200">🎁 தொடக்கக்கால சலுகை:</span> முதல் 50 விற்பனையாளர்களுக்கு அடுத்த 3 மாதங்களுக்கு முழுமையான இலவச ஆன்-போர்டிங்!
            </p>
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
