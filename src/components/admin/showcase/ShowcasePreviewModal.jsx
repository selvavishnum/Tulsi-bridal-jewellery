'use client';

/* Storefront preview for the Category Showcase manager.

   The real storefront section renders in an iframe (/showcase-preview) at
   the device's true width (390 / 1200 px) and is scaled down to fit, so the
   storefront's own responsive classes apply exactly. The frame receives
   the draft over same-origin postMessage: saved cards + the layout draft +
   the crop draft of the category being edited — nothing is saved until
   "Save layout" / "Save crop".

   Side panel "Crop & focus": focal point (click / drag / arrow keys),
   Cloudinary gravity, zoom, and a shape test strip showing the photo in
   every frame at once. */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { FiX, FiSmartphone, FiMonitor, FiRotateCcw, FiCheck, FiLoader, FiEyeOff, FiUpload, FiCornerUpLeft } from 'react-icons/fi';
import {
  PREVIEW_MSG, GRAVITIES, ZOOM_RANGE, DEFAULT_FOCUS, ASPECTS, LAYOUT_VARIANTS,
  isCloudinary, toStored, focusStyle,
} from '@/lib/categoryShowcase';
import { cldBase } from '@/lib/cloudinaryImage';
import { LayoutControls, ShowcasePhoto, sameFocus, SHAPE_SHORT, SHAPE_LABEL } from './parts';

const DEVICES = [
  { value: 'mobile', label: 'Mobile', width: 390, Icon: FiSmartphone },
  { value: 'desktop', label: 'Desktop', width: 1200, Icon: FiMonitor },
];
const MIN_FRAME_H = 320;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

const clampPct = (v) => Math.min(100, Math.max(0, Math.round(v)));
const round2 = (v) => Math.round(v * 100) / 100;

/* The part of the photo that stays visible in a `variant` frame, as % of
   the photo — or null when Cloudinary's AI picks the crop (auto / face)
   and only the shape test can show it. Mirrors showcaseImageUrl + focusStyle:
   object-fit cover at the focus point, then scale(zoom) about that point. */
function cropRegion(natural, variant, focus, cloudinary) {
  if (!natural) return null;
  if (cloudinary && (focus.gravity === 'auto' || focus.gravity === 'face')) return null;
  const [aw, ah] = ASPECTS[variant] || ASPECTS.square;
  const frameAspect = aw / ah;
  const photoAspect = natural.w / natural.h;
  const fw = photoAspect > frameAspect ? frameAspect / photoAspect : 1;
  const fh = photoAspect > frameAspect ? 1 : photoAspect / frameAspect;
  const [px, py] = focusStyle(focus).objectPosition.split(' ').map((v) => parseFloat(v) / 100);
  const z = focus.zoom > 1 ? focus.zoom : 1;
  return {
    left: ((1 - fw) * px + fw * px * (1 - 1 / z)) * 100,
    top: ((1 - fh) * py + fh * py * (1 - 1 / z)) * 100,
    width: (fw / z) * 100,
    height: (fh / z) * 100,
  };
}

