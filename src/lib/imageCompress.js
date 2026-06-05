/**
 * Compress + resize an image file client-side before upload.
 * Reduces phone camera photos (3–8 MB) to ~200–400 KB.
 * @param {File} file - original image file
 * @param {number} maxPx - max width or height in pixels (default 1400)
 * @param {number} quality - JPEG quality 0–1 (default 0.85)
 * @returns {Promise<File>} compressed JPEG file
 */
export function compressImage(file, maxPx = 1400, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        const ratio = Math.min(maxPx / width, maxPx / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); }; // fallback: use original
    img.src = url;
  });
}
