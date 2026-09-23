import { getSession } from 'next-auth/react';

/* Only same-site paths — never follow a callbackUrl off the site. */
export function safeLocalPath(url, fallback) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : fallback;
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
