/* ─────────────────────────────────────────────
   Virtual try-on — the rules shared by the live camera, the AI model
   studio and the admin screen that sets up the model portraits.

   AI Model Studio works on pre-rendered portraits (one per skin tone),
   each stored with face anchors measured once by MediaPipe when the
   portrait is saved. The product's own cutout pixels are drawn on top,
   so the jewellery's texture, shine and proportions are never redrawn by
   a generative model — the shopper sees the real piece.

   Pure module — no '@/…' imports, no DOM.
   ───────────────────────────────────────────── */

export const SKIN_TONES = Object.freeze([
  { id: 'fair', label: 'Fair', hex: '#EBC3A0', describe: 'fair, light warm-beige' },
  { id: 'wheatish', label: 'Wheatish', hex: '#D0A074', describe: 'wheatish, golden-tan' },
  { id: 'dusky', label: 'Dusky', hex: '#A26A45', describe: 'dusky, warm brown' },
  { id: 'bronze', label: 'Deep Bronze', hex: '#6B412A', describe: 'deep bronze, rich dark brown' },
]);
export const TONE_IDS = SKIN_TONES.map((t) => t.id);

/** Which placement a product uses: 'earring' | 'necklace' | 'choker' | null. */
export function tryOnKind(product = {}) {
  const text = `${product.category || ''} ${product.subCategory || ''} ${product.name || ''}`.toLowerCase();
  if (/choker/.test(text)) return 'choker';
  if (/earring|jhumk|stud|ear ?cuff|chandbali/.test(text)) return 'earring';
  if (/necklace|haram|haar|mala|pendant|chain/.test(text)) return 'necklace';
  return null;
}

/* ── Anchors: where the face is on a portrait, as fractions of its size ── */

const inUnit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const point = (p) => (p && inUnit(p.x) && inUnit(p.y) ? { x: round4(p.x), y: round4(p.y) } : null);
const round4 = (n) => Math.round(n * 10_000) / 10_000;

/**
 * Validates anchors sent by the admin screen.
 * @returns {{ earL, earR, chin, faceW, faceH } | null}
 */
export function parseAnchors(a) {
  if (!a || typeof a !== 'object') return null;
  const earL = point(a.earL);
  const earR = point(a.earR);
  const chin = point(a.chin);
  const ok = (v) => inUnit(v) && v > 0.02;
  if (!earL || !earR || !chin || !ok(a.faceW) || !ok(a.faceH) || earL.x >= earR.x) return null;
  return { earL, earR, chin, faceW: round4(a.faceW), faceH: round4(a.faceH) };
}

/* MediaPipe Face Landmarker indices. 234/454 are the face contour at the
   ears (tragus level), 152 the chin tip, 10 the top of the forehead. */
export const LM = Object.freeze({ EAR_A: 234, EAR_B: 454, CHIN: 152, TOP: 10 });

/** Face Landmarker output (normalised points) → anchors. */
export function anchorsFromLandmarks(lm) {
  if (!Array.isArray(lm) || lm.length < 455) return null;
  const [earL, earR] = [lm[LM.EAR_A], lm[LM.EAR_B]].sort((p, q) => p.x - q.x);
  return parseAnchors({
    earL: { x: earL.x, y: earL.y },
    earR: { x: earR.x, y: earR.y },
    chin: { x: lm[LM.CHIN].x, y: lm[LM.CHIN].y },
    faceW: Math.abs(earR.x - earL.x),
    faceH: Math.abs(lm[LM.CHIN].y - lm[LM.TOP].y),
  });
}

/* ── Placement ── */

/* A wide earring photo is a pair shot side by side: split it and hang
   one half on each ear, instead of a pair on every ear. */
export const isPairShot = (w, h) => w / h > 0.85;

export const ADJUST = Object.freeze({ scale: { min: 0.5, max: 1.8, step: 0.02 }, offset: { min: -0.3, max: 0.3, step: 0.01 } });
export const clampAdjust = ({ scale = 1, offset = 0 } = {}) => ({
  scale: Math.min(ADJUST.scale.max, Math.max(ADJUST.scale.min, Number(scale) || 1)),
  offset: Math.min(ADJUST.offset.max, Math.max(ADJUST.offset.min, Number(offset) || 0)),
});

