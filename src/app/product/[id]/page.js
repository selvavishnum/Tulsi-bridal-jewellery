import { getDB, docToObj, toPublicProduct } from '@/lib/firebase';
import { absoluteUrl, JsonLd, buildProductJsonLd, buildBreadcrumbJsonLd, describeProduct, productKeywords } from '@/lib/seo';
import { getStoreCharges } from '@/lib/storeChargesServer';

/* Real, published reviews for the Review markup (never invented). */
async function getReviews(id) {
  try {
    const snap = await getDB().collection('reviews').where('productId', '==', id).get();
    return snap.docs.map((d) => d.data()).filter((r) => r.approved !== false)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);
  } catch {
    return [];
  }
}
import ProductDetail from './ProductDetail';

async function getProduct(id) {
  try {
    const db = getDB();
    const doc = await db.collection('products').doc(id).get();
    if (!doc.exists) return null;
    const product = docToObj(doc);
    if (product.isActive === false || product.showMe === false) return null;
    return toPublicProduct(product);
  } catch {
    return null;
  }
}

function titleCase(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const product = await getProduct(id);

  if (!product) {
    return { title: 'Product Not Found', robots: { index: false, follow: false } };
  }

  /* A factual summary built from the product's own category, material,
     style words, colour and occasion — the phrases people type or ask. */
  const description = describeProduct(product).slice(0, 160);
  const image = product.images?.filter(Boolean)?.[0];
  const url = absoluteUrl(`/product/${id}`);

  return {
    title: product.name,
    description,
    keywords: productKeywords(product),
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title: product.name,
      description,
      url,
      images: image ? [{ url: image, width: 1000, height: 1000, alt: product.name }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ProductPage({ params }) {
  const { id } = await params;
  const product = await getProduct(id);
  const loadCharges = async () => { try { return await getStoreCharges(getDB()); } catch { return null; } };
  const [charges, reviews] = product ? await Promise.all([loadCharges(), getReviews(id)]) : [null, []];

  return (
    <>
      {product && (
        <>
          <JsonLd data={buildProductJsonLd(product, id, { charges, reviews })} />
          <JsonLd
            data={buildBreadcrumbJsonLd([
              { name: 'Home', path: '/' },
              { name: 'Shop', path: '/shop' },
              ...(product.category ? [{ name: titleCase(product.category), path: `/catalog?category=${product.category}` }] : []),
              { name: product.name, path: `/product/${id}` },
            ])}
          />
        </>
      )}
      <ProductDetail initialProduct={product} />
    </>
  );
}
