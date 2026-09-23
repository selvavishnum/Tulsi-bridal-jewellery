import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getDB } from '@/lib/firebase';
import { resolveAccess, ROLES } from '@/lib/access';

const DEV_BYPASS = process.env.NEXT_PUBLIC_ADMIN_BYPASS === 'true' && process.env.NODE_ENV !== 'production';
const DEV_SESSION = { user: { id: 'dev-bypass', email: 'dev-bypass@test.com', name: 'Dev Admin', role: 'admin', tier: ROLES.SUPER_ADMIN } };

export function adminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/* Zero trust: the session only says who the caller claims to be. Their
   tier is re-read from ADMIN_EMAILS / the staff record on every call, so a
   demoted or deactivated person loses access on their very next request,
   not when their 30-day token expires. */
export async function getAccess() {
  if (DEV_BYPASS) return { session: DEV_SESSION, tier: ROLES.SUPER_ADMIN };
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { session: null, tier: null };
  const access = await resolveAccess(getDB(), session.user.email, adminEmails());
  return { session, ...access };
}

/**
 * Route guard. Usage:
 *   const auth = await requireRole([ROLES.SUPER_ADMIN, ROLES.CATALOG_STAFF]);
 *   if (auth.error) return auth.error;
 *   auth.tier, auth.session, auth.vendorId
 * 401 when signed out, 403 when signed in without one of the allowed roles.
 */
export async function requireRole(allowed) {
  const access = await getAccess();
  if (!access.session) {
    return { error: NextResponse.json({ success: false, message: 'Sign in required' }, { status: 401 }) };
  }
  if (!access.tier || !allowed.includes(access.tier)) {
    return { error: NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 }) };
  }
  return access;
}

export { ROLES };
