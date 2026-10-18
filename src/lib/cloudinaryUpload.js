const CLOUD_NAME    = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'djolb5idc';
const UPLOAD_PRESET = 'tulsi_products';
const QUALITY = 0.82; // 82% JPEG = ~4–6MB at 6000×4000px, well under 10MB Cloudinary limit

/* Re-encodes to JPEG, optionally no larger than maxDimension px on the long
   side. If the browser can't decode the file (e.g. HEIC from an iPhone in
   some browsers) the original goes up unchanged — Cloudinary converts it —
   instead of the upload waiting forever. */
function compressFile(file, maxDimension = 0) {
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = maxDimension > 0 ? Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, Math.round(img.naturalWidth * k));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file),
        'image/jpeg',
        QUALITY
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/**
 * Upload image directly from browser → Cloudinary (bypasses server).
 * Keeps full resolution (6000×4000px). Compresses to JPEG 82% = ~4–6MB,
 * under Cloudinary's 10MB free plan limit with full sharpness for zoom.
 */
export async function uploadToCloudinary(file, folder = 'tulsi-bridal/products', onProgress, { maxDimension = 0 } = {}) {
  const resized = await compressFile(file, maxDimension);

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
