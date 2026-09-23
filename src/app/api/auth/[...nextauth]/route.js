import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getDB } from '@/lib/firebase';
import { PLATFORM_VENDOR_ID } from '@/lib/data/scopedDb';
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

/* Access is derived on every sign-in (and re-checked during the session)
   from the two sources of truth only: the ADMIN_EMAILS env var, and an
   Active record in the staff collection. A role stored on the users
   document is never trusted on its own — it used to be, which meant a
   staff member who once signed in with Google stayed admin forever, even
   after being deactivated.
     ADMIN_EMAILS                          → admin  (platform owner)
     active staff, platform (Tulsi) staff   → admin  (platform staff)
     active staff of an outside vendor      → vendor (their own dashboard only)
     anyone else                            → customer */
async function resolveAccess(db, email) {
  const lower = String(email || '').toLowerCase();
  if (!lower) return { role: 'customer' };
  if (getAdminEmails().includes(lower)) return { role: 'admin', staffRole: 'Owner' };

  const snap = await db.collection('staff').where('email', '==', lower).limit(5).get();
  const active = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.status === 'Active');
  if (active.length !== 1) {
    // Active at more than one place: refuse rather than guess which one.
    if (active.length > 1) console.error('[auth] multiple active staff records for', lower);
    return { role: 'customer' };
  }
  const staff = active[0];
  if (staff.vendorId && staff.vendorId !== PLATFORM_VENDOR_ID) {
    return { role: 'vendor', vendorId: staff.vendorId, staffRole: staff.role || null };
  }
  return { role: 'admin', staffRole: staff.role || null };
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

        // Check users collection first
        const snap = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!snap.empty) {
          const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
          if (!user.isActive || !user.password) return null;
          const isValid = await bcrypt.compare(credentials.password, user.password);
          if (!isValid) return null;
          const access = await resolveAccess(db, user.email);
          if (access.role !== user.role) await snap.docs[0].ref.update({ role: access.role });
          return { id: user.id, name: user.name, email: user.email, ...access };
        }

        // Staff account (platform staff or an outside vendor's login)
        const staffSnap = await db.collection('staff').where('email', '==', email).limit(1).get();
        if (!staffSnap.empty) {
          const staff = { id: staffSnap.docs[0].id, ...staffSnap.docs[0].data() };
          if (staff.status !== 'Active' || !staff.password) return null;
          const isValid = await bcrypt.compare(credentials.password, staff.password);
          if (!isValid) return null;
          const access = await resolveAccess(db, staff.email);
          if (access.role === 'customer') return null;
          return { id: staff.id, name: staff.name, email: staff.email, ...access };
        }

        return null;
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
          if (dbUser.staffRole) user.staffRole = dbUser.staffRole;
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
        token.staffRole = user.staffRole || null;
        token.vendorId = user.vendorId || null;
        token.accessCheckedAt = Date.now();
        return token;
      }
      if (token.role && token.role !== 'customer' && token.email && Date.now() - (token.accessCheckedAt || 0) > ACCESS_RECHECK_MS) {
        try {
          const access = await resolveAccess(getDB(), token.email);
          token.role = access.role;
          token.staffRole = access.staffRole || null;
          token.vendorId = access.vendorId || null;
          token.accessCheckedAt = Date.now();
        } catch (err) {
          // A Firestore blip shouldn't sign everyone out — keep the current
          // access and try again on the next request.
          console.error('[auth] access re-check failed:', err.message);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.role = token.role;
        if (token.staffRole) session.user.staffRole = token.staffRole;
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
