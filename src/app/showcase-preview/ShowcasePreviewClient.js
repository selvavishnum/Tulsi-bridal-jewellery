'use client';

/* Receives { type: 'tj-showcase-preview', showcase } from the admin page
   that embeds it (same origin only), renders the real storefront section,
   and reports its height back so the admin can size the frame. Links are
   inert here: a preview click must not navigate the frame. */
import { useEffect, useRef, useState } from 'react';
import CategoryShowcase from '@/components/home/CategoryShowcase';
import { normalizeShowcase, PREVIEW_MSG } from '@/lib/categoryShowcase';

export default function ShowcasePreviewClient() {
  const [showcase, setShowcase] = useState(null);
  const root = useRef(null);

  useEffect(() => {
    const parent = window.parent;
    if (!parent || parent === window) return undefined;
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== parent) return;
      if (e.data?.type !== PREVIEW_MSG || !e.data.showcase) return;
      /* Re-normalized: only known cards and valid values get rendered. */
      setShowcase(normalizeShowcase({ categoryShowcase: e.data.showcase }));
    };
    window.addEventListener('message', onMessage);
    parent.postMessage({ type: `${PREVIEW_MSG}-ready` }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /* Report the content height whenever it changes. */
  useEffect(() => {
    const el = root.current;
    if (!el || window.parent === window) return undefined;
    const send = () => window.parent.postMessage({ type: `${PREVIEW_MSG}-height`, height: Math.ceil(el.getBoundingClientRect().height) }, window.location.origin);
    const ro = new ResizeObserver(send);
    ro.observe(el);
    send();
    return () => ro.disconnect();
  }, [showcase]);

  /* Clicks on the cards would navigate the frame away. */
  useEffect(() => {
    const stop = (e) => { if (e.target.closest?.('a')) e.preventDefault(); };
    document.addEventListener('click', stop, true);
    return () => document.removeEventListener('click', stop, true);
  }, []);

  return (
    <div ref={root} className="bg-white">
      {showcase
        ? (visibleCount(showcase)
          ? <CategoryShowcase showcase={showcase} headingId="preview-shop-by-category" />
          : <p className="py-16 text-center text-sm text-stone-500">Every category is hidden — the homepage skips this section.</p>)
        : <p className="py-16 text-center text-sm text-stone-400">Loading preview…</p>}
    </div>
  );
}

const visibleCount = (s) => s.items.filter((i) => i.isActive).length;
