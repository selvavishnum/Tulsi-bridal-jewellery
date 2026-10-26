'use client';

/* ─────────────────────────────────────────────
   The three photo sections of the Marketing tab that live in the settings page's
   state: homepage hero photos, customer reviews and the Instagram posts. Each is the
   shared PhotoSectionManager (layout bar, cards, preview, crop) plus what is specific
   to it: the item's own fields, its names and copy, and what the preview frame draws.
   ───────────────────────────────────────────── */
import { newItem, SECTIONS, LIMITS } from '@/lib/marketing';
import PhotoSectionManager from './PhotoSectionManager';

const inputCls = 'w-full min-h-10 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-600';
const labelCls = 'mb-1 block text-xs font-medium text-gray-600';

export const MODE_CHOICES = {
  single: { value: 'single', label: 'Single photo', title: 'Only the first visible photo is shown' },
  slider: { value: 'slider', label: 'Slider', title: 'Photos slide one after another (swipe, arrows, dots)' },
  grid: { value: 'grid', label: 'Grid', title: 'Rows that wrap' },
};
const modesOf = (section) => SECTIONS[section].modes.map((m) => MODE_CHOICES[m]);
const layoutPropsOf = (section) => ({ shapes: SECTIONS[section].shapes, modes: modesOf(section), sizes: SECTIONS[section].sizes });
const PREVIEW_MESSAGE = 'tj-marketing-preview';

function Field({ id, label, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

const HERO = {
  layoutProps: layoutPropsOf('hero'),
  previewConfig: {
    src: '/marketing-preview?section=hero',
    title: 'Homepage hero preview',
    message: PREVIEW_MESSAGE,
    note: 'The homepage hero exactly as shoppers see it — nothing is saved until you click Save Settings.',
    itemLabel: 'Photo',
  },
  copy: {
    noun: 'photo', nouns: 'Hero photos', emoji: '🖼️', shownWord: 'Shown on Home', addLabel: 'Add photo', max: SECTIONS.hero.maxItems,
    emptyTitle: 'No hero photo yet',
    emptyHint: 'Add a photo — until then the homepage shows a gold-chains illustration.',
    uploadHint: 'Best: a portrait photo, about 1200×1500 px (4:5).',
    footnote: 'Single photo shows the first visible photo. Slider shows every visible photo, in this order (up to 6). A Cloudinary link is resized and cropped around the jewellery for you.',
  },
};

/** Homepage hero photos (settings.heroSlides + settings.heroLayout). */
export function HeroPhotosPanel({ items, onItemsChange, layout, onLayoutChange }) {
  return (
    <PhotoSectionManager
      section="hero"
      items={items}
      onItemsChange={onItemsChange}
      layout={layout}
      onLayoutChange={onLayoutChange}
      photoField="imageUrl"
      itemName={(_, i) => `Photo ${i + 1}`}
      uploadFolder="tulsi-bridal/hero"
      makeItem={() => newItem('hero', { id: `slide-${Date.now().toString(36)}` })}
      renderDetails={(item, i, update) => (
        <Field id={`hero-link-${i}`} label="Image link" hint="Uploading above fills this in. You can also paste a link (https://…).">
          <input id={`hero-link-${i}`} type="url" value={item.imageUrl || ''} maxLength={LIMITS.photoLink}
            onChange={(e) => update({ imageUrl: e.target.value })} placeholder="https://… paste image link here" className={inputCls} />
        </Field>
      )}
      layoutProps={HERO.layoutProps}
      previewConfig={HERO.previewConfig}
      copy={HERO.copy}
    />
  );
}

const TESTIMONIALS = {
  layoutProps: layoutPropsOf('testimonials'),
  previewConfig: {
    src: '/marketing-preview?section=testimonials',
    title: 'Happy customers preview',
    message: PREVIEW_MESSAGE,
    note: 'The “Happy Customers” section exactly as shoppers see it — nothing is saved until you click Save Settings.',
    itemLabel: 'Review',
  },
  copy: {
    noun: 'review', nouns: 'Reviews', emoji: '💬', shownWord: 'Shown on Home', addLabel: 'Add review', max: SECTIONS.testimonials.maxItems,
    emptyTitle: 'No testimonials configured',
    emptyHint: 'The “Happy Customers” section stays hidden on the homepage until you add a real review.',
    uploadHint: 'Optional — shown as the reviewer’s photo.',
    footnote: 'Only real reviews from customers. A review without words, or switched off, is not shown.',
  },
};

/** Customer reviews (settings.testimonials + settings.testimonialsLayout). */
export function TestimonialsPanel({ items, onItemsChange, layout, onLayoutChange }) {
  return (
    <PhotoSectionManager
      section="testimonials"
      items={items}
      onItemsChange={onItemsChange}
      layout={layout}
      onLayoutChange={onLayoutChange}
      photoField="photo"
      itemName={(t, i) => (t.name && t.name.trim()) || `Review ${i + 1}`}
      uploadFolder="tulsi-bridal/testimonials"
      makeItem={() => newItem('testimonials', {})}
      gridClass="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1360px]:grid-cols-3"
      renderDetails={(t, i, update) => (
        <div className="grid gap-3">
          <Field id={`rev-name-${i}`} label="Customer name">
            <input id={`rev-name-${i}`} value={t.name || ''} maxLength={LIMITS.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Priya Sharma" className={inputCls} />
          </Field>
          <Field id={`rev-loc-${i}`} label="Location">
            <input id={`rev-loc-${i}`} value={t.location || ''} maxLength={LIMITS.location} onChange={(e) => update({ location: e.target.value })} placeholder="e.g. Chennai" className={inputCls} />
          </Field>
          <Field id={`rev-rating-${i}`} label="Star rating">
            <select id={`rev-rating-${i}`} value={t.rating ?? 5} onChange={(e) => update({ rating: Number(e.target.value) })} className={inputCls}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}{'☆'.repeat(5 - n)} ({n})</option>)}
            </select>
          </Field>
          <Field id={`rev-text-${i}`} label="Review" hint={`${(t.review || '').length}/${LIMITS.review}`}>
            <textarea id={`rev-text-${i}`} rows={4} value={t.review || ''} maxLength={LIMITS.review} onChange={(e) => update({ review: e.target.value })}
              placeholder="What the customer said, in their own words" className={`${inputCls} resize-y`} />
          </Field>
        </div>
      )}
      layoutProps={TESTIMONIALS.layoutProps}
      previewConfig={TESTIMONIALS.previewConfig}
      copy={TESTIMONIALS.copy}
    />
  );
}

