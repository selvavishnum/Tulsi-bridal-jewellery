/* Storefront search (src/lib/productSearch.js, used by GET /api/products?search=):
   plural/singular, several words, category / tag / colour matches, and the "any word" fallback. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { singular, searchTokens, searchProducts } from '../src/lib/productSearch.js';

const P = [
  { name: 'Layered Gold Chain', sku: 'CHA-1A', category: 'chain', tags: ['trending', 'daily wear'], color: 'Gold' },
  { name: 'Pearl Drop Necklace', sku: 'NEC-2B', category: 'necklace', tags: ['festive'], material: 'Pearl' },
  { name: 'Minimal Studs', sku: 'EAR-3C', category: 'earrings', subCategory: 'studs', color: 'Silver' },
  { name: 'Charm Anklet', sku: 'ANK-4D', category: 'anklet' },
];
const names = (query) => searchProducts(P, query).map((p) => p.name);

describe('singular / searchTokens', () => {
  test('plural endings become singular; short and "-ss" words stay', () => {
    assert.deepEqual(['necklaces', 'earrings', 'anklets', 'chains', 'pendants', 'brooches', 'boxes', 'glass', 'gas', 'jewellery', 'berries'].map(singular),
      ['necklace', 'earring', 'anklet', 'chain', 'pendant', 'brooch', 'box', 'glass', 'gas', 'jewellery', 'berry']);
  });
  test('lower-cased, split on punctuation, filler dropped, no repeats', () => {
    assert.deepEqual(searchTokens('  Chains & Necklaces, the chain! '), ['chain', 'necklace']);
    assert.deepEqual(searchTokens('TJ-001'), ['tj', '001']);
    assert.deepEqual(searchTokens(null), []);
    assert.deepEqual(searchTokens('and of the'), []);
  });
});

describe('searchProducts', () => {
  test('a plural or singular word finds the category', () => {
    assert.deepEqual(names('necklaces'), ['Pearl Drop Necklace']);
    assert.deepEqual(names('Necklace'), ['Pearl Drop Necklace']);
    assert.deepEqual(names('earring'), ['Minimal Studs']);
    assert.deepEqual(names('anklets'), ['Charm Anklet']);
    assert.deepEqual(names('chains'), ['Layered Gold Chain']);
  });
  test('tags, colour, material and SKU are searched too', () => {
    assert.deepEqual(names('trending'), ['Layered Gold Chain']);
    assert.deepEqual(names('daily wear'), ['Layered Gold Chain']);
    assert.deepEqual(names('silver'), ['Minimal Studs']);
    assert.deepEqual(names('pearl'), ['Pearl Drop Necklace']);
    assert.deepEqual(names('ear-3c'), ['Minimal Studs']);
  });
  test('every word must match; gold chains is the gold chain, not every gold or chain item', () => {
    assert.deepEqual(names('gold chains'), ['Layered Gold Chain']);
    assert.deepEqual(names('silver studs'), ['Minimal Studs']);
  });
  test('when no product has every word, any word will do — "chains & necklaces" shows both shelves', () => {
    assert.deepEqual(names('chains & necklaces'), ['Layered Gold Chain', 'Pearl Drop Necklace']);
    assert.deepEqual(names('anklets zzz'), ['Charm Anklet']);
  });
  test('a single word that matches nothing finds nothing; an empty query finds everything', () => {
    assert.deepEqual(names('zzz'), []);
    assert.equal(searchProducts(P, '').length, P.length);
    assert.equal(searchProducts(P, '   ').length, P.length);
    assert.equal(searchProducts(P, 'the and').length, P.length);
  });
  test('products with missing fields do not throw', () => {
    assert.deepEqual(searchProducts([{ name: 'X' }, {}, { tags: 'nope', name: 7 }], 'x').length, 1);
  });
});
