/* Sent with every response. No full script CSP yet (Razorpay, Google
   sign-in, analytics and the try-on all load third-party scripts and would
   need a tested allow-list); these are the directives that can't break a
   page: no framing (clickjacking), no <object>/<embed>, no <base> hijack,
   no MIME sniffing, HTTPS only. */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  /* camera: the jewellery try-on; payment: Razorpay checkout. */
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")' },
];

/* The store no longer rents jewellery. The old rental URLs are still linked
   from search results, bookmarks and e-mails already sent, so they redirect
   permanently (308) instead of 404ing — to the product page where there is
   one, otherwise to the shop. A redirect runs before the file system, so the
   retired pages could never be served. The booking API (/api/rentals) and
   the admin screens are untouched: they still serve bookings already made. */
const RETIRED_RENTAL_REDIRECTS = [
  { source: '/rentals', destination: '/shop', permanent: true },
  { source: '/rental-booking/:id', destination: '/product/:id', permanent: true },
  { source: '/rental-success', destination: '/shop', permanent: true },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return RETIRED_RENTAL_REDIRECTS;
  },
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      /* The admin's category-showcase preview is an iframe on our own admin
         page: allow same-origin framing for that one path only (a later
         match overrides the same header key). */
      {
        source: '/showcase-preview',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      /* The ₹ glyph fonts (public/fonts, see globals.css) never change under
         the same name — if one is ever re-cut, give it a new file name. Next
         serves public/ files with max-age=0 otherwise, i.e. a re-check on every
         visit. */
      {
        source: '/fonts/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
  images: {
    /* Serve AVIF first (smaller than WebP for most photos), falling back to
       WebP, negotiated per-browser via the Accept header. Both are already
       decoded from whatever Cloudinary stores — this doesn't need Cloudinary
       changes, next/image transforms on the way out through /_next/image. */
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
};

export default nextConfig;
