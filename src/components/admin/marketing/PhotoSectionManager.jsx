'use client';

/* ─────────────────────────────────────────────
   One Marketing-tab section made of photos — the homepage hero photos, the
   customer reviews, the Instagram posts, the advertisement banners — with
   the same features the Category Showcase has:

     - Layout bar: Shape / Display mode / Density, and a Preview button
     - one card per item: position, ‹ › order, show/hide switch, photo
       (click = preview), name, eye = Preview & crop, Upload / Change / Remove
       photo, and a "Details" box for the item's own fields
     - the storefront preview modal with the crop & focus editor
       (ShowcasePreviewModal, the same one the category showcase uses)

   Controlled: the items, the layout and every change live in the settings
   page's state and are saved by its "Save Settings" button (the category
   showcase, by contrast, saves each change as it is made).
   ───────────────────────────────────────────── */
import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiEye, FiEyeOff, FiChevronLeft, FiChevronRight, FiUpload, FiTrash2, FiLoader, FiPlus, FiChevronDown, FiImage } from 'react-icons/fi';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { normalizeFocus } from '@/lib/marketing';
import { LayoutControls, ShowcasePhoto } from '@/components/admin/showcase/parts';
import ShowcasePreviewModal from '@/components/admin/showcase/ShowcasePreviewModal';

const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600';
const iconBtn = `inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:border-amber-300 hover:text-amber-700 ${ring} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-gray-500`;

