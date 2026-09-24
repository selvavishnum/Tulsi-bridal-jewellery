/* One definition of whether the session cookie is Secure (and so carries
   the __Secure- prefix), shared by NextAuth and the middleware's
   getToken() — they must agree on the cookie name. Mirrors getToken's own
   default. */
export const SECURE_COOKIES = process.env.NEXTAUTH_URL
  ? process.env.NEXTAUTH_URL.startsWith('https://')
  : !!process.env.VERCEL;
