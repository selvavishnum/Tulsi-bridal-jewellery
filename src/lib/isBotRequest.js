/* Server-side backstop for the track/* routes. The client already skips
   firing these calls for navigator.webdriver === true (see
   TrackingProvider.js / useProductTracking.js), but that only covers
   automation that executes this app's JS — a direct POST to these
   endpoints (curl, a scraper replaying requests, a bot that fetches pages
   without running scripts but still happens to hit these URLs) has no
   client-side gate to pass through, so it's checked again here by
   User-Agent. Neither check is airtight on its own; together they cover
   the common cases cheaply without an external bot-detection service. */
const BOT_UA_PATTERN = /bot|crawler|spider|slurp|googlebot|bingbot|yandex|baiduspider|duckduckbot|facebookexternalhit|twitterbot|headlesschrome|phantomjs|puppeteer|playwright|selenium|lighthouse|pingdom|uptimerobot/i;

export function isBotRequest(request) {
  const ua = request.headers.get('user-agent') || '';
  if (!ua) return true; // no UA at all is itself unusual for a real browser — treat as non-human
  return BOT_UA_PATTERN.test(ua);
}
