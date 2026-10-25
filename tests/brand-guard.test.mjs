/* Saved Admin → Settings text from the old "Tulsi Bridal Jewellery" store must not put the old brand back on a
   rebranded site (lib/brand.js) — while any other saved text still wins, as before. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedBrandText } from '../src/lib/brand.js';
import { buildStoreJsonLd, SITE_NAME } from '../src/lib/seoSchema.js';

test('savedBrandText: a saved text wins unless it is blank, not a string, or still says "bridal"', () => {
  assert.equal(savedBrandText('Tulsi Fashion Jewellery Pvt Ltd', 'X'), 'Tulsi Fashion Jewellery Pvt Ltd');
  assert.equal(savedBrandText('  Modern Fashion Jewellery  ', 'X'), 'Modern Fashion Jewellery', 'trimmed');
  assert.equal(savedBrandText('Tulsi Bridal Jewellery', 'X'), 'X');
  assert.equal(savedBrandText('Handcrafted BRIDAL jewellery for brides', 'X'), 'X', 'any case, inside a sentence');
  for (const blank of ['', '   ', undefined, null, 0, {}, []]) assert.equal(savedBrandText(blank, 'X'), 'X');
  assert.equal(savedBrandText('Bridalwear Co', 'X'), 'Bridalwear Co', 'only the word itself — nothing else is second-guessed');
});

test('the store data for search engines: a saved "Tulsi Bridal Jewellery" name, legal name and description are ignored; other saved values still win', () => {
  const old = buildStoreJsonLd({ businessName: 'Tulsi Bridal Jewellery', legalName: 'Tulsi Bridal Jewellery', seoDescription: 'Handcrafted bridal jewellery', phone: '7695868787' });
  assert.equal(old.name, SITE_NAME);
  assert.equal(old.legalName, SITE_NAME);
  assert.doesNotMatch(JSON.stringify(old), /bridal/i);
  const renamed = buildStoreJsonLd({ businessName: 'Tulsi Fashion Jewellery', legalName: 'Tulsi Fashion Jewellery Pvt Ltd', seoDescription: 'Chains and more' });
  assert.equal(renamed.name, 'Tulsi Fashion Jewellery');
  assert.equal(renamed.legalName, 'Tulsi Fashion Jewellery Pvt Ltd');
  assert.equal(renamed.description, 'Chains and more');
  /* An old business name but a new legal name: each field is judged on its own. */
  const mixed = buildStoreJsonLd({ businessName: 'Tulsi Bridal Jewellery', legalName: 'Tulsi Fashion Pvt Ltd' });
  assert.equal(mixed.name, SITE_NAME);
  assert.equal(mixed.legalName, 'Tulsi Fashion Pvt Ltd');
});