const INSTAGRAM = {
  layoutProps: layoutPropsOf('instagram'),
  previewConfig: {
    src: '/marketing-preview?section=instagram',
    title: 'Instagram feed preview',
    message: PREVIEW_MESSAGE,
    note: 'The Instagram section exactly as shoppers see it — nothing is saved until you click Save Settings.',
    itemLabel: 'Post',
  },
  copy: {
    noun: 'post', nouns: 'Instagram posts', emoji: '📷', shownWord: 'Shown on Home', addLabel: 'Add post', max: SECTIONS.instagram.maxItems,
    emptyTitle: 'No Instagram posts configured',
    emptyHint: 'Add up to 6 posts for the Instagram grid on the homepage.',
    uploadHint: 'Square photos look best.',
    footnote: 'Up to 6 posts. A post needs a photo to be shown.',
  },
};

/** Instagram posts (settings.instagramFeed + settings.instagramLayout). */
export function InstagramPanel({ items, onItemsChange, layout, onLayoutChange }) {
  return (
    <PhotoSectionManager
      section="instagram"
      items={items}
      onItemsChange={onItemsChange}
      layout={layout}
      onLayoutChange={onLayoutChange}
      photoField="imageUrl"
      itemName={(_, i) => `Post ${i + 1}`}
      uploadFolder="tulsi-bridal/instagram"
      makeItem={() => newItem('instagram', {})}
      renderDetails={(post, i, update) => (
        <div className="grid gap-3">
          <Field id={`ig-cap-${i}`} label="Caption" hint="Shown when someone hovers over the photo.">
            <input id={`ig-cap-${i}`} value={post.caption || ''} maxLength={LIMITS.caption} onChange={(e) => update({ caption: e.target.value })} placeholder="e.g. Layered chains, everyday gold" className={inputCls} />
          </Field>
          <Field id={`ig-url-${i}`} label="Post link" hint="Where a tap on the photo goes (https://instagram.com/p/…).">
            <input id={`ig-url-${i}`} type="url" value={post.postUrl || ''} maxLength={LIMITS.link} onChange={(e) => update({ postUrl: e.target.value })} placeholder="https://instagram.com/p/…" className={inputCls} />
          </Field>
        </div>
      )}
      layoutProps={INSTAGRAM.layoutProps}
      previewConfig={INSTAGRAM.previewConfig}
      copy={INSTAGRAM.copy}
    />
  );
}
