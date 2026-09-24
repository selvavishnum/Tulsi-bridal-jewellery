import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getDB } from '@/lib/firebase';
import { resolveAccess as resolveTier, sessionRoleFor } from '@/lib/access';
import bcrypt from 'bcryptjs';
import { verifyOtp, normalizeEmail } from '@/lib/otp';
import { hitAll, clientIp, LIMITS } from '@/lib/rateLimit';
import { SECURE_COOKIES } from '@/lib/authCookies';

/* Thrown from authorize(): NextAuth hands the message to the client as
   `error`, so the login forms can say "wait a minute" instead of
   "wrong password". */
const RATE_LIMITED = 'RateLimited';

/* Compared against when there's no account, so an unknown email takes as
   long as a wrong password (no timing oracle for which emails exist). */
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

/* How often a signed-in admin/vendor session re-checks that the person is
   still allowed in. Sessions last 30 days; without this, deactivating a
   staff member or removing someone from ADMIN_EMAILS wouldn't bite until
   their token expired. */
const ACCESS_RECHECK_MS = 5 * 60 * 1000;

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/* Access comes only from the sources of truth — ADMIN_EMAILS and an Active
   staff record — via the shared 4-tier resolver (src/lib/access.js). A role
   stored on the users document is never trusted on its own. The tier is
   copied into the session for the UI; every API call re-resolves it
   (src/lib/requireRole.js), so the token is never the authority. */
async function resolveAccess(db, email) {
  const access = await resolveTier(db, email, getAdminEmails());
  return { role: sessionRoleFor(access.tier), tier: access.tier || null, vendorId: access.vendorId || null };
}

/* The real owner of an address just proved it (email code / Google). If
   the account was made by an unverified password registration, that
   password may be an attacker's who registered this address first — drop
   it, so only the owner can get in from now on. */
function claimVerifiedEmail(existing) {
  if (existing.emailVerified === true) return {};
  return { emailVerified: true, emailVerifiedAt: new Date().toISOString(), ...(existing.password && { password: null, passwordClearedReason: 'unverified registration' }) };
}

async function upsertGoogleUser(db, profile) {
  const email = profile.email.toLowerCase();
  const access = await resolveAccess(db, email);

  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    await doc.ref.update({ name: profile.name, googleId: profile.sub, role: access.role, ...claimVerifiedEmail(doc.data()), updatedAt: new Date().toISOString() });
    return { id: doc.id, ...doc.data(), ...access, emailVerified: true };
  }
  const ref = db.collection('users').doc();
  const userData = {
    name: profile.name, email, googleId: profile.sub,
    avatar: profile.picture, role: access.role, isActive: true, emailVerified: true, createdAt: new Date().toISOString(),
  };
  await ref.set(userData);
  return { id: ref.id, ...userData, ...access };
}

const providers = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }));
}

