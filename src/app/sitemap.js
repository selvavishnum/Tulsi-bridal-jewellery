import { getDB, docToObj } from '@/lib/firebase';
import { SITE_URL } from '@/lib/seo';

const STATIC_ROUTES = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/shop', changeFrequency: 'daily', priority: 0.9 },
  { path: '/catalog', changeFrequency: 'daily', priority: 0.9 },
  { path: '/rentals', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/contact', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/track-order', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/refunds', changeFrequency: 'yearly', priority: 0.2 },
];

export default async function sitemap() {
  const staticEntries = STATIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));

  let productEntries = [];
  try {
    const db = getDB();
    const snap = await db.collection('products').get();
    productEntries = snap.docs
      .map(docToObj)
      .filter((p) => p.isActive !== false && p.showMe !== false)
      .map((p) => ({
        url: `${SITE_URL}/product/${p.id}`,
        lastModified: p.updatedAt ? new Date(p.updatedAt) : new Date(),
        changeFrequency: 'weekly',
        priority: 0.8,
      }));
  } catch {
    // Firestore unreachable at build time — ship the static routes only
    // rather than failing the whole sitemap.
  }

  return [...staticEntries, ...productEntries];
}
