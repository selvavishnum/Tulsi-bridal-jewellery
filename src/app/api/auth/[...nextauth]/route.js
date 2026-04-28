import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getDB } from '@/lib/firebase';
import bcrypt from 'bcryptjs';

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/* Always returns correct role — upgrades existing users if email is in ADMIN_EMAILS */
function resolveRole(email, storedRole) {
  if (getAdminEmails().includes(email.toLowerCase())) return 'admin';
  return storedRole || 'customer';
}

async function upsertGoogleUser(db, profile) {
  const snap = await db.collection('users').where('email', '==', profile.email.toLowerCase()).limit(1).get();
  const role = resolveRole(profile.email, snap.empty ? null : snap.docs[0].data().role);
  if (!snap.empty) {
    const doc = snap.docs[0];
    await doc.ref.update({ name: profile.name, googleId: profile.sub, role, updatedAt: new Date().toISOString() });
    return { id: doc.id, ...doc.data(), role };
  }
  const ref = db.collection('users').doc();
  const userData = {
    name: profile.name, email: profile.email.toLowerCase(), googleId: profile.sub,
    avatar: profile.picture, role, isActive: true, createdAt: new Date().toISOString(),
  };
  await ref.set(userData);
  return { id: ref.id, ...userData };
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
        const snap = await db.collection('users')
          .where('email', '==', credentials.email.toLowerCase()).limit(1).get();
        if (snap.empty) return null;
        const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
        if (!user.isActive || !user.password) return null;
        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;
        const role = resolveRole(user.email, user.role);
        if (role !== user.role) await snap.docs[0].ref.update({ role });
        return { id: user.id, name: user.name, email: user.email, role };
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
          const role = resolveRole(u.email, u.role);
          if (role !== u.role) await userSnap.docs[0].ref.update({ role });
          return { id: u.id, name: u.name, email: u.email, role };
        }
        // First OTP login — create user
        const ref = db.collection('users').doc();
        const role = resolveRole(credentials.email, null);
        const userData = {
          name: credentials.email.split('@')[0],
          email: credentials.email.toLowerCase(),
          role, isActive: true, createdAt: new Date().toISOString(),
        };
        await ref.set(userData);
        return { id: ref.id, ...userData };
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
        } catch (err) {
          console.error('Google signIn error:', err.message);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) { token.id = user.id; token.role = user.role; }
      return token;
    },
    async session({ session, token }) {
      if (token) { session.user.id = token.id; session.user.role = token.role; }
      return session;
    },
  },
  pages: { signIn: '/login', error: '/auth-error' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET || 'tulsi-bridal-dev-secret-testing-only',
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
