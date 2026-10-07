'use client';
/* Full-screen image viewer, shared by the product page gallery and the
   admin order view.
     • blurred dark backdrop; tap outside the photo, ✕ or Esc closes
     • pinch zooms toward your fingers, one finger pans while zoomed,
       double-tap toggles 2.5×; desktop: wheel, drag, double-click
     • sharper Cloudinary tiers load on demand: base (w_1400) shows
       instantly, w_3000 q_90 on open, w_5000 once zoomed past 2×
     • page scroll locked while open
   Props: images (urls), startIndex, productName, caption (e.g. SKU · order), onClose */
import { useEffect, useRef, useState } from 'react';
import { cldBase, cldZoom, cldDeepZoom, cldThumb } from '@/lib/cloudinaryImage';

/* ── Image Zoom Modal ──
   Tap-to-inspect for the 8000px masters. Opening it is the "zoom"
   interaction (never rendered on page load), so it fetches the w_3000
   q_90 tier for the current photo; pinching past 2× swaps in w_5000 so
   individual stones and chain links stay crisp. The already-cached base
   tier stays underneath until each sharper layer crossfades in.
   Gestures: pinch zooms toward your fingers, one finger pans while
   zoomed, double-tap toggles 2.5×; desktop: wheel zooms, drag pans,
   double-click toggles. */
const MAX_ZOOM = 5;
const DEEP_AT = 2;

