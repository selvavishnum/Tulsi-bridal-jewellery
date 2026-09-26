import HomeClient from './HomeClient';
import { absoluteUrl } from '@/lib/seo';

/* Server wrapper so the homepage has its own canonical and description
   (a client page can't export metadata). */
export const metadata = {
  alternates: { canonical: absoluteUrl('/') },
  openGraph: { url: absoluteUrl('/') },
};

export default function HomePage() {
  return <HomeClient />;
}
