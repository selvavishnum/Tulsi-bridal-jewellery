/* ─────────────────────────────────────────────
   SEO helpers — JSON-LD <script> component and site-settings loader.
   The schema builders live in seoSchema.js (pure, tested).
   ───────────────────────────────────────────── */
import { getDB, docToObj } from '@/lib/firebase';
import { buildStoreJsonLd as buildStoreFromSettings } from '@/lib/seoSchema';

export * from '@/lib/seoSchema';

/* dangerouslySetInnerHTML drops this straight into the HTML stream, so a
   product name/description containing "</script>" could otherwise break
   out of the JSON-LD block — escape the characters that matter for that.
   Uses .split/.join (not a regex literal) since a JS file that also
   contains JSX can misparse a regex starting with "<" as a JSX tag. */
function safeJsonLdString(data) {
  return JSON.stringify(data)
    .split('<').join('\\u003c')
    .split(' ').join('\\u2028')
    .split(' ').join('\\u2029');
}

export function JsonLd({ data }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdString(data) }}
    />
  );
}

export async function getSiteSettings() {
  try {
    const db = getDB();
    const doc = await db.collection('settings').doc('site').get();
    return doc.exists ? docToObj(doc) : {};
  } catch {
    return {};
  }
}

/** Store JSON-LD from the saved business settings. */
export async function buildStoreJsonLd(settings) {
  return buildStoreFromSettings(settings || await getSiteSettings());
}

/* Kept for callers of the old name. */
export const buildOrganizationJsonLd = buildStoreJsonLd;
