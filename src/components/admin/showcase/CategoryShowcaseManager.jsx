'use client';

/* Admin › Settings › Marketing — "Category Showcase": the homepage
   "Shop by Category" cards.

   - Layout bar: Shape / Display mode / Density edit a layout DRAFT (the
     cards below already use the draft shape); "Save layout" sends it.
   - Each card: show/hide switch, Featured (King Size slot), order, photo,
     and a live storefront preview with crop & focus controls.
   Card changes save instantly and on their own (PATCH with only the field
   that changed); a failed save puts that one field back. The page's
   global "Save Settings" does not touch any of this. */
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  FiEye, FiEyeOff, FiChevronLeft, FiChevronRight, FiUpload, FiTrash2,
  FiRefreshCw, FiAlertTriangle, FiCheck, FiLoader,
} from 'react-icons/fi';
import { GiQueenCrown } from 'react-icons/gi';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { fetchShowcase, patchShowcase } from './api';
import { createFieldSync } from './fieldSync';
import { LayoutControls, ShowcasePhoto, sameLayout } from './parts';
import ShowcasePreviewModal from './ShowcasePreviewModal';

/* 2 columns until the sidebar leaves room for 3, all 6 in a row on wide screens. */
const GRID = 'grid grid-cols-2 gap-3 lg:grid-cols-3 min-[1360px]:grid-cols-6';
const CARD_SIZES = '(min-width: 1360px) 180px, (min-width: 1024px) 300px, 45vw';

function withItem(showcase, key, patch) {
  return { ...showcase, items: showcase.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) };
}
function withOrder(showcase, keys) {
  const pos = new Map(keys.map((k, i) => [k, i]));
  const items = [...showcase.items].sort((a, b) => pos.get(a.key) - pos.get(b.key)).map((it, i) => ({ ...it, displayOrder: i }));
  return { ...showcase, items };
}

/* ── Pieces ── */

