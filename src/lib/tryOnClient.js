/* Browser-only helpers for the try-on views and the admin portrait screen. */
import { isolateJewellery, hasTransparentCorners, trimBounds, anchorsFromLandmarks } from './tryOn.js';

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

/**
 * The product image as a clean, tightly cropped transparent cutout.
 * `ready` = an admin-made transparent Try-On image: used as uploaded
 * (only trimmed). Anything else has its background, and any card or
 * cloth the piece lies on, removed first (isolateJewellery).
 * @returns {Promise<{ canvas: HTMLCanvasElement, w: number, h: number, knockedOut: boolean }>}
 */
export function makeCutout(url, { ready = false } = {}) {
  const key = `${ready ? 'r' : 'c'}:${url}`;
  if (!cutoutCache.has(key)) {
    cutoutCache.set(key, (async () => {
      const img = await loadImage(url);
      const k = Math.min(1, MAX_CUTOUT / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const work = document.createElement('canvas');
      work.width = w;
      work.height = h;
      const ctx = work.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      let data;
      try {
        data = ctx.getImageData(0, 0, w, h);
      } catch {
        /* Image host without CORS: use it untouched. */
        return { canvas: work, w, h, knockedOut: false };
      }
      /* A real transparent PNG is trusted as-is; a pasted normal photo still gets cleaned. */
      const trusted = ready && hasTransparentCorners(data.data, w, h);
      const { changed: knockedOut } = trusted ? { changed: false } : isolateJewellery(data.data, w, h);
      if (knockedOut) ctx.putImageData(data, 0, 0);
      const box = trimBounds(data.data, w, h) || { x: 0, y: 0, w, h };
      const out = document.createElement('canvas');
      out.width = box.w;
      out.height = box.h;
      out.getContext('2d').drawImage(work, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      return { canvas: out, w: box.w, h: box.h, knockedOut };
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
    ctx.shadowColor = 'rgba(40, 20, 10, 0.35)';
    ctx.shadowBlur = Math.max(2, p.dw * 0.025);
    ctx.shadowOffsetY = Math.max(1, p.dh * 0.012);
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
