import { SITE_URL } from '@/lib/seoSchema';

/* Private and transactional paths — nothing to index there. */
const PRIVATE = [
  '/admin', '/admin-portal', '/vendor', '/api/', '/cart', '/checkout', '/account', '/login',
  '/wishlist', '/order-success', '/rental-success', '/rental-booking', '/auth-error', '/photo-editor',
];

/* Search engines and AI answer engines are named explicitly (not only via
   "*") so the policy is unambiguous for each: product, category, rental,
   FAQ and policy pages are open to all of them. Allowing GPTBot, ClaudeBot,
   Google-Extended and Applebot-Extended also permits use of public pages
   for AI training — remove those four to keep AI search/answers but opt
   out of training. */
const CRAWLERS = [
  'Googlebot', 'Googlebot-Image', 'Bingbot', 'DuckDuckBot', 'Applebot', 'YandexBot',
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent',
];

export default function robots() {
  return {
    rules: [
      { userAgent: CRAWLERS, allow: ['/', '/product/', '/shop', '/catalog', '/rentals', '/faq', '/llms.txt'], disallow: PRIVATE },
      { userAgent: '*', allow: '/', disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
