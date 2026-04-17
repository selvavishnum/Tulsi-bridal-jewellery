import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getDB } from '@/lib/firebase';
import bcrypt from 'bcryptjs';

async function upsertGoogleUser(db, profile) {
  const snap = await db.collection('users').where('email', '==', profile.email).limit(1).get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    await doc.ref.update({ name: profile.name, googleId: profile.sub, updatedAt: new Date().toISOString() });
    return { id: doc.id, ...doc.data(), role: doc.data().role || 'customer' };
  }
  // New Google user — create account
  const ref = db.collection('users').doc();
  const adminEmails = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '').split(',').map((e) => e.trim());
  const role = adminEmails.includes(profile.email) ? 'admin' : 'customer';
  const userData = {
    name: profile.name,
    email: profile.email,
    googleId: profile.sub,
    avatar: profile.picture,
    role,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  await ref.set(userData);
  return { id: ref.id, ...userData };
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const db = getDB();
        const snap = await db.collection('users')
          .where('email', '==', credentials.email.toLowerCase())
          .where('isActive', '==', true)
          .limit(1).get();
        if (snap.empty) return null;
        const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
        if (!user.password) return null; // Google-only account
        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role };
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
        const db = getDB();
        const snap = await db.collection('otp_codes')
          .where('email', '==', credentials.email.toLowerCase())
          .where('code', '==', credentials.otp.trim())
          .limit(1).get();
        if (snap.empty) return null;
        const otpDoc = snap.docs[0];
        const { expiresAt, used } = otpDoc.data();
        if (used || new Date(expiresAt) < new Date()) {
          await otpDoc.ref.delete();
          return null;
        }
        await otpDoc.ref.delete(); // one-time use
        // Get or create user
        const userSnap = await db.collection('users').where('email', '==', credentials.email.toLowerCase()).limit(1).get();
        if (!userSnap.empty) {
          const u = { id: userSnap.docs[0].id, ...userSnap.docs[0].data() };
          return { id: u.id, name: u.name, email: u.email, role: u.role };
        }
        // Auto-create account for OTP login
        const ref = db.collection('users').doc();
        const adminEmails = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '').split(',').map((e) => e.trim());
        const role = adminEmails.includes(credentials.email) ? 'admin' : 'customer';
        const userData = { name: credentials.email.split('@')[0], email: credentials.email.toLowerCase(), role, isActive: true, createdAt: new Date().toISOString() };
        await ref.set(userData);
        return { id: ref.id, ...userData };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        try {
          const db = getDB();
          const dbUser = await upsertGoogleUser(db, profile);
          user.id = dbUser.id;
          user.role = dbUser.role;
        } catch { return false; }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      if (account?.provider === 'google' && !token.role) {
        try {
          const db = getDB();
          const snap = await db.collection('users').where('email', '==', token.email).limit(1).get();
          if (!snap.empty) token.role = snap.docs[0].data().role || 'customer';
        } catch {}
      }
      return token;
    },
    async session({ session, token }) {
      if (token) { session.user.id = token.id; session.user.role = token.role; }
      return session;
    },
  },
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
