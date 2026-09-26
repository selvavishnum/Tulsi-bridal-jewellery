/* ─────────────────────────────────────────────
   Structured-data builders (schema.org JSON-LD) and product vocabulary.
   Pure module — no '@/…' imports, no JSX — so it's unit-testable; seo.js
   re-exports it alongside the JsonLd component and data loaders.
   ───────────────────────────────────────────── */
function stripTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export const SITE_URL = stripTrailingSlash(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tulsijewels.in');
export const SITE_NAME = 'Tulsi Bridal Jewellery';

export function absoluteUrl(path = '/') {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}


/* ── Store identity ──
   One entity for search and AI engines: a JewelryStore (a LocalBusiness,
   so also an Organization), with the details the admin keeps in Settings →
   Business. Geo-coordinates and the street address are included only when
   the admin has entered them — never guessed. */
const STORE_ID = () => `${SITE_URL}/#store`;

export function buildStoreJsonLd(settings) {
  const s = settings || {};
  const sameAs = [s.instagram, s.facebook, s.youtube, s.twitter, s.linkedin].filter(Boolean);
  const phoneDigits = String(s.whatsapp || s.phone || '917695868787').replace(/\D/g, '');
  const telephone = `+${phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits}`;
  const lat = Number(s.geoLat);
  const lng = Number(s.geoLng);
  const hasGeo = s.geoLat !== undefined && s.geoLat !== '' && Number.isFinite(lat) && Number.isFinite(lng);
  const address = s.streetAddress || s.addressLocality || s.postalCode
    ? {
      '@type': 'PostalAddress',
      ...(s.streetAddress && { streetAddress: s.streetAddress }),
      ...(s.addressLocality && { addressLocality: s.addressLocality }),
      ...(s.addressRegion && { addressRegion: s.addressRegion }),
      ...(s.postalCode && { postalCode: s.postalCode }),
      addressCountry: 'IN',
    }
    : null;

  return {
    '@context': 'https://schema.org',
    '@type': ['JewelryStore', 'Store'],
    '@id': STORE_ID(),
    name: s.businessName || SITE_NAME,
    legalName: s.legalName || s.businessName || SITE_NAME,
    alternateName: ['Tulsi Jewels', 'Tulsi Bridal'],
    description: s.seoDescription || 'Handcrafted bridal and wedding jewellery to buy or rent — kundan, temple, antique-finish, gold-plated and silver-plated necklaces, chokers, bridal sets, jhumkas, bangles and maang tikka, delivered across India.',
    url: SITE_URL,
    logo: absoluteUrl('/apple-icon'),
    image: absoluteUrl('/opengraph-image'),
    telephone,
    ...(s.email && { email: s.email }),
    ...(address && { address }),
    ...(hasGeo && { geo: { '@type': 'GeoCoordinates', latitude: lat, longitude: lng } }),
    priceRange: s.priceRange || '₹₹',
    currenciesAccepted: 'INR',
    paymentAccepted: 'Cash on Delivery, UPI, Credit Card, Debit Card, Net Banking',
    areaServed: { '@type': 'Country', name: 'India' },
    knowsAbout: ['Bridal jewellery', 'Wedding jewellery', 'Jewellery rental', 'Kundan jewellery', 'Temple jewellery', 'Antique jewellery', 'Polki jewellery', 'Gold-plated jewellery'],
    ...(s.openTime && s.closeTime && {
      openingHoursSpecification: [{
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: s.openTime, closes: s.closeTime,
      }],
    }),
    ...(sameAs.length > 0 && { sameAs }),
    contactPoint: [{
      '@type': 'ContactPoint',
      telephone,
      contactType: 'customer service',
      areaServed: 'IN',
      availableLanguage: ['English', 'Tamil'],
    }],
  };
}

/* Site-wide search, so engines can link straight into the shop search. */
export function buildWebSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    inLanguage: 'en-IN',
    publisher: { '@id': STORE_ID() },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/shop?search={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

/* ── Product vocabulary ──
   Natural-language names shoppers (and AI answers) use for each category
   and material. Only synonyms of what the product actually is — the
   description never claims a finish or stone the listing doesn't have. */
const CATEGORY_TERMS = {
  necklace: ['bridal necklace', 'haaram'],
  earrings: ['earrings'],
  bangles: ['bangles'],
  bracelet: ['bracelet'],
  ring: ['ring'],
  'maang-tikka': ['maang tikka', 'nethi chutti'],
  'nose-ring': ['nose ring', 'nath'],
  anklet: ['anklet', 'payal / kolusu'],
  set: ['bridal jewellery set', 'necklace set'],
  other: ['jewellery'],
};
const MATERIAL_TERMS = {
  gold: 'gold', silver: 'silver', 'gold-plated': 'gold-plated', 'silver-plated': 'silver-plated',
  kundan: 'kundan', meenakari: 'meenakari', polki: 'polki',
};
/* Style words taken from the product's own name / tags. */
const STYLE_WORDS = ['temple', 'antique', 'matte', 'choker', 'jhumka', 'lightweight', 'oxidised', 'oxidized', 'american diamond', 'ad stone', 'pearl', 'emerald', 'ruby', 'kemp', 'guttapusalu', 'long haram', 'mango mala', 'bridal'];

/** Semantic facts about a product, from its own fields only. */
export function productSemantics(product) {
  const text = [product.name, ...(product.tags || []), product.stoneType, product.shortDescription].filter(Boolean).join(' ').toLowerCase();
  const styles = STYLE_WORDS.filter((w) => text.includes(w));
  const category = CATEGORY_TERMS[product.category] || CATEGORY_TERMS.other;
  const material = MATERIAL_TERMS[product.material] || null;
  return { styles, categoryTerms: category, material, occasion: product.occasion || null, color: product.color || null, rentable: !!product.isAvailableForRent };
}

/** A factual, natural-language summary (meta description / JSON-LD fallback). */
export function describeProduct(product) {
  const f = productSemantics(product);
  const kind = [...f.styles.filter((w) => w !== 'bridal'), f.material, f.categoryTerms[0]].filter(Boolean).join(' ');
  const parts = [`${product.name} — ${kind || 'bridal jewellery'} by ${SITE_NAME}`];
  const details = [
    f.color && `${f.color} colour`,
    product.stoneType && `${product.stoneType} stones`,
    product.weight && `${product.weight}${/^\d+(\.\d+)?$/.test(String(product.weight)) ? ' g' : ''}`,
    f.occasion && `for ${f.occasion}`,
  ].filter(Boolean);
  if (details.length) parts.push(details.join(', '));
  parts.push(f.rentable ? 'Buy or rent, delivered across India.' : 'Handcrafted, delivered across India.');
  return parts.join('. ').replace(/\.\./g, '.');
}

/** Keywords for metadata, from the same facts. */
export function productKeywords(product) {
  const f = productSemantics(product);
  return [...new Set([
    ...f.categoryTerms, ...f.styles,
    f.material && `${f.material} jewellery`,
    f.rentable && 'jewellery on rent', f.rentable && 'bridal jewellery rental',
    'bridal jewellery', 'wedding jewellery',
  ].filter(Boolean))];
}

/**
 * Product JSON-LD: offers (buy, and rent where offered), shipping and
 * returns from the live store settings, rating and real reviews.
 * @param {object} opts  { charges, reviews }
 */
export function buildProductJsonLd(product, id, { charges = null, reviews = [] } = {}) {
  const displayPrice = product.discountPrice || product.price;
  const images = (product.images || []).filter(Boolean);
  const url = absoluteUrl(`/product/${id}`);
  const inStock = Number(product.stock) > 0;
  const f = productSemantics(product);
  const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const shippingFee = charges
    ? (!charges.enable_shipping_fee || (charges.free_shipping_threshold > 0 && displayPrice >= charges.free_shipping_threshold) ? 0 : charges.shipping_fee_amount)
    : null;

  const offers = [{
    '@type': 'Offer',
    url,
    priceCurrency: 'INR',
    price: String(displayPrice),
    priceValidUntil: nextYear,
    availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition',
    seller: { '@id': STORE_ID() },
    ...(shippingFee !== null && {
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: String(shippingFee), currency: 'INR' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'IN' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 4, unitCode: 'DAY' },
        },
      },
    }),
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'IN',
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 7,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/FreeReturn',
      merchantReturnLink: absoluteUrl('/refunds'),
    },
  }];
  if (f.rentable && Number(product.rentalPrice) > 0) {
    offers.push({
      '@type': 'Offer',
      url: absoluteUrl(`/rental-booking/${id}`),
      name: 'Rent for your function',
      businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
      priceCurrency: 'INR',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: String(product.rentalPrice), priceCurrency: 'INR', unitCode: 'DAY', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'DAY' } },
      availability: Number(product.rentalStock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@id': STORE_ID() },
    });
  }

  const additionalProperty = [
    product.purity && { name: 'Purity', value: product.purity },
    product.weight && { name: 'Weight', value: String(product.weight) },
    product.stoneType && { name: 'Stones', value: product.stoneType },
    product.metalType && { name: 'Metal', value: product.metalType },
    f.occasion && { name: 'Occasion', value: f.occasion },
  ].filter(Boolean).map((p) => ({ '@type': 'PropertyValue', ...p }));

  const realReviews = (reviews || []).filter((r) => r && r.comment && r.rating).slice(0, 5);

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    url,
    name: product.name,
    ...(images.length > 0 && { image: images }),
    description: product.description && product.description.length > 60 ? product.description : describeProduct(product),
    sku: product.sku || id,
    brand: { '@type': 'Brand', name: SITE_NAME },
    category: f.categoryTerms[0],
    ...(f.material && { material: f.material }),
    ...(f.color && { color: f.color }),
    keywords: productKeywords(product).join(', '),
    ...(additionalProperty.length && { additionalProperty }),
    offers: offers.length === 1 ? offers[0] : offers,
    ...(product.ratings?.count > 0 && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: String(product.ratings.average),
        reviewCount: String(product.ratings.count),
        bestRating: '5',
      },
    }),
    ...(realReviews.length && {
      review: realReviews.map((r) => ({
        '@type': 'Review',
        reviewRating: { '@type': 'Rating', ratingValue: String(r.rating), bestRating: '5' },
        author: { '@type': 'Person', name: String(r.reviewerName || 'Customer').split(' ')[0] },
        reviewBody: String(r.comment).slice(0, 500),
        ...(r.createdAt && { datePublished: String(r.createdAt).slice(0, 10) }),
      })),
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
