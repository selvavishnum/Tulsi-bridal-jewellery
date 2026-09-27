'use client';
/* Virtual Try-On: two modes over one canvas.
     • AI Virtual Model — a model portrait per skin tone with the real
       jewellery composited on (no camera needed; default when set up).
     • Live AR Camera — the shopper's own face, tracked live.
   Save / WhatsApp / Add to Cart act on whichever canvas is showing. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiX, FiDownload, FiShoppingCart, FiRotateCcw, FiUser, FiCamera } from 'react-icons/fi';
import { SKIN_TONES, ADJUST, clampAdjust } from '@/lib/tryOn';
import { drawCredit } from '@/lib/tryOnClient';
import AIModelView from './AIModelView';
import LiveCameraView from './LiveCameraView';

const TONE_KEY = 'tulsi-tryon-tone';
const KIND_LABEL = { earring: 'Earrings', necklace: 'Necklace', choker: 'Choker' };

let modelsPromise = null;
function fetchModels() {
  modelsPromise ||= fetch('/api/try-on/models').then((r) => r.json()).then((d) => (d.success ? d.data : []))
    .catch(() => { modelsPromise = null; return []; });
  return modelsPromise;
}

function readTone() {
  try { return localStorage.getItem(TONE_KEY); } catch { return null; }
}
function rememberTone(id) {
  try { localStorage.setItem(TONE_KEY, id); } catch { /* private mode */ }
}

const WaIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35zM12 21.82a9.8 9.8 0 0 1-5.03-1.39l-.36-.21-3.72.97 1-3.62-.24-.37A9.8 9.8 0 0 1 2.18 12 9.82 9.82 0 1 1 12 21.82zM12 0a12 12 0 0 0-10.46 17.87L.06 23.43a.5.5 0 0 0 .62.61l5.76-1.5A12 12 0 1 0 12 0z" /></svg>
);

