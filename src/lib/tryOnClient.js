/* Browser-only helpers for the try-on views and the admin portrait screen. */
import { isolateJewellery, hasTransparentCorners, trimBounds, anchorsFromLandmarks, cloudinaryCutoutUrl } from './tryOn.js';

export const MEDIAPIPE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
export const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const imageCache = new Map();

/** Loads an image with CORS so the canvas can still be saved/shared. */
export function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { imageCache.delete(url); reject(new Error('Image failed to load')); };
      img.src = url;
    }));
  }
  return imageCache.get(url);
}

const cutoutCache = new Map();
const MAX_CUTOUT = 900;
/* Bump when the cutout algorithm changes, so stored cutouts are redone. */
const CUTOUT_VERSION = 4;
const USE_CLOUDINARY_AI = process.env.NEXT_PUBLIC_CLOUDINARY_BG_REMOVAL === 'true';

/* ── IndexedDB: finished cutouts survive reloads and later visits ── */
const IDB_NAME = 'tulsi-tryon';
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('cutouts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const r = db.transaction('cutouts').objectStore('cutouts').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function idbPut(key, value) {
  try {
    const db = await idb();
    db.transaction('cutouts', 'readwrite').objectStore('cutouts').put(value, key);
  } catch { /* private mode / quota — memory cache still works */ }
}

const toCanvas = (img, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
  return c;
};

/* Crop a processed canvas to its visible pixels. */
function trimmed(canvas, data) {
  const box = trimBounds(data, canvas.width, canvas.height);
  if (!box) throw new Error('Nothing left after removing the background.');
  const out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return out;
}

/* Where the browser may read the pixels from: Cloudinary sends CORS
   headers; anything else comes through our same-origin proxy. */
function readableUrl(url, productId) {
  if (/^https:\/\/res\.cloudinary\.com\//.test(url) || url.startsWith('data:') || url.startsWith('blob:') || !productId) return url;
  return `/api/try-on/image?product=${encodeURIComponent(productId)}&src=${encodeURIComponent(url)}`;
}

async function buildCutout(url, { ready, productId }) {
  /* 1. Cloudinary AI background removal (when the add-on is on). */
  const aiUrl = USE_CLOUDINARY_AI && !ready ? cloudinaryCutoutUrl(url) : null;
  if (aiUrl) {
    try {
      const img = await loadImage(aiUrl);
      const k = Math.min(1, MAX_CUTOUT / Math.max(img.naturalWidth, img.naturalHeight));
      const c = toCanvas(img, Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      if (hasTransparentCorners(data, c.width, c.height)) return { canvas: trimmed(c, data), method: 'cloudinary-ai' };
    } catch { /* add-on off, still processing (HTTP 423) or failed — fall back */ }
  }

  /* 2. In the browser: remove the background and any card under the piece. */
  const img = await loadImage(readableUrl(url, productId));
  const k = Math.min(1, MAX_CUTOUT / Math.max(img.naturalWidth, img.naturalHeight));
  const c = toCanvas(img, Math.max(1, Math.round(img.naturalWidth * k)), Math.max(1, Math.round(img.naturalHeight * k)));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  /* Throws if the pixels can't be read — then we show an error, never
     the raw photo with its background. */
  const image = ctx.getImageData(0, 0, c.width, c.height);
  /* A real transparent PNG is trusted as-is; a pasted normal photo still gets cleaned. */
  const trusted = ready && hasTransparentCorners(image.data, c.width, c.height);
  if (!trusted) {
    isolateJewellery(image.data, c.width, c.height);
    ctx.putImageData(image, 0, 0);
  }
  return { canvas: trimmed(c, image.data), method: trusted ? 'transparent-png' : 'browser' };
}

/**
 * The product image as a clean, tightly cropped transparent cutout of
 * the jewellery only. Cached in memory and in IndexedDB, so switching
 * skin tones, re-opening try-on or coming back later is instant.
 * `ready` = an admin-made transparent Try-On image.
 * @returns {Promise<{ canvas: HTMLCanvasElement, w: number, h: number, method: string }>}
 */
export function makeCutout(url, { ready = false, productId = null } = {}) {
  const key = `v${CUTOUT_VERSION}:${ready ? 'r' : 'c'}:${url}`;
  if (!cutoutCache.has(key)) {
    cutoutCache.set(key, (async () => {
      const stored = await idbGet(key);
      if (stored?.blob) {
        try {
          const bmp = await createImageBitmap(stored.blob);
          const canvas = toCanvas(bmp, bmp.width, bmp.height);
          return { canvas, w: canvas.width, h: canvas.height, method: stored.method };
        } catch { /* corrupt entry — rebuild */ }
      }
      const { canvas, method } = await buildCutout(url, { ready, productId });
      canvas.toBlob((blob) => { if (blob) idbPut(key, { blob, method, at: Date.now() }); }, 'image/png');
      return { canvas, w: canvas.width, h: canvas.height, method };
    })().catch((e) => { cutoutCache.delete(key); throw e; }));
  }
  return cutoutCache.get(key);
}

let landmarkerPromise = null;
/** Face Landmarker, loaded once per page. mode: 'IMAGE' | 'VIDEO'. */
export async function createFaceLandmarker(runningMode = 'VIDEO') {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' },
    outputFaceBlendshapes: false,
    runningMode,
    numFaces: 1,
  });
}

/** Measures a portrait's face anchors (admin screen, once per portrait). */
export async function detectPortraitAnchors(url) {
  landmarkerPromise ||= createFaceLandmarker('IMAGE');
  const [landmarker, img] = await Promise.all([landmarkerPromise, loadImage(url)]);
  const result = landmarker.detect(img);
  const anchors = anchorsFromLandmarks(result?.faceLandmarks?.[0]);
  if (!anchors) throw new Error('No clear, front-facing face found in this photo.');
  return anchors;
}

/** Draws placements (from placeJewellery) with a soft contact shadow. */
export function drawJewellery(ctx, cutout, placements) {
  for (const p of placements) {
    ctx.save();
    /* Soft contact shadow, like drop-shadow(0 4px 6px rgba(0,0,0,.25)) at
       phone size — scaled with the piece so it reads the same at any size. */
    const u = Math.max(0.5, p.dw / 320);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 6 * u;
    ctx.shadowOffsetY = 4 * u;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cutout.canvas, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
    ctx.restore();
  }
}

/** Small corner credit on saved looks. */
export function drawCredit(ctx, W, H, text) {
  const size = Math.max(12, Math.round(W * 0.024));
  ctx.save();
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  ctx.fillText(text, W - size * 0.8, H - size * 0.6);
  ctx.restore();
}
