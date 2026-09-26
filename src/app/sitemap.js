import { getDB, docToObj } from '@/lib/firebase';
import { SITE_URL } from '@/lib/seoSchema';

/* Rebuilt at most hourly. */
export const revalidate = 3600;

/* Canonical URLs only (no query strings, no trailing slash). Policy pages
   carry no lastModified — a date that changes on every request tells
   crawlers nothing. Listing pages use the latest product change. */
const LISTING_ROUTES = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/shop', changeFrequency: 'daily', priority: 0.9 },
  { path: '/catalog', changeFrequency: 'daily', priority: 0.9 },
  { path: '/rentals', changeFrequency: 'weekly', priority: 0.8 },
];
const INFO_ROUTES = [
  { path: '/faq', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/contact', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/refunds', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/track-order', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
];

export default async function sitemap() {
  let products = [];
  try {
    const snap = await getDB().collection('products').get();
    products = snap.docs.map(docToObj).filter((p) => p.isActive !== false && p.showMe !== false);
  } catch {
    // Firestore unreachable at build time — ship the page routes only.
  }
  const latest = products.reduce((m, p) => (p.updatedAt && p.updatedAt > m ? p.updatedAt : m), '');

  return [
    ...LISTING_ROUTES.map(({ path, changeFrequency, priority }) => ({
      url: `${SITE_URL}${path === '/' ? '' : path}`,
      ...(latest && { lastModified: new Date(latest) }),
      changeFrequency, priority,
    })),
    ...INFO_ROUTES.map(({ path, changeFrequency, priority }) => ({ url: `${SITE_URL}${path}`, changeFrequency, priority })),
    ...products.map((p) => ({
      url: `${SITE_URL}/product/${p.id}`,
      ...(p.updatedAt && { lastModified: new Date(p.updatedAt) }),
      changeFrequency: 'weekly',
      priority: 0.8,
      /* Image sitemap: product photos, for image search and AI shopping answers. */
      images: (p.images || []).filter((u) => typeof u === 'string' && u.startsWith('https://')).slice(0, 5),
    })),
  ];
}