export default function TryOnModal({ productImage, cutoutReady = false, productName, category = 'earring', productUrl, inStock = true, onAddToCart, onClose }) {
  const kind = KIND_LABEL[category] ? category : 'earring';
  const canvasRef = useRef(null);
  const [models, setModels] = useState(null); // null while loading
  const [mode, setMode] = useState(null); // 'ai' | 'live'
  const [toneId, setToneId] = useState(null);
  const [adjust, setAdjust] = useState({ scale: 1, offset: 0 });
  const adjustRef = useRef(adjust);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { adjustRef.current = adjust; }, [adjust]);

  useEffect(() => {
    let live = true;
    fetchModels().then((list) => {
      if (!live) return;
      setModels(list);
      setMode((m) => m || (list.length ? 'ai' : 'live'));
      const saved = readTone();
      setToneId(list.find((t) => t.id === saved)?.id || list.find((t) => t.id === 'wheatish')?.id || list[0]?.id || null);
    });
    return () => { live = false; };
  }, []);

  /* Lock page scroll while open; Esc closes. */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const model = useMemo(() => models?.find((m) => m.id === toneId) || null, [models, toneId]);

  function switchMode(next) {
    if (next === mode) return;
    setReady(false);
    setAdjust({ scale: 1, offset: 0 });
    setMode(next);
  }
  function pickTone(id) {
    setToneId(id);
    rememberTone(id);
  }
  const setAdj = (k) => (e) => setAdjust((a) => clampAdjust({ ...a, [k]: Number(e.target.value) }));

  /* The look as a PNG, with a small credit in the corner. */
  const snapshot = useCallback(() => new Promise((resolve, reject) => {
    const src = canvasRef.current;
    if (!src?.width) { reject(new Error('Nothing to save yet')); return; }
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);
    drawCredit(ctx, out.width, out.height, mode === 'ai' ? 'AI model · tulsijewels.in' : 'tulsijewels.in');
    try {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png');
    } catch (e) {
      reject(e);
    }
  }), [mode]);

  const fileName = `${(productName || 'tulsi-look').replace(/[^\w-]+/g, '-').toLowerCase()}-look.png`;

  function download(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function save() {
    try {
      download(await snapshot());
      toast.success('Look saved to your device');
    } catch {
      toast.error('Couldn’t save this look.');
    }
  }

  async function share() {
    const text = `Check out ${productName || 'this piece'} on Tulsi Jewels 💍 ${productUrl || ''}`.trim();
    setBusy(true);
    try {
      const blob = await snapshot();
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, title: productName });
        return;
      }
      /* Desktop / older phones: save the photo, open WhatsApp with the link. */
      download(blob);
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      toast('Photo saved — attach it in WhatsApp', { icon: '📎' });
    } catch (e) {
      if (e?.name !== 'AbortError') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  }

  function addToCart() {
    onAddToCart?.();
  }

  const aiAvailable = !!models?.length;

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-stone-950 text-white" role="dialog" aria-modal="true" aria-label="Virtual try-on">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gold-300">Virtual Try-On · {KIND_LABEL[kind]}</p>
          <p className="truncate text-sm font-semibold">{productName}</p>
        </div>
        <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close try-on">
          <FiX size={18} />
        </button>
      </div>

      {/* Mode switcher */}
      <div className="px-4 pb-3">
        <div className="grid grid-cols-2 rounded-xl bg-white/10 p-1 text-sm font-semibold" role="tablist">
          {[
            ['live', 'Live AR Camera', FiCamera, true],
            ['ai', 'AI Virtual Model', FiUser, aiAvailable],
          ].map(([id, label, Icon, enabled]) => (
            <button key={id} role="tab" aria-selected={mode === id} disabled={!enabled && models !== null} onClick={() => switchMode(id)}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 transition-colors ${mode === id ? 'bg-white text-stone-900 shadow' : 'text-white/75 hover:text-white disabled:opacity-40'}`}>
              <Icon aria-hidden /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Stage */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {mode === 'ai' && model && (
          <AIModelView productImage={productImage} cutoutReady={cutoutReady} kind={kind} model={model} models={models} adjust={adjust} canvasRef={canvasRef} onReadyChange={setReady} />
        )}
        {mode === 'live' && (
          <LiveCameraView productImage={productImage} cutoutReady={cutoutReady} kind={kind} canvasRef={canvasRef} adjustRef={adjustRef} onReadyChange={setReady} />
        )}
        {mode === null && <div className="flex h-full items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-gold-400 border-t-transparent" /></div>}
      </div>

      {/* Controls sheet */}
      <div className="space-y-3 rounded-t-3xl bg-stone-900 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-8px_30px_rgba(0,0,0,0.4)]">
        {mode === 'ai' && aiAvailable && (
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/50">Skin tone</p>
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="radiogroup" aria-label="Model skin tone">
              {SKIN_TONES.map((t) => {
                const has = models.some((m) => m.id === t.id);
                const on = toneId === t.id;
                return (
                  <button key={t.id} role="radio" aria-checked={on} disabled={!has} onClick={() => pickTone(t.id)}
                    className={`flex min-w-[5.5rem] flex-1 touch-manipulation items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${on ? 'border-gold-400 bg-white/10' : 'border-white/15 hover:border-white/40'} disabled:opacity-30`}>
                    <span className={`h-6 w-6 flex-shrink-0 rounded-full ring-2 ${on ? 'ring-gold-400' : 'ring-white/20'}`} style={{ background: t.hex }} />
                    <span className="whitespace-nowrap">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-white/50">Size</span>
            <input type="range" min={ADJUST.scale.min} max={ADJUST.scale.max} step={ADJUST.scale.step} value={adjust.scale} onChange={setAdj('scale')}
              className="h-8 w-full touch-manipulation accent-gold-400" aria-valuetext={`${Math.round(adjust.scale * 100)}%`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-white/50">Position</span>
            <input type="range" min={ADJUST.offset.min} max={ADJUST.offset.max} step={ADJUST.offset.step} value={adjust.offset} onChange={setAdj('offset')}
              className="h-8 w-full touch-manipulation accent-gold-400" aria-label="Move up or down" />
          </label>
          <button onClick={() => setAdjust({ scale: 1, offset: 0 })} className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Reset size and position">
            <FiRotateCcw size={14} />
          </button>
        </div>

        <div className="grid grid-cols-[auto_auto_1fr] gap-2">
          <button onClick={save} disabled={!ready} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold hover:bg-white/20 disabled:opacity-40" aria-label="Save photo">
            <FiDownload /> <span className="hidden sm:inline">Save</span>
          </button>
          <button onClick={share} disabled={!ready || busy} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 text-sm font-semibold text-white disabled:opacity-40" aria-label="Share on WhatsApp">
            <WaIcon /> <span className="hidden sm:inline">WhatsApp</span>
          </button>
          <button onClick={addToCart} disabled={!inStock} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-gold-500 text-sm font-bold text-stone-900 hover:bg-gold-400 disabled:opacity-40">
            <FiShoppingCart /> {inStock ? 'Add to Cart' : 'Out of stock'}
          </button>
        </div>
      </div>
    </div>
  );
}
