import { getDB, docToObj } from '@/lib/firebase';
import { SITE_URL, SITE_NAME, getSiteSettings, productSemantics } from '@/lib/seo';
import { buildFaqs } from '@/lib/faq';
import { getStoreCharges } from '@/lib/storeChargesServer';

/* /llms.txt — a plain-Markdown brief of the store for AI answer engines
   (the llmstxt.org convention): who we are, what we sell, the policies
   people ask about, and links to the key pages and products. Built from
   live data, refreshed hourly. */
export const revalidate = 3600;

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

export async function GET() {
  /* Database unreachable (e.g. at build time): publish the store facts
     with default charges and no product list rather than failing. */
  const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
  const [settings, charges, products] = await Promise.all([
    getSiteSettings(),
    safe(() => getStoreCharges(getDB()), null),
    safe(async () => (await getDB().collection('products').get()).docs.map(docToObj).filter((p) => p.isActive !== false && p.showMe !== false), []),
  ]);
  const faqs = buildFaqs({ charges, phone: settings.phone || undefined, email: settings.email || undefined });
  const byCategory = new Map();
  for (const p of products) {
    const k = productSemantics(p).categoryTerms[0];
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k).push(p);
  }

  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_NAME} (tulsijewels.in) is an Indian online store for handcrafted bridal and wedding jewellery — kundan, temple, antique-finish, polki, gold-plated and silver-plated necklaces, chokers, bridal sets, jhumkas, bangles and maang tikka. Pieces can be bought or rented for weddings and functions, with delivery across India and Cash on Delivery.`,
    '',
    '## Key pages',
    `- [Shop all jewellery](${SITE_URL}/shop): full catalogue with prices`,
    `- [Bridal jewellery on rent](${SITE_URL}/rentals): rent sets for a function, refundable deposit`,
    `- [FAQ](${SITE_URL}/faq): shipping, COD, returns, materials, rentals`,
    `- [Return & refund policy](${SITE_URL}/refunds)`,
    `- [Track an order](${SITE_URL}/track-order)`,
    `- [Contact](${SITE_URL}/contact)`,
    '',
    '## Store facts',
    ...faqs.map((f) => `- **${f.q}** ${f.a}`),
    '',
    `## Products (${products.length})`,
  ];
  for (const [cat, list] of [...byCategory.entries()].sort()) {
    lines.push('', `### ${cat[0].toUpperCase()}${cat.slice(1)}`);
    for (const p of list.slice(0, 40)) {
      const price = p.discountPrice || p.price;
      const f = productSemantics(p);
      const tags = [f.material, ...f.styles.filter((s) => s !== 'bridal'), f.rentable && 'available to rent'].filter(Boolean).join(', ');
      lines.push(`- [${p.name}](${SITE_URL}/product/${p.id}): ${inr(price)}${tags ? ` — ${tags}` : ''}${Number(p.stock) > 0 ? '' : ' (out of stock)'}`);
    }
  }
  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