function VisibilitySwitch({ on, label, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Show ${label} on homepage`}
      title={on ? 'Visible on the homepage — click to hide' : 'Hidden — click to show on the homepage'}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${on ? 'bg-green-500' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function StatusBadge({ on }) {
  return on ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" /> Visible on Home
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
      <FiEyeOff className="text-[10px]" aria-hidden="true" /> Hidden
    </span>
  );
}

const iconBtn = 'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:border-amber-300 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-gray-500';

const moveId = (key, dir) => `showcase-move-${key}-${dir < 0 ? 'earlier' : 'later'}`;

function CategoryCard({ item, index, count, variant, uploading, onToggleActive, onToggleFeatured, onMove, onPreview, onPickFile, onRemovePhoto }) {
  const fileRef = useRef(null);
  const { key, label } = item;
  return (
    <li className={`flex min-w-0 flex-col rounded-xl border bg-white p-2.5 transition-opacity duration-200 sm:p-3 ${item.isActive ? '' : 'opacity-60'} ${item.isFeatured ? 'border-amber-300 shadow-sm shadow-amber-100' : 'border-gray-200'}`}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button type="button" id={moveId(key, -1)} className={iconBtn} disabled={index === 0}
            onClick={() => onMove(key, -1)} aria-label={`Move ${label} earlier`} title="Move earlier">
            <FiChevronLeft aria-hidden="true" />
          </button>
          <button type="button" id={moveId(key, 1)} className={iconBtn} disabled={index === count - 1}
            onClick={() => onMove(key, 1)} aria-label={`Move ${label} later`} title="Move later">
            <FiChevronRight aria-hidden="true" />
          </button>
        </div>
        <VisibilitySwitch on={item.isActive} label={label} onToggle={() => onToggleActive(item)} />
      </div>

      <div className="relative">
        <span className="absolute left-1.5 top-1.5 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-white/90 px-1 text-[11px] font-bold text-gray-600 shadow-sm ring-1 ring-black/5" title={`Position ${index + 1} of ${count}`}>
          <span className="sr-only">Position </span>{index + 1}
        </span>
        {/* The photo opens the preview too (the eye button is the keyboard path). */}
        <button type="button" tabIndex={-1} onClick={() => onPreview(key)} aria-label={`Preview ${label}`}
          className={`group relative block w-full cursor-zoom-in focus:outline-none ${variant === 'circle' ? 'mx-auto max-w-[85%]' : ''}`}>
          <ShowcasePhoto item={item} variant={variant} sizes={CARD_SIZES}
            className={`border transition group-hover:shadow-md ${item.isFeatured ? 'border-amber-300 ring-2 ring-amber-300' : 'border-gray-100'}`} />
          {uploading && (
            <span className={`absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-semibold text-amber-700 ${variant === 'circle' ? 'rounded-full' : 'rounded-xl'}`}>
              <FiLoader className="mr-1 animate-spin" aria-hidden="true" /> Uploading…
            </span>
          )}
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-1">
        <h3 className="flex min-w-0 items-center gap-1 font-sans text-sm font-semibold text-gray-800">
          <span className="truncate">{label}</span>
          {item.isFeatured && <GiQueenCrown className="flex-shrink-0 text-amber-500" aria-label="Featured" />}
        </h3>
        <button type="button" className={iconBtn} onClick={() => onPreview(key)} aria-label={`Preview ${label}`} title="Preview & crop">
          <FiEye aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1"><StatusBadge on={item.isActive} /></div>

      <button
        type="button"
        aria-pressed={item.isFeatured}
        onClick={() => onToggleFeatured(item)}
        title="A featured card takes a double-size King Size slot on the homepage"
        className={`mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${item.isFeatured ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-500 hover:border-amber-300 hover:text-amber-700'}`}
      >
        <GiQueenCrown aria-hidden="true" className={item.isFeatured ? 'text-amber-500' : ''} />
        Featured<span className="sr-only"> (King Size slot)</span>
      </button>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPickFile(item, f); }} />
      <div className="mt-2 flex gap-1">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          aria-label={`${item.image ? 'Change' : 'Upload'} photo for ${label}`}
          className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-amber-500 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 disabled:opacity-60">
          {uploading ? <FiLoader className="flex-shrink-0 animate-spin" aria-hidden="true" /> : <FiUpload className="flex-shrink-0" aria-hidden="true" />}
          <span className="truncate">{uploading ? 'Uploading…' : item.image ? 'Change' : 'Upload'}</span>
        </button>
        {item.image && !uploading && (
          <button type="button" onClick={() => onRemovePhoto(item)} aria-label={`Remove photo for ${label}`} title="Remove photo"
            className="inline-flex items-center justify-center rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-500 transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
            <FiTrash2 aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      <div className="mb-5 h-20 rounded-xl bg-stone-100" />
      <div className={GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 p-3">
            <div className="mb-2 h-6 rounded bg-gray-100" />
            <div className="aspect-[4/5] rounded-xl bg-gray-100" />
            <div className="mt-2 h-4 w-2/3 rounded bg-gray-100" />
            <div className="mt-2 h-7 rounded-lg bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Manager ── */

export default function CategoryShowcaseManager() {
  const [status, setStatus] = useState('loading'); // loading | error | ready
  const [loadError, setLoadError] = useState('');
  const [showcase, setShowcase] = useState(null);
  const [draftLayout, setDraftLayout] = useState(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const [uploading, setUploading] = useState({});
  const [saving, setSaving] = useState(0);
  const [previewKey, setPreviewKey] = useState(null);
  const [loadKey, setLoadKey] = useState(0);
  const [run] = useState(createFieldSync);
  const refocus = useRef(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchShowcase(ac.signal).then(
      (data) => { setShowcase(data); setDraftLayout(data.layout); setStatus('ready'); },
      (e) => { if (!ac.signal.aborted) { setLoadError(e.message); setStatus('error'); } },
    );
    return () => ac.abort();
  }, [loadKey]);

  function retry() {
    setStatus('loading');
    setLoadKey((k) => k + 1);
  }

  const layoutDirty = status === 'ready' && !sameLayout(draftLayout, showcase.layout);

  /* Leaving the page with an unsaved layout: ask first. */
  useEffect(() => {
    if (!layoutDirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [layoutDirty]);

  /* Keep focus on the arrow that was pressed after its card moves (or on
     the other arrow once the card reaches an end). */
  useEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const btn = document.getElementById(moveId(want.key, want.dir));
    (btn && !btn.disabled ? btn : document.getElementById(moveId(want.key, -want.dir)))?.focus();
  }, [showcase]);

  const visibleCount = useMemo(() => (showcase ? showcase.items.filter((i) => i.isActive).length : 0), [showcase]);

  /* One optimistic field change, with a "Saving…" indicator. */
  function save(name, op) {
    setSaving((n) => n + 1);
    return run(name, op).finally(() => setSaving((n) => n - 1));
  }

  function setItemField(key, field, value) {
    setShowcase((s) => withItem(s, key, { [field]: value }));
  }

  function toggleActive(item) {
    const next = !item.isActive;
    if (!next && visibleCount === 1) {
      toast(`Every category is now hidden — the homepage will skip the “Shop by Category” section.`, {
        icon: <FiAlertTriangle className="flex-shrink-0 text-lg text-amber-500" aria-hidden="true" />, duration: 5000,
      });
    }
    save(`${item.key}.isActive`, {
      current: item.isActive,
      next,
      apply: (v) => setItemField(item.key, 'isActive', v),
      send: () => patchShowcase({ items: [{ key: item.key, isActive: next }] }),
      onRevert: (e) => toast.error(`${item.label}: ${e.message}`),
    });
  }

  function toggleFeatured(item) {
    const next = !item.isFeatured;
    save(`${item.key}.isFeatured`, {
      current: item.isFeatured,
      next,
      apply: (v) => setItemField(item.key, 'isFeatured', v),
      send: () => patchShowcase({ items: [{ key: item.key, isFeatured: next }] }),
      onRevert: (e) => toast.error(`${item.label}: ${e.message}`),
    });
  }

  function move(key, dir) {
    const keys = showcase.items.map((it) => it.key);
    const i = keys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    const next = [...keys];
    [next[i], next[j]] = [next[j], next[i]];
    refocus.current = { key, dir };
    save('order', {
      current: keys,
      next,
      apply: (k) => setShowcase((s) => withOrder(s, k)),
      send: () => patchShowcase({ order: next }),
      onRevert: (e) => toast.error(`Order not saved: ${e.message}`),
    });
  }

  function setImage(item, url) {
    return save(`${item.key}.image`, {
      current: item.image,
      next: url,
      apply: (v) => setItemField(item.key, 'image', v),
      send: () => patchShowcase({ items: [{ key: item.key, image: url }] }),
      onRevert: (e) => toast.error(`${item.label}: ${e.message}`),
    });
  }

  async function pickFile(item, file) {
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file.'); return; }
    setUploading((u) => ({ ...u, [item.key]: true }));
    try {
      const { url } = await uploadToCloudinary(file, 'tulsi-bridal/categories');
      if (await setImage(item, url)) toast.success(`${item.label} photo updated — open Preview to check the crop.`);
    } catch (e) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading((u) => { const n = { ...u }; delete n[item.key]; return n; });
    }
  }

  function removePhoto(item) {
    if (!window.confirm(`Remove the photo for ${item.label}? The card will show its icon instead.`)) return;
    setImage(item, '');
  }

  async function saveLayout() {
    const sent = draftLayout;
    setSavingLayout(true);
    try {
      const data = await patchShowcase({ layout: sent });
      setShowcase((s) => ({ ...s, layout: data.layout }));
      toast.success('Layout saved — the homepage uses it now.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSavingLayout(false);
    }
  }

  /* Save crop (from the preview modal): not optimistic — the modal keeps
     its own draft until this resolves. */
  async function saveFocus(key, focus) {
    const data = await patchShowcase({ items: [{ key, focus }] });
    const saved = data.items.find((it) => it.key === key)?.focus || focus;
    setShowcase((s) => withItem(s, key, { focus: saved }));
    return saved;
  }

  function openPreview(key) {
    setPreviewKey(key || showcase.items.find((it) => it.image)?.key || showcase.items[0].key);
  }

  return (
    <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5" aria-labelledby="category-showcase-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-gray-100 pb-2">
        <div className="min-w-0">
          <h2 id="category-showcase-title" className="font-bold text-gray-800">Category Showcase</h2>
          <p className="text-xs text-gray-400 mt-0.5">The &ldquo;Shop by Category&rdquo; cards on the homepage — what shows, in which order, shape and crop. Card changes save instantly.</p>
        </div>
        {status === 'ready' && (
          <div className="flex items-center gap-3 pt-0.5 text-xs" aria-live="polite">
            {saving > 0
              ? <span className="inline-flex items-center gap-1 text-gray-400"><FiLoader className="animate-spin" aria-hidden="true" /> Saving…</span>
              : null}
            <span className={`font-semibold ${visibleCount ? 'text-gray-600' : 'text-amber-700'}`}>{visibleCount} of {showcase.items.length} visible on homepage</span>
          </div>
        )}
      </div>

      {status === 'loading' && <><span className="sr-only" role="status">Loading the category showcase…</span><Skeleton /></>}

      {status === 'error' && (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-8 text-center">
          <FiAlertTriangle className="text-2xl text-red-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-red-700">Couldn&apos;t load the category showcase</p>
            <p className="text-xs text-red-500 mt-0.5">{loadError}</p>
          </div>
          <button type="button" onClick={retry}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2">
            <FiRefreshCw aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {/* Layout selector bar */}
          <div className={`mb-5 rounded-xl border p-4 transition-colors ${layoutDirty ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100 bg-stone-50'}`}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <LayoutControls layout={draftLayout} onChange={setDraftLayout} />
              <div className="flex flex-wrap items-center gap-2">
                {layoutDirty && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" /> Unsaved layout
                  </span>
                )}
                <button type="button" onClick={() => openPreview()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-amber-300 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
                  <FiEye aria-hidden="true" /> Preview
                </button>
                {layoutDirty && (
                  <>
                    <button type="button" onClick={() => setDraftLayout(showcase.layout)} disabled={savingLayout}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50">
                      Discard
                    </button>
                    <button type="button" onClick={saveLayout} disabled={savingLayout}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 disabled:opacity-60">
                      {savingLayout ? <FiLoader className="animate-spin" aria-hidden="true" /> : <FiCheck aria-hidden="true" />}
                      {savingLayout ? 'Saving…' : 'Save layout'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {visibleCount === 0 && (
            <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <FiAlertTriangle className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              Every category is hidden, so the homepage skips the &ldquo;Shop by Category&rdquo; section. Switch one on to bring it back.
            </p>
          )}

          <ul className={GRID} aria-label="Homepage categories, in order">
            {showcase.items.map((item, i) => (
              <CategoryCard
                key={item.key}
                item={item}
                index={i}
                count={showcase.items.length}
                variant={draftLayout.layoutVariant}
                uploading={!!uploading[item.key]}
                onToggleActive={toggleActive}
                onToggleFeatured={toggleFeatured}
                onMove={move}
                onPreview={openPreview}
                onPickFile={pickFile}
                onRemovePhoto={removePhoto}
              />
            ))}
          </ul>
          <p className="text-xs text-gray-400 mt-3">
            Featured cards take a double-size King Size slot. Hidden cards keep their photo and position. Photos crop on Cloudinary — use the eye button to check every shape and set the focus.
          </p>

          {previewKey && (
            <ShowcasePreviewModal
              showcase={showcase}
              layout={draftLayout}
              onLayoutChange={setDraftLayout}
              layoutDirty={layoutDirty}
              savingLayout={savingLayout}
              onSaveLayout={saveLayout}
              initialKey={previewKey}
              onSaveFocus={saveFocus}
              onClose={() => setPreviewKey(null)}
            />
          )}
        </>
      )}
    </section>
  );
}
