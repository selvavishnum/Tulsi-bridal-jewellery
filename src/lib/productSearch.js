/* Storefront search: "necklaces", "Earring", "gold chains" and "chains & necklaces" should all find
   what a shopper means. Words are lower-cased, split on anything that is not a letter or digit,
   reduced to the singular and matched against the name, SKU, category, sub-category, tags, colour
   and material. Every word must be found; when that finds nothing, any word will do — so a
   two-category search still shows something instead of an empty page.

   Pure module: safe on the server, in the browser and in tests. */

const FILLER = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'the', 'with']);

/** "necklaces" → "necklace", "earrings" → "earring", "pendants" → "pendant"; short words and "-ss" words are left alone. */
export function singular(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** The search words in `text`, singular, without filler words or repeats. */
export function searchTokens(text) {
  const words = String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return [...new Set(words.filter((w) => !FILLER.has(w)).map(singular))];
}

function haystack(product) {
  const parts = [product.name, product.sku, product.category, product.subCategory, product.color, product.material];
  if (Array.isArray(product.tags)) parts.push(...product.tags);
  return searchTokens(parts.filter((v) => typeof v === 'string').join(' ')).join(' ');
}

/**
 * The products that match `query`. An empty query (or one made only of filler words) matches everything.
 *
 * @template {object} P
 * @param {P[]} products
 * @param {string} query
 * @returns {P[]}
 */
export function searchProducts(products, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return products;
  const indexed = products.map((product) => [product, haystack(product)]);
  const all = indexed.filter(([, text]) => tokens.every((t) => text.includes(t)));
  if (all.length || tokens.length === 1) return all.map(([product]) => product);
  return indexed.filter(([, text]) => tokens.some((t) => text.includes(t))).map(([product]) => product);
}
