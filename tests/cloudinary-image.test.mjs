/* Catalog card image URLs: retina srcset, LQIP, and the optional
   white-background transformation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cldCard, cldCardSrcSet, cldPlaceholder, CARD_WIDTHS } from '../src/lib/cloudinaryImage.js';

const U = 'https://res.cloudinary.com/tulsi/image/upload/v17/tulsi-bridal/products/a.jpg';

test('card tile: auto format, best quality, width-limited (never upscaled)', () => {
  assert.equal(cldCard(U), 'https://res.cloudinary.com/tulsi/image/upload/f_auto,q_auto:best,w_800,c_limit/v17/tulsi-bridal/products/a.jpg');
});

test('white background: AI removal runs first, then flattens onto #FFFFFF', () => {
  assert.equal(cldCard(U, 640, { whiteBg: true }),
    'https://res.cloudinary.com/tulsi/image/upload/e_background_removal/b_rgb:FFFFFF,f_auto,q_auto:best,w_640,c_limit/v17/tulsi-bridal/products/a.jpg');
});

test('srcset covers phone to 800px@2x; non-Cloudinary images get none', () => {
  const set = cldCardSrcSet(U).split(', ');
  assert.equal(set.length, CARD_WIDTHS.length);
  assert.match(set[0], /w_320,c_limit\/.* 320w$/);
  assert.match(set.at(-1), /w_1600,c_limit\/.* 1600w$/);
  assert.equal(cldCardSrcSet('https://images.unsplash.com/photo-1'), undefined);
});

test('LQIP: tiny blurred preview for Cloudinary images only', () => {
  assert.match(cldPlaceholder(U), /\/upload\/f_auto,q_auto:low,w_32,e_blur:400\//);
  assert.equal(cldPlaceholder('https://images.unsplash.com/photo-1'), null);
});
