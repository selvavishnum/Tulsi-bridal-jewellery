import { getDB, docToObj, toPublicProduct } from '@/lib/firebase';
import { absoluteUrl, JsonLd, buildProductJsonLd, buildBreadcrumbJsonLd } from '@/lib/seo';
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

  const description = (product.description
    ? product.description
    : `${product.name} — handcrafted bridal jewellery from Tulsi Bridal Jewellery.`
  ).slice(0, 160);
  const image = product.images?.filter(Boolean)?.[0];
  const url = absoluteUrl(`/product/${id}`);

  return {
    title: product.name,
    description,
    alternates: { canonical: url },
    openGraph: {
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

  return (
    <>
      {product && (
        <>
          <JsonLd data={buildProductJsonLd(product, id)} />
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
      <ProductDetail />
    </>
  );
}
