import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getDB } from '@/lib/firebase';
import { resolveAccess as resolveTier, sessionRoleFor } from '@/lib/access';
import bcrypt from 'bcryptjs';

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

async function upsertGoogleUser(db, profile) {
  const email = profile.email.toLowerCase();
  const access = await resolveAccess(db, email);

  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    await doc.ref.update({ name: profile.name, googleId: profile.sub, role: access.role, updatedAt: new Date().toISOString() });
    return { id: doc.id, ...doc.data(), ...access };
  }
  const ref = db.collection('users').doc();
  const userData = {
    name: profile.name, email, googleId: profile.sub,
    avatar: profile.picture, role: access.role, isActive: true, createdAt: new Date().toISOString(),
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
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;
      try {
        const db = getDB();
        const email = credentials.email.toLowerCase();

        const access = await resolveAccess(db, email);

        /* Customers sign in with their users-collection password. Anyone with
           more than customer access must use their staff-record password (or
           email OTP / Google, which prove they own the address): users
           passwords come from open registration, which never verifies the
           email, so trusting them let anyone register a staff member's or
           owner's address and sign in with their access. */
        if (access.role === 'customer') {
          const snap = await db.collection('users').where('email', '==', email).limit(1).get();
          if (snap.empty) return null;
          const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
          if (!user.isActive || !user.password) return null;
          const isValid = await bcrypt.compare(credentials.password, user.password);
          if (!isValid) return null;
          if (user.role !== 'customer') await snap.docs[0].ref.update({ role: 'customer' });
          return { id: user.id, name: user.name, email: user.email, role: 'customer' };
        }

        const staffSnap = await db.collection('staff').where('email', '==', email).get();
        const staff = staffSnap.docs.map((d) => ({ id: d.id, ...d.data() })).find((s) => s.status === 'Active' && s.password);
        if (!staff) return null;
        const isValid = await bcrypt.compare(credentials.password, staff.password);
        if (!isValid) return null;
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
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.otp) return null;
      try {
        const db = getDB();
        const snap = await db.collection('otp_codes')
          .where('email', '==', credentials.email.toLowerCase()).limit(5).get();
        if (snap.empty) return null;
        const otpDoc = snap.docs.find((d) => d.data().code === credentials.otp.trim());
        if (!otpDoc) return null;
        const { expiresAt } = otpDoc.data();
        if (new Date(expiresAt) < new Date()) { await otpDoc.ref.delete(); return null; }
        await otpDoc.ref.delete();

        const userSnap = await db.collection('users')
          .where('email', '==', credentials.email.toLowerCase()).limit(1).get();
        if (!userSnap.empty) {
          const u = { id: userSnap.docs[0].id, ...userSnap.docs[0].data() };
          const access = await resolveAccess(db, u.email);
          if (access.role !== u.role) await userSnap.docs[0].ref.update({ role: access.role });
          return { id: u.id, name: u.name, email: u.email, ...access };
        }
        // First OTP login — create user
        const ref = db.collection('users').doc();
        const access = await resolveAccess(db, credentials.email);
        const userData = {
          name: credentials.email.split('@')[0],
          email: credentials.email.toLowerCase(),
          role: access.role, isActive: true, createdAt: new Date().toISOString(),
        };
        await ref.set(userData);
        return { id: ref.id, ...userData, ...access };
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
        try {
          const db = getDB();
          const dbUser = await upsertGoogleUser(db, profile);
          user.id = dbUser.id;
          user.role = dbUser.role;
          user.tier = dbUser.tier || null;
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
        if (token.vendorId) session.user.vendorId = token.vendorId;
      }
      return session;
    },
  },
  pages: { signIn: '/login', error: '/auth-error' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  /* No fallback on purpose. A hardcoded default would sign every session token
     with a value that is public in this repo, letting anyone mint an admin JWT. */
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
