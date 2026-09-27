import { getDB } from '@/lib/firebase';

const MAX_BYTES = 12 * 1024 * 1024;
const bad = (status, message) => new Response(message, { status, headers: { 'content-type': 'text/plain' } });

/* GET /api/try-on/image?product=<id>&src=<url>
   Serves a product's own photo from this origin, so the try-on canvas can
   read its pixels (to cut the jewellery out) even when the image host
   sends no CORS headers. Only URLs saved on that product are fetched —
   never an arbitrary address. */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('product');
    const src = searchParams.get('src');
    if (!productId || !src || !/^https:\/\//.test(src)) return bad(400, 'product and https src required');

    const snap = await getDB().collection('products').doc(String(productId)).get();
    if (!snap.exists) return bad(404, 'Product not found');
    const p = snap.data();
    const allowed = new Set([...(Array.isArray(p.images) ? p.images : []), p.tryOnImage].filter((u) => typeof u === 'string'));
    if (!allowed.has(src)) return bad(403, 'Not an image of this product');

    const res = await fetch(src, { headers: { accept: 'image/*' }, signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/') || type.includes('svg')) return bad(502, 'Image unavailable');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return bad(413, 'Image too large');
    return new Response(buf, {
      headers: { 'content-type': type, 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800', 'x-content-type-options': 'nosniff' },
    });
  } catch (e) {
    console.error('[try-on/image]', e.message);
    return bad(502, 'Image unavailable');
  }
}
