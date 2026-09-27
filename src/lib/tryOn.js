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

/* Colour distance used by the cutout passes (max channel difference). */
const cdist = (data, i, c) => Math.max(Math.abs(data[i] - c[0]), Math.abs(data[i + 1] - c[1]), Math.abs(data[i + 2] - c[2]));

/**
 * Finds a backdrop left inside the photo after the border pass — a
 * coloured card, disc, cloth or neck-stand the piece is laid on — and
 * returns its colour and spread, or null when there isn't one.
 * A backdrop is a large, smooth colour that covers most of the outline
 * of what's visible; jewellery is small, detailed and sparkly, so it
 * doesn't qualify.
 */
export function findBackdrop(data, w, h) {
  const bins = new Map();
  let visible = 0;
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    if (data[i + 3] < 200) continue;
    visible += 1;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  if (!visible) return null;
  let top = 0; let topCount = 0;
  for (const [k, n] of bins) if (n > topCount) { top = k; topCount = n; }
  /* The dominant colour plus its neighbouring bins (paper texture, soft light). */
  const tr = (top >> 8) & 15; const tg = (top >> 4) & 15; const tb = top & 15;
  const near = (i) => Math.abs((data[i] >> 4) - tr) <= 1 && Math.abs((data[i + 1] >> 4) - tg) <= 1 && Math.abs((data[i + 2] >> 4) - tb) <= 1;
  const sum = [0, 0, 0]; const sq = [0, 0, 0]; let n = 0;
  let edge = 0; let edgeNear = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 200) continue;
      const isNear = near(i);
      if (isNear) { for (let c = 0; c < 3; c += 1) { sum[c] += data[i + c]; sq[c] += data[i + c] ** 2; } n += 1; }
      const outline = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || data[i - 4 + 3] < 200 || data[i + 4 + 3] < 200 || data[i - w * 4 + 3] < 200 || data[i + w * 4 + 3] < 200;
      if (outline) { edge += 1; if (isNear) edgeNear += 1; }
    }
  }
  const mean = sum.map((v) => v / n);
  const std = Math.max(...sq.map((v, c) => Math.sqrt(Math.max(0, v / n - mean[c] ** 2))));
  const covers = n / visible;
  const rims = edge ? edgeNear / edge : 0;
  if (covers < 0.3 || rims < 0.45 || std > 22) return null;
  /* Something must lie on it — a plain flat piece is not a backdrop. */
  if (visible - n < visible * 0.005) return null;
  /* A card / disc / cloth is a solid blob filling its bounding box;
     a necklace or chain is open and thin. */
  let minX = w; let minY = h; let maxX = 0; let maxY = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (data[i + 3] >= 200 && near(i)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (n / ((maxX - minX + 1) * (maxY - minY + 1)) < 0.5) return null;
  return { color: mean, std, tolerance: Math.min(48, Math.max(16, std * 2.2 + 8)) };
}

/**
 * Local contrast of each candidate pixel: its difference from the
 * average of the candidate pixels around it (integral-image box mean).
 * Smooth areas (studio white, a card, cloth, soft gradients) score low;
 * a thin chain or a stone edge scores high against its neighbourhood,
 * even when it's pale on a pale card. Returns the scores and a
 * threshold set from the image's own noise level.
 */
function localContrast(data, w, h, cand, radius) {
  const n = w * h;
  const W1 = w + 1;
  const sums = [new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1))];
  const cnt = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y += 1) {
    const rs = [0, 0, 0]; let rc = 0;
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (cand[p]) { for (let c = 0; c < 3; c += 1) rs[c] += data[p * 4 + c]; rc += 1; }
      const o = (y + 1) * W1 + x + 1;
      for (let c = 0; c < 3; c += 1) sums[c][o] = sums[c][o - W1] + rs[c];
      cnt[o] = cnt[o - W1] + rc;
    }
  }
  const box = (arr, x0, y0, x1, y1) => arr[y1 * W1 + x1] - arr[y0 * W1 + x1] - arr[y1 * W1 + x0] + arr[y0 * W1 + x0];
  const diff = new Float32Array(n);
  const samples = [];
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - radius); const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!cand[p]) continue;
      const x0 = Math.max(0, x - radius); const x1 = Math.min(w, x + radius + 1);
      const k = box(cnt, x0, y0, x1, y1);
      const i = p * 4;
      let d = 0;
      for (let c = 0; c < 3; c += 1) d = Math.max(d, Math.abs(data[i + c] - box(sums[c], x0, y0, x1, y1) / k));
      diff[p] = d;
      if ((p & 7) === 0) samples.push(d);
    }
  }
  /* Backdrop noise (robust 70th percentile) sets the bar. */
  samples.sort((a, b) => a - b);
  const noise = samples.length ? samples[Math.floor(samples.length * 0.7)] : 4;
  return { diff, thr: Math.max(9, noise * 2.6 + 5) };
}

