'use client';
/* AI Model Studio: a pre-rendered model portrait for the chosen skin tone
   with the product's real cutout composited onto her, using the face
   anchors stored with the portrait. Switching tone swaps the portrait;
   the jewellery pixels are never regenerated. */
import { useEffect, useRef, useState } from 'react';
import { placeJewellery } from '@/lib/tryOn';
import { loadImage, makeCutout, drawJewellery } from '@/lib/tryOnClient';

const MAX_W = 1080;

export default function AIModelView({ productImage, cutoutReady = false, kind, model, models, adjust, canvasRef, onReadyChange }) {
  const [cutout, setCutout] = useState(null);
  const [portrait, setPortrait] = useState(null);
  const [error, setError] = useState('');
  const frame = useRef(0);

  /* Preload every tone's portrait so switching swatches is instant. */
  useEffect(() => { for (const m of models) loadImage(m.portrait).catch(() => {}); }, [models]);

  useEffect(() => {
    let live = true;
    makeCutout(productImage, { ready: cutoutReady })
      .then((c) => { if (live) setCutout(c); })
      .catch(() => { if (live) setError('Couldn’t load this piece’s photo.'); });
    return () => { live = false; };
  }, [productImage, cutoutReady]);

  useEffect(() => {
    let live = true;
    if (!model) return undefined;
    loadImage(model.portrait)
      .then((img) => { if (live) setPortrait({ img, id: model.id }); })
      .catch(() => { if (live) setError('Couldn’t load the model photo. Check your connection.'); });
    return () => { live = false; };
  }, [model]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ready = !!(canvas && cutout && portrait && model && portrait.id === model.id);
    onReadyChange?.(ready);
    if (!ready) return undefined;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const { img } = portrait;
      const k = Math.min(1, MAX_W / img.naturalWidth);
      const W = Math.round(img.naturalWidth * k);
      const H = Math.round(img.naturalHeight * k);
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      drawJewellery(ctx, cutout, placeJewellery(kind, model.anchors, { W, H }, cutout, adjust));
    });
    return () => cancelAnimationFrame(frame.current);
  }, [canvasRef, cutout, portrait, model, kind, adjust, onReadyChange]);

  const loading = !error && (!cutout || !portrait || portrait.id !== model?.id);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-b from-stone-900 to-stone-950">
      <canvas ref={canvasRef} className={`h-full w-full object-contain transition-opacity duration-300 ${loading ? 'opacity-40' : 'opacity-100'}`} />
      {loading && <div className="absolute h-10 w-10 animate-spin rounded-full border-4 border-gold-400 border-t-transparent" aria-label="Loading" />}
      {error && <p className="absolute rounded-xl bg-black/70 px-4 py-2 text-sm text-white">{error}</p>}
      {!loading && !error && (
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
          AI model · real jewellery
        </span>
      )}
      {!loading && cutout?.knockedOut && (
        <span className="pointer-events-none absolute bottom-3 left-3 right-3 text-center text-[10px] text-white/50">
          Preview made from the product photo
        </span>
      )}
    </div>
  );
}
