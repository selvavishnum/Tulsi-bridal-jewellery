import ShowcasePreviewClient from './ShowcasePreviewClient';

/* Frame for the admin's Category Showcase live preview (an iframe at the
   device's real width, so the storefront's responsive layout applies).
   Shows nothing on its own: the admin page sends it the draft settings. */
export const metadata = {
  title: 'Category showcase preview',
  robots: { index: false, follow: false },
};

export default function ShowcasePreviewPage() {
  return <ShowcasePreviewClient />;
}
