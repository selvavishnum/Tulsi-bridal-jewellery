import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/* Defense-in-depth on top of the per-route requireAdmin() checks (which
   remain the real authority — every /api/admin handler still calls it):
     1. /admin/*      — gate the page shell itself so an unauthenticated
        or non-admin visitor is redirected before any admin UI/route
        structure ships to the browser, instead of relying solely on the
        client-side check in src/app/admin/layout.js (which still runs,
        for the session-aware UI it renders once logged in).
     2. /api/admin/*  — reject cross-origin mutating requests outright.
        NextAuth's session cookie already defaults to SameSite=Lax, which
        blocks it from being attached to a cross-site POST/PUT/PATCH/
        DELETE, but that protection has zero redundancy if the cookie
        attribute is ever changed (e.g. embedding the panel in an iframe
        on another origin). An Origin/Host mismatch check costs nothing
        and doesn't depend on cookie config to hold. */

const DEV_BYPASS = process.env.NEXT_PUBLIC_ADMIN_BYPASS === 'true' && process.env.NODE_ENV !== 'production';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/admin')) {
    if (MUTATING_METHODS.has(request.method)) {
      const origin = request.headers.get('origin') || request.headers.get('referer');
      const host = request.headers.get('host');
      if (origin && host) {
        let originHost;
        try { originHost = new URL(origin).host; } catch { originHost = null; }
        if (originHost !== host) {
          return NextResponse.json({ success: false, message: 'Cross-origin request blocked' }, { status: 403 });
        }
      }
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/admin') && pathname !== '/admin-portal') {
    if (DEV_BYPASS) return NextResponse.next();

    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token || token.role !== 'admin') {
      return NextResponse.redirect(new URL('/admin-portal', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
