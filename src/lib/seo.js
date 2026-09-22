/* ─────────────────────────────────────────────
   SEO helpers — canonical URL base, JSON-LD builders
   ───────────────────────────────────────────── */
import { getDB, docToObj } from '@/lib/firebase';

function stripTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export const SITE_URL = stripTrailingSlash(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tulsijewels.in');
export const SITE_NAME = 'Tulsi Bridal Jewellery';

export function absoluteUrl(path = '/') {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/* dangerouslySetInnerHTML drops this straight into the HTML stream, so a
   product name/description containing "</script>" could otherwise break
   out of the JSON-LD block — escape the characters that matter for that.
   Uses .split/.join (not a regex literal) since a JS file that also
   contains JSX can misparse a regex starting with "<" as a JSX tag. */
function safeJsonLdString(data) {
  return JSON.stringify(data)
    .split('<').join('\\u003c')
    .split(' ').join('\\u2028')
    .split(' ').join('\\u2029');
}

export function JsonLd({ data }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdString(data) }}
    />
  );
}

export async function getSiteSettings() {
  try {
    const db = getDB();
    const doc = await db.collection('settings').doc('site').get();
    return doc.exists ? docToObj(doc) : {};
  } catch {
    return {};
  }
}

export async function buildOrganizationJsonLd() {
  const settings = await getSiteSettings();
  const sameAs = [settings.instagram, settings.facebook, settings.youtube].filter(Boolean);
  const phoneDigits = (settings.whatsapp || '917695868787').replace(/\D/g, '');

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl('/apple-icon'),
    ...(sameAs.length > 0 && { sameAs }),
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: `+${phoneDigits}`,
      contactType: 'customer service',
      areaServed: 'IN',
      availableLanguage: ['en', 'ta'],
    },
  };
}

export function buildProductJsonLd(product, id) {
  const displayPrice = product.discountPrice || product.price;
  const images = (product.images || []).filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    ...(images.length > 0 && { image: images }),
    description: product.description || `${product.name} — handcrafted bridal jewellery from ${SITE_NAME}.`,
    sku: product.sku || id,
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers: {
      '@type': 'Offer',
      url: absoluteUrl(`/product/${id}`),
      priceCurrency: 'INR',
      price: String(displayPrice),
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
    ...(product.ratings?.count > 0 && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: String(product.ratings.average),
        reviewCount: String(product.ratings.count),
      },
    }),
  };
}

export function buildBreadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}