/** The show / hide switch of a card. */
export function VisibilitySwitch({ on, label, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Show ${label} on the storefront`}
      title={on ? 'Visible — click to hide' : 'Hidden — click to show'}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 ${ring} focus-visible:ring-offset-1 ${on ? 'bg-green-500' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function StatusBadge({ on, shownWord }) {
  return on ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" /> {shownWord}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
      <FiEyeOff className="text-[10px]" aria-hidden="true" /> Hidden
    </span>
  );
}

const moveId = (section, i, dir) => `${section}-move-${i}-${dir < 0 ? 'earlier' : 'later'}`;

/** What the preview modal and the crop editor need to know about one item (the showcase's item shape). */
export function modalItem(item, i, { photoField, name, emoji }) {
  return {
    key: String(i),
    label: name,
    image: typeof item[photoField] === 'string' ? item[photoField] : '',
    focus: normalizeFocus(item.focus),
    isActive: item.isActive !== false,
    emoji,
    color: 'from-stone-50 to-stone-100',
  };
}

/** Move the item at `i` by `dir` (−1 / +1) in a copy of `items`; the same list when it cannot move. */
export function moved(items, i, dir) {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length || i >= items.length) return items;
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function ItemCard({
  section, item, index, count, variant, name, photoField, emoji, noun, shownWord, uploading, detailsOpen, uploadHint,
  onMove, onToggle, onPreview, onPickFile, onRemovePhoto, onToggleDetails, onDelete, details,
}) {
  const fileRef = useRef(null);
  const on = item.isActive !== false;
  const image = typeof item[photoField] === 'string' ? item[photoField] : '';
  const shown = { image, color: 'from-stone-50 to-stone-100', emoji, focus: normalizeFocus(item.focus) };
  return (
    <li className={`flex min-w-0 flex-col rounded-xl border bg-white p-2.5 transition-opacity duration-200 sm:p-3 ${on ? 'border-gray-200' : 'border-gray-200 opacity-60'} ${detailsOpen ? 'col-span-full' : ''}`}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button type="button" id={moveId(section, index, -1)} className={iconBtn} disabled={index === 0}
            onClick={() => onMove(index, -1)} aria-label={`Move ${name} earlier`} title="Move earlier">
            <FiChevronLeft aria-hidden="true" />
          </button>
          <button type="button" id={moveId(section, index, 1)} className={iconBtn} disabled={index === count - 1}
            onClick={() => onMove(index, 1)} aria-label={`Move ${name} later`} title="Move later">
            <FiChevronRight aria-hidden="true" />
          </button>
        </div>
        <VisibilitySwitch on={on} label={name} onToggle={() => onToggle(index)} />
      </div>

      <div className={detailsOpen ? 'mx-auto w-full max-w-[16rem]' : ''}>
        <div className="relative">
          <span className="absolute left-1.5 top-1.5 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-white/90 px-1 text-[11px] font-bold text-gray-600 shadow-sm ring-1 ring-black/5">
            <span className="sr-only">Position </span>{index + 1}
          </span>
          <button type="button" tabIndex={-1} onClick={() => onPreview(index)} aria-label={`Preview ${name}`}
            className={`group relative block w-full cursor-zoom-in focus:outline-none ${variant === 'circle' ? 'mx-auto max-w-[85%]' : ''}`}>
            <ShowcasePhoto item={shown} variant={variant} sizes="(min-width: 1360px) 200px, 45vw" className="border border-gray-100 transition group-hover:shadow-md" />
            {uploading && (
              <span className={`absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-semibold text-amber-700 ${variant === 'circle' ? 'rounded-full' : 'rounded-xl'}`}>
                <FiLoader className="mr-1 animate-spin" aria-hidden="true" /> Uploading…
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-1">
        <h3 className="min-w-0 truncate font-sans text-sm font-semibold text-gray-800">{name}</h3>
        <button type="button" className={iconBtn} onClick={() => onPreview(index)} aria-label={`Preview and crop ${name}`} title="Preview & crop">
          <FiEye aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1"><StatusBadge on={on} shownWord={shownWord} /></div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPickFile(index, f); }} />
      <div className="mt-2 flex gap-1">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          aria-label={`${image ? 'Change' : 'Upload'} photo for ${name}`}
          className={`flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-amber-500 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 ${ring} focus-visible:ring-offset-1 disabled:opacity-60`}>
          {uploading ? <FiLoader className="flex-shrink-0 animate-spin" aria-hidden="true" /> : <FiUpload className="flex-shrink-0" aria-hidden="true" />}
          <span className="truncate">{uploading ? 'Uploading…' : image ? 'Change' : 'Upload'}</span>
        </button>
        {image && !uploading && (
          <button type="button" className={`${iconBtn} h-9 w-9`} onClick={() => onRemovePhoto(index)} aria-label={`Remove the photo of ${name}`} title="Remove photo">
            <FiTrash2 aria-hidden="true" />
          </button>
        )}
      </div>
      {uploadHint && !image && <p className="mt-1 text-[11px] text-gray-400">{uploadHint}</p>}

      <button type="button" aria-expanded={detailsOpen} onClick={() => onToggleDetails(index)}
        className={`mt-2 inline-flex min-h-9 items-center justify-between gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${ring}`}>
        Details
        <FiChevronDown aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${detailsOpen ? 'rotate-180' : ''}`} />
      </button>
      {detailsOpen && (
        <div className="mt-2 space-y-3 border-t border-gray-100 pt-3">
          {details}
          <button type="button" onClick={() => onDelete(index)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 ${ring}`}>
            <FiTrash2 aria-hidden="true" /> Delete this {noun}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * @param {object} props
 * @param {'hero'|'testimonials'|'instagram'|'ads'} props.section
 * @param {object[]} props.items
 * @param {(items: object[]) => void} props.onItemsChange
 * @param {{ layoutVariant: string, displayMode: string, size: string }} props.layout
 * @param {(layout: object) => void} props.onLayoutChange
 * @param {string} props.photoField          'imageUrl' | 'photo' | 'image'
 * @param {(item: object, i: number) => string} props.itemName
 * @param {string} props.uploadFolder         Cloudinary folder
 * @param {() => object} props.makeItem       a new, empty item
 * @param {(item: object, i: number, update: (patch: object) => void) => import('react').ReactNode} props.renderDetails
 * @param {{ shapes?: string[], modes?: (string|object)[], sizes?: string[] }} props.layoutProps
 * @param {object} props.previewConfig        { src, title, message, note, itemLabel, buildData(items, layout) }
 * @param {object} props.copy                 { noun, nouns, emoji, shownWord, addLabel, emptyTitle, emptyHint, max, uploadHint?, footnote? }
 * @param {string} [props.gridClass]
 */
export default function PhotoSectionManager({
  section, items, onItemsChange, layout, onLayoutChange, photoField, itemName, uploadFolder, makeItem, renderDetails,
  layoutProps, previewConfig, copy, gridClass = 'grid grid-cols-2 gap-3 lg:grid-cols-3 min-[1360px]:grid-cols-4',
}) {
  const [uploading, setUploading] = useState({});
  const [previewKey, setPreviewKey] = useState(null);
  const [openIdx, setOpenIdx] = useState(null);
  const [announce, setAnnounce] = useState('');
  const refocus = useRef(null);

  const names = items.map((it, i) => itemName(it, i));
  const visibleCount = items.filter((it) => it.isActive !== false && (typeof it[photoField] === 'string' ? it[photoField] : '')).length;
  const modalItems = useMemo(
    () => items.map((it, i) => modalItem(it, i, { photoField, name: itemName(it, i), emoji: copy.emoji })),
    [items, photoField, itemName, copy.emoji],
  );

  function update(i, patch) { onItemsChange(items.map((it, k) => (k === i ? { ...it, ...patch } : it))); }

  function move(i, dir) {
    const next = moved(items, i, dir);
    if (next === items) return;
    refocus.current = { section, i: i + dir, dir };
    setOpenIdx(null);
    onItemsChange(next);
    setAnnounce(`${names[i]} moved to position ${i + dir + 1} of ${items.length}`);
    /* Keep the keyboard on the arrow that was pressed (or the other one at an end). */
    setTimeout(() => {
      const want = refocus.current;
      if (!want) return;
      refocus.current = null;
      const btn = document.getElementById(moveId(section, want.i, want.dir));
      (btn && !btn.disabled ? btn : document.getElementById(moveId(section, want.i, -want.dir)))?.focus();
    }, 0);
  }

  function toggle(i) {
    const on = items[i].isActive !== false;
    update(i, { isActive: !on });
    setAnnounce(`${names[i]} ${on ? 'hidden' : 'shown'}`);
  }

  async function pickFile(i, file) {
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file.'); return; }
    setUploading((u) => ({ ...u, [i]: true }));
    try {
      const { url } = await uploadToCloudinary(file, uploadFolder);
      update(i, { [photoField]: url });
      toast.success(`${names[i]}: photo updated — open Preview to check the crop, then Save Settings.`);
    } catch (e) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading((u) => { const n = { ...u }; delete n[i]; return n; });
    }
  }

  function removePhoto(i) {
    if (!window.confirm(`Remove the photo of ${names[i]}?`)) return;
    update(i, { [photoField]: '' });
  }

  function remove(i) {
    if (!window.confirm(`Delete ${names[i]}? This cannot be undone after you save.`)) return;
    setOpenIdx(null);
    onItemsChange(items.filter((_, k) => k !== i));
  }

  function add() {
    if (items.length >= copy.max) return;
    onItemsChange([...items, makeItem()]);
    setOpenIdx(items.length);
  }

  function openPreview(i) {
    const first = modalItems.findIndex((m) => m.image);
    setPreviewKey(String(i ?? (first >= 0 ? first : 0)));
  }

  /* Crop saved in the modal: kept in the draft (the page's Save Settings stores it). */
  async function saveFocus(key, focus) {
    const i = Number(key);
    update(i, { focus });
    return focus;
  }

  const preview = useMemo(() => ({
    src: previewConfig.src,
    title: previewConfig.title,
    message: previewConfig.message,
    note: previewConfig.note,
    itemLabel: previewConfig.itemLabel,
    layoutProps,
    build: ({ items: mi, layout: l }) => ({
      section,
      items: items.map((it, i) => ({ ...it, focus: mi[i]?.focus || normalizeFocus(it.focus) })),
      layout: l,
      ...(previewConfig.extra || {}),
    }),
  }), [previewConfig, layoutProps, items, section]);

  return (
    <div>
      <div className="rounded-xl border border-gray-100 bg-stone-50/60 p-3 sm:p-4">
        <LayoutControls layout={layout} onChange={onLayoutChange} {...layoutProps} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => openPreview()} disabled={items.length === 0}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 ${ring}`}>
            <FiEye aria-hidden="true" /> Preview
          </button>
          <button type="button" onClick={add} disabled={items.length >= copy.max}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50 ${ring} focus-visible:ring-offset-1`}>
            <FiPlus aria-hidden="true" /> {copy.addLabel}{copy.max < 100 ? ` (${items.length}/${copy.max})` : ''}
          </button>
          <p className="text-xs text-gray-500">{visibleCount} of {items.length} shown · saved with Save Settings</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-4 rounded-xl border-2 border-dashed border-gray-200 py-10 text-center text-gray-400">
          <FiImage className="mx-auto mb-2 text-3xl opacity-40" aria-hidden="true" />
          <p className="text-sm font-medium">{copy.emptyTitle}</p>
          <p className="mt-1 text-xs">{copy.emptyHint}</p>
        </div>
      ) : (
        <ul className={`mt-4 ${gridClass}`} aria-label={`${copy.nouns}, in order`}>
          {items.map((item, i) => (
            <ItemCard
              key={i}
              section={section}
              item={item}
              index={i}
              count={items.length}
              variant={layout.layoutVariant}
              name={names[i]}
              photoField={photoField}
              emoji={copy.emoji}
              noun={copy.noun}
              shownWord={copy.shownWord}
              uploadHint={copy.uploadHint}
              uploading={!!uploading[i]}
              detailsOpen={openIdx === i}
              onMove={move}
              onToggle={toggle}
              onPreview={openPreview}
              onPickFile={pickFile}
              onRemovePhoto={removePhoto}
              onToggleDetails={(k) => setOpenIdx((cur) => (cur === k ? null : k))}
              onDelete={remove}
              details={renderDetails(item, i, (patch) => update(i, patch))}
            />
          ))}
        </ul>
      )}
      {copy.footnote && <p className="mt-3 text-xs text-gray-400">{copy.footnote}</p>}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {previewKey !== null && (
        <ShowcasePreviewModal
          showcase={{ items: modalItems }}
          layout={layout}
          onLayoutChange={onLayoutChange}
          layoutDirty={false}
          savingLayout={false}
          onSaveLayout={() => {}}
          initialKey={previewKey}
          onSaveFocus={saveFocus}
          onClose={() => setPreviewKey(null)}
          preview={preview}
        />
      )}
    </div>
  );
}
