'use client';

/* Receives { type: 'tj-marketing-preview', data: { section, items, layout, placement? } } from the admin
   page that embeds it (same origin only), draws the REAL storefront section with that draft, and reports
   its height back so the admin can size the frame (the same protocol as /showcase-preview). Links are
   inert here: a preview click must not navigate the frame. Nothing is read from or written to the
   database — it only draws what the admin sends. */
import { useEffect, useRef, useState } from 'react';
import { HeroSection, CustomerReviews, InstagramTiles } from '@/app/HomeClient';
import { pickHeroSlides, pickTestimonials, heroPhotos } from '@/lib/heroSlides';
import { normalizeLayout, visible } from '@/lib/marketing';

const TYPE = 'tj-marketing-preview';

function Preview({ section, data }) {
  const layout = normalizeLayout(data.layout, section);
  const items = Array.isArray(data.items) ? data.items : [];
  if (section === 'hero') {
    const photos = heroPhotos(pickHeroSlides(items), layout);
    return <HeroSection photos={photos} layout={layout} shippingLabel="" />;
  }
  if (section === 'testimonials') {
    const reviews = pickTestimonials(items);
    return reviews.length
      ? <CustomerReviews reviews={reviews} layout={layout} />
      : <Empty>Every review is hidden (or has no words) — the homepage skips the “Happy Customers” section.</Empty>;
  }
  if (section === 'instagram') {
    const posts = visible(items, 'instagram').slice(0, 6);
    return posts.length
      ? (
        <section className="bg-white py-10">
          <div className="section-container">
            <InstagramTiles posts={posts} layout={layout} igUrl="https://www.instagram.com/" />
          </div>
        </section>
      )
      : <Empty>Every post is hidden (or has no photo) — the homepage shows the Follow button only.</Empty>;
  }
  return <Empty>Nothing to preview for “{section}”.</Empty>;
}

const Empty = ({ children }) => <p className="px-6 py-16 text-center text-sm text-stone-500">{children}</p>;

export default function MarketingPreviewClient({ section }) {
  const [data, setData] = useState(null);
  const root = useRef(null);

  useEffect(() => {
    const parent = window.parent;
    if (!parent || parent === window) return undefined;
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== parent) return;
      if (e.data?.type !== TYPE || !e.data.data || typeof e.data.data !== 'object') return;
      setData(e.data.data);
    };
    window.addEventListener('message', onMessage);
    parent.postMessage({ type: `${TYPE}-ready` }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /* Report the content height whenever it changes. */
  useEffect(() => {
    const el = root.current;
    if (!el || window.parent === window) return undefined;
    const send = () => window.parent.postMessage({ type: `${TYPE}-height`, height: Math.ceil(el.getBoundingClientRect().height) }, window.location.origin);
    const ro = new ResizeObserver(send);
    ro.observe(el);
    send();
    return () => ro.disconnect();
  }, [data]);

  /* Clicks on the photos would navigate the frame away. */
  useEffect(() => {
    const stop = (e) => { if (e.target.closest?.('a')) e.preventDefault(); };
    document.addEventListener('click', stop, true);
    return () => document.removeEventListener('click', stop, true);
  }, []);

  return (
    <div ref={root} className="bg-white">
      {data ? <Preview section={section} data={data} /> : <p className="py-16 text-center text-sm text-stone-400">Loading preview…</p>}
    </div>
  );
}
