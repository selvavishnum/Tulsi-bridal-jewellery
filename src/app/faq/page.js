import Link from 'next/link';
import { getDB } from '@/lib/firebase';
import { absoluteUrl, JsonLd, getSiteSettings, buildBreadcrumbJsonLd } from '@/lib/seo';
import { buildFaqs, buildFaqJsonLd } from '@/lib/faq';
import { getStoreCharges } from '@/lib/storeChargesServer';

/* Re-rendered at most hourly, so answers follow the live shipping / COD
   settings without a deploy. */
export const revalidate = 3600;

const description = 'Answers on shipping times and charges, Cash on Delivery, returns and refunds, materials and jewellery rental at Tulsi Bridal Jewellery.';

export const metadata = {
  title: 'FAQ — Shipping, COD, Returns & Rentals',
  description,
  alternates: { canonical: absoluteUrl('/faq') },
  openGraph: { title: 'FAQ | Tulsi Bridal Jewellery', description, url: absoluteUrl('/faq') },
};

async function loadFaqs() {
  const [settings, charges] = await Promise.all([
    getSiteSettings(),
    (async () => { try { return await getStoreCharges(getDB()); } catch { return null; } })(),
  ]);
  return buildFaqs({ charges, phone: settings.phone || undefined, email: settings.email || undefined });
}

export default async function FaqPage() {
  const faqs = await loadFaqs();
  const groups = [...new Set(faqs.map((f) => f.group))];
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <JsonLd data={buildFaqJsonLd(faqs)} />
      <JsonLd data={buildBreadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'FAQ', path: '/faq' }])} />
      <h1 className="font-serif text-3xl font-bold text-maroon-950 mb-2">Frequently asked questions</h1>
      <p className="text-stone-500 mb-8">{description}</p>
      {groups.map((g) => (
        <section key={g} className="mb-8" aria-labelledby={`faq-${g}`}>
          <h2 id={`faq-${g}`} className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-3">{g}</h2>
          <div className="divide-y divide-stone-200 border-y border-stone-200">
            {faqs.filter((f) => f.group === g).map((f) => (
              <details key={f.q} className="group py-4" open={g === 'Shipping'}>
                <summary className="cursor-pointer font-semibold text-stone-800 list-none flex justify-between gap-4">
                  {f.q}<span className="text-stone-400 group-open:rotate-45 transition-transform" aria-hidden>+</span>
                </summary>
                <p className="mt-2 text-stone-600 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
      <p className="text-sm text-stone-500">
        Still have a question? <Link href="/contact" className="text-maroon-950 font-semibold underline">Contact us</Link> ·{' '}
        <Link href="/refunds" className="text-maroon-950 font-semibold underline">Full return policy</Link>
      </p>
    </main>
  );
}