/**
 * Where to draw the jewellery on a W×H portrait.
 * @param {'earring'|'necklace'|'choker'} kind
 * @param {object} anchors  parseAnchors() output
 * @param {{ W:number, H:number }} stage
 * @param {{ w:number, h:number }} cutout  trimmed cutout size in pixels
 * @param {{ scale?:number, offset?:number }} adjust  shopper's size / position tweak
 * @returns {Array<{ sx, sy, sw, sh, dx, dy, dw, dh }>}  source rect in the cutout → destination rect on the stage
 */
export function placeJewellery(kind, anchors, { W, H }, { w, h }, adjust = {}) {
  const { scale, offset } = clampAdjust(adjust);
  const faceW = anchors.faceW * W;
  const faceH = anchors.faceH * H;
  const nudge = offset * faceH;

  if (kind === 'earring') {
    const pair = isPairShot(w, h);
    const sw = pair ? w / 2 : w;
    const dh = faceH * 0.36 * scale;
    const dw = dh * (sw / h);
    /* Hang from the lobe: a little below the tragus-level anchor. */
    return [anchors.earL, anchors.earR].map((ear, i) => ({
      sx: pair ? i * sw : 0, sy: 0, sw, sh: h,
      dx: ear.x * W - dw / 2, dy: ear.y * H + faceH * 0.1 + nudge, dw, dh,
    }));
  }

  const choker = kind === 'choker';
  const dw = faceW * (choker ? 1.05 : 1.55) * scale;
  const dh = dw * (h / w);
  /* The neck starts about a third of a face below the chin; a choker
     sits high on it, a necklace's chain opens at its base. */
  const top = anchors.chin.y * H + faceH * (choker ? 0.14 : 0.3) + nudge;
  return [{ sx: 0, sy: 0, sw: w, sh: h, dx: anchors.chin.x * W - dw / 2, dy: top, dw, dh }];
}

/* ── Cutouts ── */

/** True when the image already has a transparent background (checks the corners). */
export function hasTransparentCorners(data, w, h) {
  const alphaAt = (x, y) => data[(y * w + x) * 4 + 3];
  return [alphaAt(0, 0), alphaAt(w - 1, 0), alphaAt(0, h - 1), alphaAt(w - 1, h - 1)].every((a) => a < 32);
}

/**
 * Removes a plain studio background (white / grey / any flat colour)
 * by flood-filling from the border, in place. Pixels close to the
 * background colour fade out smoothly, so edges stay soft and the
 * jewellery itself (enclosed by its outline) is untouched.
 */
export function knockOutBackground(data, w, h, tolerance = 38) {
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => (y * w + x) * 4);
  const bg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + data[i + c], 0) / corners.length);
  const dist = (i) => Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1;
    if (dist(p * 4) <= tolerance * 1.6) stack.push(p);
  };
  for (let x = 0; x < w; x += 1) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += 1) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const i = p * 4;
    const d = dist(i);
    /* Fully background → clear; near the threshold → partly transparent. */
    data[i + 3] = d <= tolerance ? 0 : Math.round(data[i + 3] * Math.min(1, (d - tolerance) / (tolerance * 0.6)));
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return data;
}

/** Bounding box of visible pixels (alpha > 16), so padding doesn't skew sizing. */
export function trimBounds(data, w, h) {
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/* ── Option B: generating the model portraits ── */

/** Prompt for one skin tone's base portrait (no jewellery — ours is drawn on top). */
export function portraitPrompt(toneId) {
  const tone = SKIN_TONES.find((t) => t.id === toneId);
  if (!tone) return null;
  return [
    `Photorealistic studio beauty portrait of a young South Indian woman with ${tone.describe} skin,`,
    'facing the camera straight on, head level, calm gentle smile,',
    'hair neatly tied back in a low bun so both ears and earlobes are fully visible,',
    'bare neck, collarbones and upper chest visible, wearing a simple off-shoulder deep maroon silk blouse,',
    'absolutely no jewellery, no earrings, no necklace, no bindi,',
    'soft even diffused lighting, plain warm ivory background, head-and-shoulders framing from the top of the head to below the collarbones,',
    '85mm lens, sharp focus, natural skin texture',
  ].join(' ');
}
