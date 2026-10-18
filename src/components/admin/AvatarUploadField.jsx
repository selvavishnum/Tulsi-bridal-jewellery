'use client';

/* Customer photo picker for a testimonial: a round preview, Upload / Change
   and ✕ Remove. Uploads straight from the browser to Cloudinary (shrunk to
   at most 800 px first — plenty for a 200 px avatar, quick on mobile data)
   and hands back the plain secure_url; the face-centred round crop is
   applied when it's shown (src/lib/avatar.js).

   On a phone, tapping Upload offers the camera or the gallery (no `capture`
   attribute, so the shopper's OS lets the admin choose). */
import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { FiCamera, FiX } from 'react-icons/fi';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';
import CustomerAvatar from '@/components/ui/CustomerAvatar';
import { avatarUrl } from '@/lib/avatar';

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * @param {{ value: string, onChange: (url: string) => void, name?: string }} props
 */
export default function AvatarUploadField({ value, onChange, name = '' }) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  /* An old hand-typed link that isn't an image (a Cloudinary share page, a
     half-pasted URL) or doesn't load. */
  const [brokenFor, setBrokenFor] = useState(null);
  const broken = !!value && (!avatarUrl(value) || brokenFor === value);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again still fires
    if (!file) return;
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
      toast.error('Please choose a photo (JPG, PNG, WebP or HEIC).');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('That photo is over 20 MB — please choose a smaller one.');
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const { url } = await uploadToCloudinary(file, 'tulsi-bridal/testimonials', setProgress, { maxDimension: 800 });
      onChange(url);
      toast.success('Photo uploaded — click Save Settings to publish it.');
    } catch (err) {
      toast.error(err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-shrink-0">
        {value || uploading ? (
          <CustomerAvatar name={name} photo={value} size={64} className="border border-gray-200" onBroken={() => setBrokenFor(value)} />
        ) : (
          <label
            htmlFor={inputId}
            className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 transition hover:border-amber-400 hover:text-amber-500"
            title="Upload a photo"
          >
            <FiCamera className="text-xl" aria-hidden="true" />
            <span className="sr-only">Upload a photo</span>
          </label>
        )}
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45" aria-live="polite">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
            <span className="sr-only">Uploading {progress}%</span>
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <label
            aria-disabled={uploading}
            className={`inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 focus-within:ring-2 focus-within:ring-amber-400 focus-within:ring-offset-1 ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <FiCamera aria-hidden="true" />
            {uploading ? `Uploading… ${progress}%` : value ? 'Change photo' : 'Upload photo'}
            <input
              id={inputId}
              type="file"
              accept="image/*,.heic,.heif"
              className="sr-only"
              disabled={uploading}
              onChange={onFile}
            />
          </label>
          {value && !uploading && (
            <button
              type="button"
              onClick={() => { onChange(''); setBrokenFor(null); }}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              aria-label="Remove photo"
            >
              <FiX aria-hidden="true" /> Remove
            </button>
          )}
        </div>
        <p className={`mt-1 text-[11px] ${broken ? 'text-red-600' : 'text-gray-400'}`}>
          {broken
            ? 'This saved photo link doesn’t load — shoppers see the initial instead. Upload a new photo.'
            : 'Optional · a clear face photo works best · cropped round automatically'}
        </p>
      </div>
    </div>
  );
}