providers.push(
  CredentialsProvider({
    id: 'credentials',
    name: 'Email & Password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials, req) {
      if (!credentials?.email || !credentials?.password) return null;
      const db = getDB();
      const email = normalizeEmail(credentials.email);
      /* Brute-force guard: 5 tries a minute per account, 20 per IP. */
      const limited = await hitAll(db, [
        [`login:email:${email}`, LIMITS.loginEmail],
        [`login:ip:${clientIp(req?.headers)}`, LIMITS.loginIp],
      ]);
      if (!limited.allowed) throw new Error(RATE_LIMITED);
      try {
        const access = await resolveAccess(db, email);

        /* Customers sign in with their users-collection password. Anyone with
           more than customer access must use their staff-record password (or
           email OTP / Google, which prove they own the address): users
           passwords come from open registration, which never verifies the
           email, so trusting them let anyone register a staff member's or
           owner's address and sign in with their access. */
        if (access.role === 'customer') {
          const snap = await db.collection('users').where('email', '==', email).limit(1).get();
          const user = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
          const isValid = await bcrypt.compare(credentials.password, user?.password || DUMMY_HASH);
          if (!user || !user.isActive || !user.password || !isValid) return null;
          if (user.role !== 'customer') await snap.docs[0].ref.update({ role: 'customer' });
          return { id: user.id, name: user.name, email: user.email, role: 'customer', emailVerified: user.emailVerified === true };
        }

        const staffSnap = await db.collection('staff').where('email', '==', email).get();
        const staff = staffSnap.docs.map((d) => ({ id: d.id, ...d.data() })).find((s) => s.status === 'Active' && s.password);
        const isValid = await bcrypt.compare(credentials.password, staff?.password || DUMMY_HASH);
        if (!staff || !isValid) return null;
        return { id: staff.id, name: staff.name, email: staff.email, ...access };
      } catch (err) {
        console.error('Auth credentials error:', err.message);
        return null;
      }
    },
  }),
  CredentialsProvider({
    id: 'otp',
    name: 'Email OTP',
    credentials: {
      email: { label: 'Email', type: 'email' },
      otp: { label: 'OTP Code', type: 'text' },
    },
    async authorize(credentials, req) {
      if (!credentials?.email || !credentials?.otp) return null;
      const db = getDB();
      const email = normalizeEmail(credentials.email);
      /* Each code dies after 5 wrong guesses (verifyOtp); these limits stop
         guessing across freshly requested codes too. */
      const limited = await hitAll(db, [
        [`otp:email:${email}`, LIMITS.otpVerifyEmail],
        [`otp:ip:${clientIp(req?.headers)}`, LIMITS.otpVerifyIp],
      ]);
      if (!limited.allowed) throw new Error(RATE_LIMITED);
      try {
        if (!(await verifyOtp(db, email, credentials.otp))) return null;

        const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!userSnap.empty) {
          const u = { id: userSnap.docs[0].id, ...userSnap.docs[0].data() };
          if (u.isActive === false) return null;
          const access = await resolveAccess(db, email);
          await userSnap.docs[0].ref.update({ role: access.role, ...claimVerifiedEmail(u) });
          return { id: u.id, name: u.name, email, ...access, emailVerified: true };
        }
        // First OTP login — create user
        const ref = db.collection('users').doc();
        const access = await resolveAccess(db, email);
        const userData = {
          name: email.split('@')[0],
          email,
          role: access.role, isActive: true, emailVerified: true, createdAt: new Date().toISOString(),
        };
        await ref.set(userData);
        return { id: ref.id, ...userData, ...access, emailVerified: true };
      } catch (err) {
        console.error('OTP auth error:', err.message);
        return null;
      }
    },
  })
);

export const authOptions = {
  providers,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        /* Access is granted by email, so the email must be one Google has
           verified — otherwise an unverified Google account named after an
           owner/staff address would inherit their access. */
        if (profile?.email_verified !== true) return false;
        try {
          const db = getDB();
          const dbUser = await upsertGoogleUser(db, profile);
          user.id = dbUser.id;
          user.role = dbUser.role;
          user.tier = dbUser.tier || null;
          user.emailVerified = true;
          if (dbUser.vendorId) user.vendorId = dbUser.vendorId;
        } catch (err) {
          console.error('Google signIn error:', err.message);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.tier = user.tier || null;
        token.vendorId = user.vendorId || null;
        token.emailVerified = user.emailVerified === true;
        token.accessCheckedAt = Date.now();
        return token;
      }
      /* Keeps the UI's view of the role fresh; the API re-checks on every
         request regardless. */
      if (token.role && token.role !== 'customer' && token.email && Date.now() - (token.accessCheckedAt || 0) > ACCESS_RECHECK_MS) {
        try {
          const access = await resolveAccess(getDB(), token.email);
          token.role = access.role;
          token.tier = access.tier;
          token.vendorId = access.vendorId;
          token.accessCheckedAt = Date.now();
        } catch (err) {
          console.error('[auth] access re-check failed:', err.message);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.tier = token.tier || null;
        session.user.emailVerified = token.emailVerified === true;
        if (token.vendorId) session.user.vendorId = token.vendorId;
      }
      return session;
    },
  },
  pages: { signIn: '/login', error: '/auth-error' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  /* Session cookie: HttpOnly (no script access), Secure on https, and
     SameSite=Strict — never sent on a request another site starts, so no
     cross-site request can act with a signed-in session. Same name NextAuth
     uses by default, so middleware's getToken() finds it. The short-lived
     OAuth state/PKCE/CSRF cookies keep NextAuth's Lax default: Google's
     redirect back to /api/auth/callback is cross-site and needs them. */
  cookies: {
    sessionToken: {
      name: `${SECURE_COOKIES ? '__Secure-' : ''}next-auth.session-token`,
      options: { httpOnly: true, sameSite: 'strict', path: '/', secure: SECURE_COOKIES },
    },
  },
  /* No fallback on purpose. A hardcoded default would sign every session token
     with a value that is public in this repo, letting anyone mint an admin JWT. */
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
