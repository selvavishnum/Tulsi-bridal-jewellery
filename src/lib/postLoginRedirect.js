import { getSession } from 'next-auth/react';

/* Only same-site paths — never follow a callbackUrl off the site.
   A prefix check alone isn't enough: browsers read "/\\evil.com" and
   "/%09/evil.com" as "//evil.com". So resolve it the way the browser will
   and keep it only if it stays on this origin. */
export function safeLocalPath(url, fallback, origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost') {
  if (typeof url !== 'string' || !url.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(url)) return fallback;
  try {
    const u = new URL(url, origin);
    if (u.origin !== origin) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Where to send someone who just signed in. Vendors always land in their
 * portal (keeping a /vendor/* deep link); everyone else goes to `fallback`.
 */
export async function destinationAfterSignIn(callbackUrl, fallback) {
  const session = await getSession();
  const role = session?.user?.role;
  const wanted = safeLocalPath(callbackUrl, null);
  if (role === 'vendor') return wanted?.startsWith('/vendor/') && wanted !== '/vendor/login' ? wanted : '/vendor/dashboard';
  return wanted && wanted !== '/' ? wanted : fallback;
}
