/** @type {import('next').NextConfig} */
const nextConfig = {
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
