import MarketingPreviewClient from './MarketingPreviewClient';

/* Frame for the admin's Marketing previews (hero photo, happy customers, Instagram, advertisements): an
   iframe at the device's real width, so the storefront's responsive layout applies. Shows nothing on
   its own: the admin page sends it the draft over postMessage (MarketingPreviewClient). The section is
   in the address: /marketing-preview?section=hero|testimonials|instagram|ads; for the ads the page to
   draw (shop, cart, …) comes with the draft. */
export const metadata = {
  title: 'Marketing preview',
  robots: { index: false, follow: false },
};

const SECTIONS = ['hero', 'testimonials', 'instagram', 'ads'];

export default async function MarketingPreviewPage({ searchParams }) {
  const params = (await searchParams) || {};
  const section = SECTIONS.includes(params.section) ? params.section : 'hero';
  return <MarketingPreviewClient section={section} />;
}