/* Clears smooth pixels near `color`; faint-contrast pixels fade. */
function keyOutLocal(data, w, h, color, tol, radius = 8) {
  const n = w * h;
  const cand = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (data[p * 4 + 3] && cdist(data, p * 4, color) <= tol * 2.5) cand[p] = 1;
  const { diff, thr } = localContrast(data, w, h, cand, radius);
  for (let p = 0; p < n; p += 1) {
    if (!cand[p]) continue;
    const i = p * 4;
    if (diff[p] <= thr) data[i + 3] = 0;
    else if (diff[p] < thr * 1.6) data[i + 3] = Math.round(data[i + 3] * ((diff[p] - thr) / (thr * 0.6)));
  }
  return thr;
}

/**
 * Pass 1 — the studio background around the photo's border: flood-fills
 * inward through smooth pixels close to the corner colour. The flood
 * stops at any line that stands out locally (a chain, an outline, the
 * edge of a card), so a pale piece on a pale background survives.
 */
function clearBorderBackground(data, w, h, bg, tolerance = 60) {
  const n = w * h;
  const cand = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (data[p * 4 + 3] && cdist(data, p * 4, bg) <= tolerance) cand[p] = 1;
  const { diff, thr } = localContrast(data, w, h, cand, 4);
  const seen = new Uint8Array(n);
  const stack = [];
  const push = (p) => { if (!seen[p]) { seen[p] = 1; if (cand[p] && diff[p] <= thr) stack.push(p); } };
  for (let x = 0; x < w; x += 1) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    data[p * 4 + 3] = 0;
    const x = p % w; const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  return thr;
}

/**
 * Clears outline pixels left between cleared areas — e.g. the edge of a
 * round card, which blends the card and the studio white. Such a pixel's
 * colour lies BETWEEN the cleared colours around it. A chain or stone
 * pixel is darker, brighter or more coloured than everything cleared
 * beside it, so it stays — even a faint silver chain on a pale card.
 */
function absorbEdges(data, w, h, margin = 1, rounds = 2, reach = 2) {
  for (let r = 0; r < rounds; r += 1) {
    const drop = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        if (!data[i + 3]) continue;
        const lo = [255, 255, 255]; const hi = [0, 0, 0];
        let found = 0;
        for (let dy = -reach; dy <= reach; dy += 1) {
          for (let dx = -reach; dx <= reach; dx += 1) {
            const nx = x + dx; const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = (ny * w + nx) * 4;
            if (data[j + 3]) continue;
            found += 1;
            for (let c = 0; c < 3; c += 1) {
              if (data[j + c] < lo[c]) lo[c] = data[j + c];
              if (data[j + c] > hi[c]) hi[c] = data[j + c];
            }
          }
        }
        if (found && [0, 1, 2].every((c) => data[i + c] >= lo[c] - margin && data[i + c] <= hi[c] + margin)) drop.push(i);
      }
    }
    if (!drop.length) return;
    for (const i of drop) data[i + 3] = 0;
  }
}

/* Removes specks: visible clusters far smaller than the main piece. */
export function despeckle(data, w, h, minShare = 0.004) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < w * h; s += 1) {
    if (label[s] !== -1 || data[s * 4 + 3] < 40) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      size += 1;
      const x = p % w; const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx; const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (label[q] === -1 && data[q * 4 + 3] >= 40) { label[q] = id; stack.push(q); }
        }
      }
    }
    sizes.push(size);
  }
  if (!sizes.length) return;
  const min = Math.max(12, Math.max(...sizes) * minShare);
  for (let p = 0; p < w * h; p += 1) {
    if (label[p] !== -1 && sizes[label[p]] < min) data[p * 4 + 3] = 0;
  }
}

/**
 * Turns a product photo into a jewellery-only cutout, in place:
 *   1. plain background connected to the photo's border (studio white)
 *   2. a backdrop the piece lies on (coloured card / disc / cloth)
 *   3. blended rim pixels on the cut edges, then stray specks.
 * A clean transparent PNG passes through almost untouched.
 * @returns {{ changed: boolean }}
 */
export function isolateJewellery(data, w, h) {
  let changed = false;
  let edgeTol = 0;
  if (!hasTransparentCorners(data, w, h)) {
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => (y * w + x) * 4);
    const bg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + data[i + c], 0) / 4);
    edgeTol = clearBorderBackground(data, w, h, bg);
    changed = true;
  }
  const backdrop = findBackdrop(data, w, h);
  if (backdrop) {
    edgeTol = Math.max(edgeTol, keyOutLocal(data, w, h, backdrop.color, backdrop.tolerance));
    changed = true;
  }
  if (changed) {
    absorbEdges(data, w, h);
    despeckle(data, w, h);
  }
  return { changed };
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
