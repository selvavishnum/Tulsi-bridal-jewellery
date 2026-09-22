import { SITE_URL } from '@/lib/seo';

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/cart', '/checkout', '/order-success', '/rental-success'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
