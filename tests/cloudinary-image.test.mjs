/* Catalog card image URLs (edge-to-edge 4:5 tiles, retina srcset, LQIP,
   optional white background) and the on-demand deep-zoom tiers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cldCard, cldCardSrcSet, cldPlaceholder, cldZoom, cldDeepZoom, CARD_WIDTHS } from '../src/lib/cloudinaryImage.js';

const U = 'https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/products/a.jpg';

test('card tile: 3:4 fill with content-aware gravity, auto format, best quality', () => {
  assert.equal(cldCard(U), 'https://res.cloudinary.com/tulsi/image/upload/f_auto,q_auto:best,w_1000,ar_3:4,c_fill,g_auto/v17/tulsi-bridal/products/a.jpg');
});

test('white background: AI removal runs first, then flattens onto #FFFFFF', () => {
  assert.equal(cldCard(U, 600, { whiteBg: true }),
    'https://res.cloudinary.com/tulsi/image/upload/e_background_removal/b_rgb:FFFFFF,f_auto,q_auto:best,w_600,ar_3:4,c_fill,g_auto/v17/tulsi-bridal/products/a.jpg');
});

test('srcset covers phone to 1000px@2x; non-Cloudinary images get none', () => {
  const set = cldCardSrcSet(U).split(', ');
  assert.equal(set.length, CARD_WIDTHS.length);
  assert.match(set[0], /w_400,ar_3:4,c_fill,g_auto\/.* 400w$/);
  assert.match(set.at(-1), /w_2000,ar_3:4,c_fill,g_auto\/.* 2000w$/);
  assert.equal(cldCardSrcSet('https://images.unsplash.com/photo-1'), undefined);
});

test('LQIP: tiny blurred preview with the same crop, Cloudinary only', () => {
  assert.match(cldPlaceholder(U), /\/upload\/f_auto,q_auto:low,w_32,ar_3:4,c_fill,g_auto,e_blur:400\//);
  assert.equal(cldPlaceholder('https://images.unsplash.com/photo-1'), null);
});

test('deep zoom: w_3000 q_90 on open, w_5000 q_90 for fine detail, never upscaled', () => {
  assert.match(cldZoom(U), /\/upload\/f_auto,q_90,w_3000,c_limit\//);
  assert.match(cldDeepZoom(U), /\/upload\/f_auto,q_90,w_5000,c_limit\//);
});
