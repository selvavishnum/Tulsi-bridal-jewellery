import { Suspense, cache } from 'react';
import { getDB, docToObj, toPublicProduct } from '@/lib/firebase';
import { absoluteUrl, JsonLd, buildProductJsonLd, buildBreadcrumbJsonLd, describeProduct, productKeywords } from '@/lib/seo';
import { getStoreCharges } from '@/lib/storeChargesServer';
import { cldUrl } from '@/lib/cloudinaryImage';

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

/* cache(): generateMetadata and the page both ask for the product on the
   same request; React hands the second caller the first one's read, so a
   product page costs one Firestore round trip before it can start streaming,
   not two. */
const getProduct = cache(async (id) => {
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
});

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
  /* The picture a link preview shows (WhatsApp, Facebook, X). The stored
     photo is a full-resolution master of several MB, which many of those
     crawlers give up on — so they get a 1200px JPEG instead (JPEG, not AVIF:
     not every crawler decodes the newer formats). */
  const shareImage = image ? cldUrl(image, { format: 'jpg', quality: 'good', width: 1200, progressive: true }) : undefined;
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
      images: shareImage ? [{ url: shareImage, width: 1200, alt: product.name }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
      description,
      images: shareImage ? [shareImage] : undefined,
    },
  };
}

/* The product's structured data (JSON-LD) is never painted, but it needs two
   more Firestore reads — the reviews and the store's charges. Kept in its own
   async component under <Suspense>, so the page the shopper sees (and its LCP
   photo, which is discovered in this HTML) streams as soon as the product is
   read instead of waiting for them. Search engines lose nothing: they are
   served the whole response, script tag included. */
async function ProductStructuredData({ id, product }) {
  const loadCharges = async () => { try { return await getStoreCharges(getDB()); } catch { return null; } };
  const [charges, reviews] = await Promise.all([loadCharges(), getReviews(id)]);
  return <JsonLd data={buildProductJsonLd(product, id, { charges, reviews })} />;
}

export default async function ProductPage({ params }) {
  const { id } = await params;
  const product = await getProduct(id);

  return (
    <>
      {product && (
        <>
          <Suspense fallback={null}>
            <ProductStructuredData id={id} product={product} />
          </Suspense>
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
