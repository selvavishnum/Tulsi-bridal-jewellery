/* ─────────────────────────────────────────────
   Customer avatars (homepage "Happy Customers" + the admin testimonial
   editor). Photos are stored as the plain Cloudinary secure_url and shaped
   at render time:
     c_fill,g_face,w_200,h_200,r_max,q_auto:best,f_auto
   — face-centred, square-cropped, perfectly round, ~3× density for a
   56–64 px circle on retina screens, in the best format per browser.

   Pure module: safe in the browser, on the server and in tests.
   ───────────────────────────────────────────── */

export const AVATAR_PX = 200;
const UPLOAD = '/upload/';

/** A usable absolute https image URL (a half-typed link isn't). */
export function isUsableImageUrl(url) {
  if (typeof url !== 'string' || url.length > 600 || !/^https:\/\/[^\s"'<>]+$/.test(url)) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/\.[a-z]{2,}$/i.test(u.hostname)) return false;
    /* Cloudinary's share / console pages (collection.cloudinary.com, …) are
       web pages, not images — only its delivery host serves the photo. */
    if (/(^|\.)cloudinary\.com$/i.test(u.hostname) && u.hostname.toLowerCase() !== 'res.cloudinary.com') return false;
    return true;
  } catch {
    return false;
  }
}

export const isCloudinaryUpload = (url) => typeof url === 'string' && /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url);

/**
 * The avatar URL to render. Cloudinary uploads get the face-centred round
 * crop; any other https image is used as is (the component still crops it
 * with CSS); anything unusable → '' (the initial is shown instead).
 */
export function avatarUrl(url, px = AVATAR_PX) {
  if (!isUsableImageUrl(url)) return '';
  if (!isCloudinaryUpload(url)) return url;
  const size = Math.max(32, Math.min(800, Math.round(px)));
  const i = url.indexOf(UPLOAD) + UPLOAD.length;
  return `${url.slice(0, i)}c_fill,g_face,w_${size},h_${size},r_max,q_auto:best,f_auto/${url.slice(i)}`;
}

/** First letter of the name for the fallback badge ("Vishalini" → "V"). */
export function initialOf(name) {
  const first = Array.from(String(name || '').trim())[0];
  return first ? first.toLocaleUpperCase('en-IN') : '★';
}