/* ── Focal-point picker: the whole photo; click / drag / arrow keys ── */
function FocalPointPicker({ item, focus, variant, onPick, describedBy }) {
  const cloudinary = isCloudinary(item.image);
  const src = cloudinary ? cldBase(item.image, 900) : item.image;
  const [meta, setMeta] = useState({ src: '', w: 0, h: 0, failed: false });
  const loaded = meta.src === src && meta.w > 0 ? meta : null;
  const failed = meta.src === src && meta.failed;
  const dragging = useRef(false);
  const custom = focus.gravity === 'custom';
  const region = cropRegion(loaded, variant, focus, cloudinary);

  const pointAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    onPick({ gravity: 'custom', x: clampPct(((e.clientX - r.left) / r.width) * 100), y: clampPct(((e.clientY - r.top) / r.height) * 100) });
  };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 10 : 2;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onPick({ gravity: 'custom', x: clampPct(focus.x + d[0]), y: clampPct(focus.y + d[1]) });
  };

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`Focal point for ${item.label}: click or drag on the photo, or use the arrow keys`}
      aria-describedby={describedBy}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragging.current = true;
        pointAt(e);
      }}
      onPointerMove={(e) => { if (dragging.current) pointAt(e); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onKeyDown={onKeyDown}
      className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
    >
      {failed ? (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-gray-400">
          <span className="text-3xl" aria-hidden="true">{item.emoji}</span>
          The photo didn&apos;t load here — you can still set the point.
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={`${item.label} category photo`}
          draggable={false}
          onLoad={(e) => setMeta({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight, failed: false })}
          onError={() => setMeta({ src, w: 0, h: 0, failed: true })}
          className="pointer-events-none block h-auto w-full"
        />
      )}
      {region && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute border-2 border-white/90 transition-[left,top,width,height] duration-75 ${variant === 'circle' ? 'rounded-full' : 'rounded-md'}`}
          style={{ left: `${region.left}%`, top: `${region.top}%`, width: `${region.width}%`, height: `${region.height}%`, boxShadow: '0 0 0 9999px rgba(17, 24, 39, 0.45)' }}
        />
      )}
      {custom && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0">
          <span className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${focus.x}%` }} />
          <span className="absolute inset-x-0 h-px bg-white/70" style={{ top: `${focus.y}%` }} />
          <span className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${focus.x}%`, top: `${focus.y}%` }}>
            <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500 ring-1 ring-white" />
          </span>
        </span>
      )}
    </div>
  );
}

function Slider({ label, value, display, min, max, step, disabled, onChange }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={`mb-1 flex items-center justify-between text-xs font-medium ${disabled ? 'text-gray-400' : 'text-gray-600'}`}>
        <span>{label}</span><span className="tabular-nums text-gray-400">{display}</span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer rounded accent-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40" />
    </div>
  );
}

/* ── Modal ── */

/**
 * The category showcase's preview, and — with `preview` — any other photo section's
 * (hero, testimonials, Instagram, advertisements: src/components/admin/marketing).
 *
 * Without `preview` it is exactly the showcase's: the frame is /showcase-preview and it is sent
 * { type: PREVIEW_MSG, showcase }. With it the section describes itself:
 *   src      the iframe page, e.g. '/marketing-preview?section=hero'
 *   title    the iframe's accessible title
 *   message  the postMessage type (the frame answers '<message>-ready' and '<message>-height')
 *   build    ({ items, layout }) => the data the frame draws (items already carry the crop draft)
 *   note     the line under the heading (what the frame shows)
 *   itemLabel  what an item is called in the picker ("Photo", "Review", "Post", "Ad")
 *   layoutProps  { shapes, modes, sizes } passed to LayoutControls
 *   extraControls  a node shown next to the layout controls (the advertisements' "Page" picker)
 * `showcase` is then just { items } in the showcase's item shape ({ key, label, image, focus, isActive, emoji, color }).
 */
export default function ShowcasePreviewModal({
  showcase, layout, onLayoutChange, layoutDirty, savingLayout, onSaveLayout,
  initialKey, onSaveFocus, onClose, preview = null,
}) {
  const messageType = preview?.message || PREVIEW_MSG;
  const itemNoun = preview?.itemLabel || 'Category';
  const uid = useId();
  const titleId = `${uid}-title`;
  const pickerHintId = `${uid}-picker-hint`;
  const [device, setDevice] = useState('mobile');
  const [selectedKey, setSelectedKey] = useState(initialKey);
  const [focusDraft, setFocusDraft] = useState(null); // { key, focus } | null
  const [savingCrop, setSavingCrop] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [frameHeight, setFrameHeight] = useState(MIN_FRAME_H);
  const [stageWidth, setStageWidth] = useState(0);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const iframeRef = useRef(null);
  const stageRef = useRef(null);
  const draftRef = useRef(null);
  const requestCloseRef = useRef(null);
  const messageForRef = useRef(null);

  const selected = showcase.items.find((it) => it.key === selectedKey) || showcase.items[0];
  const savedFocus = selected.focus;
  const focus = focusDraft && focusDraft.key === selected.key ? focusDraft.focus : savedFocus;
  const cropDirty = !sameFocus(focus, savedFocus);
  const custom = focus.gravity === 'custom';
  const cloudinary = isCloudinary(selected.image);

  /* What the frame renders: saved cards + layout draft + this crop draft. */
  const draft = useMemo(() => {
    const items = showcase.items.map((it) => (it.key === selected.key ? { ...it, focus } : it));
    return preview ? preview.build({ items, layout }) : toStored({ ...showcase, layout, items });
  }, [showcase, layout, selected.key, focus, preview]);
  /* What goes over postMessage for a draft. */
  const messageFor = (data) => (preview ? { type: messageType, data } : { type: messageType, showcase: data });

  const dev = DEVICES.find((d) => d.value === device);
  const scale = stageWidth > 0 ? Math.min(1, stageWidth / dev.width) : 1;

  function requestClose() {
    if (cropDirty && !window.confirm(`Discard your unsaved crop changes for ${selected.label}?`)) return;
    onClose();
  }

  function selectCategory(key) {
    if (key === selected.key) return;
    if (cropDirty && !window.confirm(`Discard your unsaved crop changes for ${selected.label}?`)) return;
    setFocusDraft(null);
    setSelectedKey(key);
  }

  function editFocus(patch) {
    setFocusDraft((d) => ({ key: selected.key, focus: { ...(d && d.key === selected.key ? d.focus : savedFocus), ...patch } }));
  }

  async function saveCrop() {
    const key = selected.key;
    const sent = focus;
    setSavingCrop(true);
    try {
      await onSaveFocus(key, sent);
      /* Keep editing that happened while saving. */
      setFocusDraft((d) => (d && d.key === key && sameFocus(d.focus, sent) ? null : d));
      toast.success(`Crop saved for ${selected.label}`);
    } catch (e) {
      toast.error(e.message || 'Could not save the crop');
    } finally {
      setSavingCrop(false);
    }
  }

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { messageForRef.current = messageFor; });
  useEffect(() => { requestCloseRef.current = requestClose; });

  /* Open: lock page scroll, focus Close; on close give focus back. */
  useEffect(() => {
    const opener = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, []);

  /* Esc closes; Tab stays inside the dialog. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); requestCloseRef.current?.(); return; }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const els = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* Messages from the preview frame (same origin, that iframe only). */
  useEffect(() => {
    const origin = window.location.origin;
    const onMessage = (e) => {
      const frame = iframeRef.current?.contentWindow;
      if (!frame || e.source !== frame || e.origin !== origin) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === `${messageType}-ready`) {
        if (draftRef.current) frame.postMessage(messageForRef.current(draftRef.current), origin);
        setFrameReady(true);
      } else if (d.type === `${messageType}-height`) {
        const h = Number(d.height);
        if (Number.isFinite(h)) setFrameHeight(Math.min(20000, Math.max(MIN_FRAME_H, Math.ceil(h))));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [messageType]);

  /* Every draft change goes to the frame. */
  useEffect(() => {
    if (!frameReady) return;
    iframeRef.current?.contentWindow?.postMessage(messageForRef.current(draft), window.location.origin);
  }, [draft, frameReady]);

  /* Room for the device: scale = available width / device width. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setStageWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-gray-900/60 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(94vh,1000px)] sm:max-w-[1440px] sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate font-bold text-gray-800">Storefront preview</h2>
            <p className="hidden text-xs text-gray-400 sm:block">{preview?.note || 'Exactly what shoppers see on the homepage — nothing is saved until you click Save.'}</p>
          </div>
          <div role="group" aria-label="Device" className="inline-flex flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {DEVICES.map(({ value, label, width, Icon }) => (
              <button key={value} type="button" aria-pressed={device === value} onClick={() => setDevice(value)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${device === value ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                <Icon aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{label}</span>
                <span className="sr-only md:not-sr-only md:font-normal md:text-gray-400">{width} px</span>
              </button>
            ))}
          </div>
          <button ref={closeRef} type="button" onClick={requestClose} aria-label="Close preview"
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
            <FiX className="text-lg" aria-hidden="true" />
          </button>
        </div>

        {/* Phones: toolbar, stage and panel scroll together under the header.
            lg: toolbar fixed, stage and panel scroll side by side. */}
        <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:flex-col lg:overflow-hidden">
          {/* Layout toolbar (same draft as the bar on the page) */}
          <div className={`flex flex-shrink-0 flex-wrap items-end justify-between gap-3 border-b px-4 py-2.5 ${layoutDirty ? 'border-amber-100 bg-amber-50/50' : 'border-gray-100 bg-stone-50'}`}>
            <LayoutControls layout={layout} onChange={onLayoutChange} compact {...(preview?.layoutProps || {})} />
            {preview?.extraControls}
            {layoutDirty && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-amber-800">Unsaved layout</span>
                <button type="button" onClick={onSaveLayout} disabled={savingLayout}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 disabled:opacity-60">
                  {savingLayout ? <FiLoader className="animate-spin" aria-hidden="true" /> : <FiCheck aria-hidden="true" />}
                  {savingLayout ? 'Saving…' : 'Save layout'}
                </button>
              </div>
            )}
          </div>

          <div className="lg:flex lg:min-h-0 lg:flex-1">
            {/* Stage */}
            <div ref={stageRef} className="bg-stone-100 p-3 sm:p-5 lg:min-w-0 lg:flex-1 lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
              <div className="mx-auto" style={{ width: Math.round(dev.width * scale) }}>
                <div className="mb-2 flex items-center justify-between text-[11px] text-gray-500">
                  <span className="font-semibold">{dev.label} · {dev.width} px wide</span>
                  <span className="tabular-nums">{scale < 1 ? `shown at ${Math.round(scale * 100)}%` : 'actual size'}</span>
                </div>
                <div className={`overflow-hidden bg-white shadow-lg ring-1 ring-black/10 ${device === 'mobile' ? 'rounded-[20px]' : 'rounded-lg'}`}>
                  {device === 'desktop' ? (
                    <div className="flex h-7 items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3" aria-hidden="true">
                      <span className="h-2 w-2 rounded-full bg-red-300" /><span className="h-2 w-2 rounded-full bg-amber-300" /><span className="h-2 w-2 rounded-full bg-green-300" />
                      <span className="ml-3 h-4 flex-1 max-w-xs rounded bg-white text-[10px] leading-4 text-gray-400 px-2 truncate">tulsijewels.in</span>
                    </div>
                  ) : (
                    <div className="flex h-6 items-center justify-center bg-white" aria-hidden="true"><span className="h-1.5 w-16 rounded-full bg-gray-200" /></div>
                  )}
                  <div className="relative overflow-hidden" style={{ width: Math.round(dev.width * scale), height: Math.round(frameHeight * scale) }}>
                    <iframe
                      ref={iframeRef}
                      src={preview?.src || '/showcase-preview'}
                      title={preview?.title || 'Category showcase preview'}
                      className="absolute left-0 top-0 block border-0 bg-white"
                      style={{ width: dev.width, height: frameHeight, transform: `scale(${scale})`, transformOrigin: '0 0' }}
                    />
                    {!frameReady && (
                      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white text-xs font-medium text-gray-400" role="status">
                        <FiLoader className="animate-spin" aria-hidden="true" /> Loading preview…
                      </div>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-center text-[11px] text-gray-400">Links are inactive in the preview.</p>
              </div>
            </div>

            {/* Crop & focus */}
            <aside aria-labelledby={`${uid}-crop`} className="border-t border-gray-100 lg:flex lg:w-[380px] lg:flex-shrink-0 lg:flex-col lg:border-l lg:border-t-0">
              <div className="space-y-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                <div className="flex items-center justify-between gap-2">
                  <h3 id={`${uid}-crop`} className="font-bold text-gray-800">Crop &amp; focus</h3>
                  {cropDirty && <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Unsaved crop</span>}
                </div>

                <div role="group" aria-label={itemNoun} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
                  {showcase.items.map((it) => {
                    const on = it.key === selected.key;
                    return (
                      <button key={it.key} type="button" aria-pressed={on} onClick={() => selectCategory(it.key)}
                        title={it.isActive ? it.label : `${it.label} (hidden)`}
                        className={`flex w-[54px] flex-shrink-0 flex-col items-center gap-1 rounded-lg p-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${on ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                        <ShowcasePhoto item={it} variant="circle" width={120} sizes="44px" emojiClass="text-lg"
                          className={`w-11 border-2 ${on ? 'border-amber-500' : 'border-gray-100'} ${it.isActive ? '' : 'opacity-50'}`} />
                        <span className={`w-full truncate text-center text-[10px] font-semibold leading-tight ${on ? 'text-amber-800' : 'text-gray-500'}`}>{it.label}</span>
                      </button>
                    );
                  })}
                </div>

                {!selected.isActive && (
                  <p className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    <FiEyeOff className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                    {selected.label} is hidden on the homepage, so it isn&apos;t in the preview. You can still set its crop.
                  </p>
                )}

                {!selected.image ? (
                  <div className="rounded-xl border-2 border-dashed border-gray-200 px-4 py-8 text-center">
                    <span className="text-3xl" aria-hidden="true">{selected.emoji}</span>
                    <p className="mt-2 text-sm font-semibold text-gray-700">Upload a photo first</p>
                    <p className="text-xs text-gray-400 mt-1">Close the preview and use <FiUpload className="inline" aria-hidden="true" /> Upload on the {selected.label} card. The homepage shows the icon until then.</p>
                  </div>
                ) : (
                  <>
                    <div>
                      <FocalPointPicker item={selected} focus={focus} variant={layout.layoutVariant} onPick={editFocus} describedBy={pickerHintId} />
                      <p id={pickerHintId} className="text-xs text-gray-400 mt-1.5">
                        {custom
                          ? `Focus ${focus.x}% across, ${focus.y}% down. The bright area is what the ${SHAPE_LABEL[layout.layoutVariant]} frame shows.`
                          : cloudinary && (focus.gravity === 'auto' || focus.gravity === 'face')
                            ? 'Cloudinary picks the crop — check the shape test below. Click the photo to pin a point yourself.'
                            : `The bright area is what the ${SHAPE_LABEL[layout.layoutVariant]} frame shows. Click the photo to pin a point.`}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-1.5">Crop gravity</p>
                      <div role="group" aria-label="Crop gravity" className="flex flex-wrap gap-1.5">
                        {GRAVITIES.map((g) => {
                          const on = focus.gravity === g.value;
                          return (
                            <button key={g.value} type="button" aria-pressed={on} onClick={() => editFocus({ gravity: g.value })}
                              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${on ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-amber-300 hover:text-amber-700'}`}>
                              {g.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-400 mt-1.5">
                        Auto lets Cloudinary&apos;s AI find the jewellery and keep it in the frame for every shape.
                        {!cloudinary && ' This photo isn’t on Cloudinary, so Auto and Face crop from the centre.'}
                      </p>
                    </div>

                    <div className="space-y-3">
                      <Slider label="Horizontal (X)" value={focus.x} display={`${focus.x}%`} min={0} max={100} step={1} disabled={!custom}
                        onChange={(v) => editFocus({ x: clampPct(v) })} />
                      <Slider label="Vertical (Y)" value={focus.y} display={`${focus.y}%`} min={0} max={100} step={1} disabled={!custom}
                        onChange={(v) => editFocus({ y: clampPct(v) })} />
                      {!custom && <p className="-mt-1 text-[11px] text-gray-400">X / Y apply to Custom point.</p>}
                      <Slider label="Zoom" value={focus.zoom} display={`${focus.zoom.toFixed(2)}×`} min={ZOOM_RANGE.min} max={ZOOM_RANGE.max} step={0.05}
                        onChange={(v) => editFocus({ zoom: round2(Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, v))) })} />
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-2">Shape test <span className="font-normal text-gray-400">— nothing important should be cut off</span></p>
                      <div className="grid grid-cols-4 items-end gap-2">
                        {LAYOUT_VARIANTS.map((v) => {
                          const current = v.value === layout.layoutVariant;
                          return (
                            <div key={v.value} className="min-w-0 text-center">
                              <ShowcasePhoto item={selected} variant={v.value} focus={focus} width={240} sizes="90px"
                                className={`border ${current ? 'border-amber-300 ring-2 ring-amber-400 ring-offset-1' : 'border-gray-200'}`} />
                              <p className={`mt-1 truncate text-[11px] font-semibold ${current ? 'text-amber-700' : 'text-gray-500'}`}>{SHAPE_SHORT[v.value]}</p>
                              <p className={`text-[10px] ${current ? 'text-amber-600' : 'text-transparent'}`} aria-hidden={!current}>Current</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {selected.image && (
                <div className="sticky bottom-0 flex flex-shrink-0 items-center gap-2 border-t border-gray-100 bg-white px-4 py-3 lg:static">
                  <button type="button" onClick={() => editFocus({ ...DEFAULT_FOCUS })} disabled={sameFocus(focus, DEFAULT_FOCUS) || savingCrop}
                    title="Back to Auto (AI), zoom 1×"
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-40">
                    <FiRotateCcw aria-hidden="true" /> Reset
                  </button>
                  <button type="button" onClick={() => setFocusDraft(null)} disabled={!cropDirty || savingCrop}
                    title="Back to the saved crop"
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-40">
                    <FiCornerUpLeft aria-hidden="true" /> Revert
                  </button>
                  <button type="button" onClick={saveCrop} disabled={!cropDirty || savingCrop}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 disabled:opacity-50">
                    {savingCrop ? <FiLoader className="animate-spin" aria-hidden="true" /> : <FiCheck aria-hidden="true" />}
                    {savingCrop ? 'Saving…' : 'Save crop'}
                  </button>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
