import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getDB } from '@/lib/firebase';
import bcrypt from 'bcryptjs';

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',').map((e) => e.trim()).filter(Boolean);
}

async function upsertGoogleUser(db, profile) {
  const snap = await db.collection('users').where('email', '==', profile.email).limit(1).get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    const existing = doc.data();
    await doc.ref.update({ name: profile.name, googleId: profile.sub, updatedAt: new Date().toISOString() });
    return { id: doc.id, ...existing };
  }
  const ref = db.collection('users').doc();
  const role = getAdminEmails().includes(profile.email) ? 'admin' : 'customer';
  const userData = {
    name: profile.name, email: profile.email, googleId: profile.sub,
    avatar: profile.picture, role, isActive: true, createdAt: new Date().toISOString(),
  };
  await ref.set(userData);
  return { id: ref.id, ...userData };
}

/* Only add Google provider when credentials are actually configured */
const providers = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
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
        // Single-field query only — no composite index needed
        const snap = await db.collection('users')
          .where('email', '==', credentials.email.toLowerCase())
          .limit(1).get();
        if (snap.empty) return null;
        const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
        if (!user.isActive || !user.password) return null;
        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role || 'customer' };
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
        // Single-field query — check code in code to avoid composite index
        const snap = await db.collection('otp_codes')
          .where('email', '==', credentials.email.toLowerCase())
          .limit(5).get();
        if (snap.empty) return null;
        // Find matching code among results
        const otpDoc = snap.docs.find((d) => d.data().code === credentials.otp.trim());
        if (!otpDoc) return null;
        const { expiresAt } = otpDoc.data();
        if (new Date(expiresAt) < new Date()) {
          await otpDoc.ref.delete();
          return null;
        }
        await otpDoc.ref.delete(); // one-time use

        const userSnap = await db.collection('users')
          .where('email', '==', credentials.email.toLowerCase()).limit(1).get();
        if (!userSnap.empty) {
          const u = { id: userSnap.docs[0].id, ...userSnap.docs[0].data() };
          return { id: u.id, name: u.name, email: u.email, role: u.role };
        }
        // Auto-create on first OTP login
        const ref = db.collection('users').doc();
        const role = getAdminEmails().includes(credentials.email.toLowerCase()) ? 'admin' : 'customer';
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
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
