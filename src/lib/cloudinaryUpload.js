const CLOUD_NAME    = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'djolb5idc';
const UPLOAD_PRESET = 'tulsi_products';
const MAX_PX        = 3000; // Max dimension — sharp on all screens, ~1.5–2MB JPEG
const QUALITY       = 0.90;

function resizeFile(file) {
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name, { type: 'image/jpeg' })),
        'image/jpeg',
        QUALITY
      );
    };
    img.src = url;
  });
}

/**
 * Upload image directly from browser → Cloudinary (bypasses server).
 * Resizes to max 3000px before upload — keeps file under 2MB for Cloudinary free plan.
 * Quality remains excellent: 3000px is sharper than any display and zoom-ready.
 */
export async function uploadToCloudinary(file, folder = 'tulsi-bridal/products', onProgress) {
  const resized = await resizeFile(file);

  const formData = new FormData();
  formData.append('file', resized);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', folder);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        resolve({ url: data.secure_url, public_id: data.public_id });
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error?.message || 'Upload failed'));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`);
    xhr.send(formData);
  });
}