export default function ImageZoomModal({ images, startIndex = 0, productName, caption = '', onClose }) {
  const [current, setCurrent] = useState(startIndex);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [loadedTier, setLoadedTier] = useState({}); // `${i}:zoom` / `${i}:deep` → true
  const stageRef = useRef(null);
  const gesture = useRef({});
  const lastTap = useRef(0);
  /* While a finger / mouse is moving the photo, follow it without easing. */
  const [interacting, setInteracting] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const needDeep = view.s >= DEEP_AT;
  /* Fetch sharper tiers for the photo on screen only, on demand. */
  useEffect(() => {
    const tiers = [['zoom', cldZoom]];
    if (needDeep) tiers.push(['deep', cldDeepZoom]);
    const cancel = [];
    for (const [name, fn] of tiers) {
      const key = `${current}:${name}`;
      if (loadedTier[key]) continue;
      let cancelled = false;
      const img = new window.Image();
      img.onload = () => { if (!cancelled) setLoadedTier((t) => ({ ...t, [key]: true })); };
      img.src = fn(images[current]);
      cancel.push(() => { cancelled = true; });
    }
    return () => cancel.forEach((c) => c());
  }, [current, images, needDeep, loadedTier]);

  const reset = () => setView({ s: 1, x: 0, y: 0 });
  const go = (i) => { reset(); setCurrent(Math.max(0, Math.min(images.length - 1, i))); };

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(current + 1);
      if (e.key === 'ArrowLeft') go(current - 1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  /* Keep the zoomed photo covering the stage — no panning into blank space. */
  function clampView(s, x, y) {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || s <= 1) return { s: 1, x: 0, y: 0 };
    const mx = (r.width * (s - 1)) / 2;
    const my = (r.height * (s - 1)) / 2;
    return { s, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  }
  /* Zoom to scale `s2`, keeping the point under (cx, cy) fixed on screen. */
  function zoomAt(s2, cx, cy, from = view) {
    const r = stageRef.current.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2);
    const py = cy - (r.top + r.height / 2);
    const s = Math.max(1, Math.min(MAX_ZOOM, s2));
    const k = s / from.s;
    return clampView(s, px - (px - from.x) * k, py - (py - from.y) * k);
  }

  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];

  function onTouchStart(e) {
    const g = gesture.current;
    setInteracting(true);
    if (e.touches.length === 2) {
      Object.assign(g, { mode: 'pinch', d0: dist(e.touches), start: view, m0: mid(e.touches) });
    } else if (e.touches.length === 1) {
      Object.assign(g, { mode: view.s > 1 ? 'pan' : 'swipe', x0: e.touches[0].clientX, y0: e.touches[0].clientY, start: view, moved: false });
    }
  }
  function onTouchMove(e) {
    const g = gesture.current;
    if (g.mode === 'pinch' && e.touches.length === 2) {
      const [mx, my] = mid(e.touches);
      const next = zoomAt(g.start.s * (dist(e.touches) / g.d0), g.m0[0], g.m0[1], g.start);
      setView(clampView(next.s, next.x + (mx - g.m0[0]), next.y + (my - g.m0[1])));
    } else if (g.mode === 'pan' && e.touches.length === 1) {
      const dx = e.touches[0].clientX - g.x0;
      const dy = e.touches[0].clientY - g.y0;
      if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
      setView(clampView(g.start.s, g.start.x + dx, g.start.y + dy));
    }
  }
  function onTouchEnd(e) {
    const g = gesture.current;
    if (g.mode === 'swipe' && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - g.x0;
      if (Math.abs(dx) > 60) { go(current + (dx < 0 ? 1 : -1)); gesture.current = {}; setInteracting(false); return; }
      /* Double-tap (phones don't fire dblclick reliably). */
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const t = e.changedTouches[0];
        setView(view.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(2.5, t.clientX, t.clientY));
        lastTap.current = 0;
      } else lastTap.current = now;
    } else if (g.mode === 'pan' && !g.moved && e.changedTouches.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) { reset(); lastTap.current = 0; } else lastTap.current = now;
    }
    if (e.touches.length === 0) { gesture.current = {}; setInteracting(false); }
  }

  /* Desktop: wheel to zoom, drag to pan, double-click to toggle. */
  function onWheel(e) {
    setView((v) => zoomAt(v.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY, v));
  }
  function onMouseDown(e) {
    if (view.s <= 1) return;
    const x0 = e.clientX; const y0 = e.clientY; const start = view;
    setInteracting(true);
    const move = (m) => setView(clampView(start.s, start.x + m.clientX - x0, start.y + m.clientY - y0));
    const up = () => { setInteracting(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
  function onDoubleClick(e) { setView(view.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(2.5, e.clientX, e.clientY)); }

  const transform = { transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})` };
  const zoomReady = loadedTier[`${current}:zoom`];
  const deepReady = loadedTier[`${current}:deep`];
  const layer = 'absolute inset-0 m-auto max-w-full max-h-full object-contain select-none will-change-transform';
  const animate = interacting ? '' : 'transition-transform duration-200 ease-out';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={productName ? `${productName} — full image` : 'Full image'}>
      {/* Gradient top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/70 to-transparent px-4 pt-4 pb-10 flex items-start justify-between">
        <div>
          <p className="text-white font-semibold text-sm line-clamp-1">{productName}</p>
          {caption && <p className="text-white/60 text-xs mt-0.5 font-mono">{caption}</p>}
          <p className="text-white/50 text-xs mt-0.5">{images.length > 1 ? `${current + 1} / ${images.length}` : ''}{view.s > 1 && `${images.length > 1 ? ' · ' : ''}${view.s.toFixed(1)}×`}</p>
        </div>
        <button onClick={onClose} aria-label="Close"
          className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm flex items-center justify-center text-white text-2xl transition leading-none">
          ×
        </button>
      </div>

      {/* Image stage */}
      <div
        ref={stageRef}
        className={`flex-1 relative overflow-hidden touch-none ${view.s > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        /* Tap / click on the backdrop (not the photo) closes it. */
        onClick={(e) => { if (e.target === e.currentTarget && view.s === 1) onClose(); }}
      >
        {/* Base tier — instant (already cached from the gallery). */}
        <img src={cldBase(images[current])} alt={`${productName} — ${current + 1}`} className={`${layer} ${animate}`} style={transform} draggable={false} decoding="async" />
        {/* w_3000 q_90 — crossfades in once loaded. */}
        <img key={`z${current}`} src={cldZoom(images[current])} alt="" aria-hidden="true"
          className={`${layer} ${animate} transition-opacity ${zoomReady ? 'opacity-100' : 'opacity-0'}`} style={transform} draggable={false} decoding="async" />
        {/* w_5000 q_90 — only once zoomed past 2×. */}
        {needDeep && (
          <img key={`d${current}`} src={cldDeepZoom(images[current])} alt="" aria-hidden="true"
            className={`${layer} ${animate} transition-opacity ${deepReady ? 'opacity-100' : 'opacity-0'}`} style={transform} draggable={false} decoding="async" />
        )}
        {(!zoomReady || (needDeep && !deepReady)) && (
          <span className="absolute top-20 left-1/2 -translate-x-1/2 z-10 bg-black/60 text-white text-[10px] px-3 py-1.5 rounded-full flex items-center gap-1.5 pointer-events-none">
            <span className="w-2.5 h-2.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            {needDeep ? 'Loading fine detail…' : 'Loading full resolution…'}
          </span>
        )}

        {current > 0 && view.s === 1 && (
          <button onClick={() => go(current - 1)} aria-label="Previous photo"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-2xl transition z-10">
            ‹
          </button>
        )}
        {current < images.length - 1 && view.s === 1 && (
          <button onClick={() => go(current + 1)} aria-label="Next photo"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-2xl transition z-10">
            ›
          </button>
        )}
        <p className={`absolute ${images.length > 1 ? 'bottom-28' : 'bottom-8'} left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1 rounded-full pointer-events-none whitespace-nowrap`}>
          {view.s > 1 ? 'Drag to look around · double-tap to reset' : 'Pinch or double-tap to zoom'}
        </p>
      </div>

      {/* Bottom: dots + thumbnails (only with several photos) */}
      {images.length > 1 && (
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pt-10 pb-5">
        <div className="flex justify-center gap-1.5 mb-3">
          {images.map((_, i) => (
            <button key={i} onClick={() => go(i)} aria-label={`Photo ${i + 1}`}
              className={`rounded-full transition-all duration-300 ${i === current ? 'w-5 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/35'}`} />
          ))}
        </div>
        {images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto justify-center pb-1 scrollbar-hide">
            {images.map((img, i) => (
              <button key={i} onClick={() => go(i)}
                className={`w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 border-2 transition-all ${i === current ? 'border-white opacity-100' : 'border-white/20 opacity-45 hover:opacity-75'}`}>
                <img src={cldThumb(img, 96)} alt={`thumb ${i + 1}`} className="w-full h-full object-cover" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
