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

/* Shopper tweaks: size, up/down (fraction of face height) and
   left/right (fraction of face width). */
export const ADJUST = Object.freeze({
  scale: { min: 0.5, max: 1.8, step: 0.02 },
  offset: { min: -0.3, max: 0.3, step: 0.01 },
  shiftX: { min: -0.4, max: 0.4, step: 0.01 },
});
export const DEFAULT_ADJUST = Object.freeze({ scale: 1, offset: 0, shiftX: 0 });
const clampTo = (v, { min, max }, dflt) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Number(v) : dflt));
export const clampAdjust = ({ scale = 1, offset = 0, shiftX = 0 } = {}) => ({
  scale: clampTo(scale || 1, ADJUST.scale, 1),
  offset: clampTo(offset, ADJUST.offset, 0),
  shiftX: clampTo(shiftX, ADJUST.shiftX, 0),
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
  const { scale, offset, shiftX } = clampAdjust(adjust);
  const faceW = anchors.faceW * W;
  const faceH = anchors.faceH * H;
  const nudge = offset * faceH;
  const slide = shiftX * faceW;

  if (kind === 'earring') {
    const pair = isPairShot(w, h);
    const sw = pair ? w / 2 : w;
    const dh = faceH * 0.36 * scale;
    const dw = dh * (sw / h);
    /* Hang from the lobe: a little below the tragus-level anchor. */
    return [anchors.earL, anchors.earR].map((ear, i) => ({
      sx: pair ? i * sw : 0, sy: 0, sw, sh: h,
      dx: ear.x * W - dw / 2 + slide, dy: ear.y * H + faceH * 0.1 + nudge, dw, dh,
    }));
  }

  const choker = kind === 'choker';
  const dw = faceW * (choker ? 1.05 : 1.55) * scale;
  const dh = dw * (h / w);
  /* The neck starts about a third of a face below the chin; a choker
     sits high on it, a necklace's chain opens at its base. */
  const top = anchors.chin.y * H + faceH * (choker ? 0.14 : 0.3) + nudge;
  return [{ sx: 0, sy: 0, sw: w, sh: h, dx: anchors.chin.x * W - dw / 2 + slide, dy: top, dw, dh }];
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

/* HSV-style saturation of an [r, g, b] colour (0 = grey, 1 = pure colour). */
const saturation = (c) => { const hi = Math.max(c[0], c[1], c[2]); return hi ? (hi - Math.min(c[0], c[1], c[2])) / hi : 0; };

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
      if (near(i)) { for (let c = 0; c < 3; c += 1) { sum[c] += data[i + c]; sq[c] += data[i + c] ** 2; } n += 1; }
    }
  }
  const mean = sum.map((v) => v / n);
  const std = Math.max(...sq.map((v, c) => Math.sqrt(Math.max(0, v / n - mean[c] ** 2))));
  /* How much of the visible outline is this colour. Looser than the bins:
     the outline is often a thin blend with whatever was cleared around it. */
  const loose = Math.max(40, std * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 200) continue;
      const outline = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || data[i - 4 + 3] < 200 || data[i + 4 + 3] < 200 || data[i - w * 4 + 3] < 200 || data[i + w * 4 + 3] < 200;
      if (outline) { edge += 1; if (cdist(data, i, mean) <= loose) edgeNear += 1; }
    }
  }
  const covers = n / visible;
  const rims = edge ? edgeNear / edge : 0;
  if (covers < 0.3 || rims < 0.45 || std > 22) return null;
  /* Backdrops are paper, pastel card, cloth or velvet — low saturation.
     Gold, enamel and stones are saturated, so a big flat gold piece is
     never mistaken for the thing it lies on. */
  const hi = Math.max(...mean); const lo = Math.min(...mean);
  if (hi > 0 && (hi - lo) / hi > 0.35) return null;
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

/* Clears the backdrop: smooth pixels near its colour (faint-contrast
   ones fade). Only regions that are really card are removed — those
   connected to the card's outside, or large ones (card showing inside a
   closed necklace loop). A small smooth area enclosed by metal — a clear
   or white stone in its setting — is part of the piece and stays. */
function keyOutLocal(data, w, h, color, tol, radius = 8) {
  const n = w * h;
  const cand = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (data[p * 4 + 3] && cdist(data, p * 4, color) <= tol * 2.5) cand[p] = 1;
  const { diff, thr } = localContrast(data, w, h, cand, radius);
  const smooth = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (cand[p] && diff[p] <= thr) smooth[p] = 1;

  /* Connected regions of smooth backdrop-coloured pixels. */
  const label = new Int32Array(n).fill(-1);
  const regions = [];
  const stack = [];
  for (let s0 = 0; s0 < n; s0 += 1) {
    if (!smooth[s0] || label[s0] !== -1) continue;
    const id = regions.length;
    let size = 0; let open = false;
    label[s0] = id; stack.push(s0);
    while (stack.length) {
      const p = stack.pop();
      size += 1;
      const x = p % w; const y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) open = true;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0) continue;
        if (!data[q * 4 + 3]) { open = true; continue; }
        if (smooth[q] && label[q] === -1) { label[q] = id; stack.push(q); }
      }
    }
    regions.push({ size, open });
  }
  /* "Large" enclosed region = card inside a closed loop: at least 1.5% of
     the photo and 5% of the open card area. A stone is far smaller. */
  const openArea = regions.reduce((m, r) => (r.open ? m + r.size : m), 0);
  const minBig = Math.max(n * 0.015, openArea * 0.05);
  const keep = regions.map((r) => !(r.open || r.size >= minBig));
  const removed = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (label[p] !== -1 && !keep[label[p]]) { removed[p] = 1; data[p * 4 + 3] = 0; }
  /* Soft edge: faint-contrast backdrop pixels right beside removed ones. */
  for (let p = 0; p < n; p += 1) {
    if (!cand[p] || removed[p] || diff[p] >= thr * 1.6 || !data[p * 4 + 3]) continue;
    const x = p % w; const y = (p - x) / w;
    if ((x > 0 && removed[p - 1]) || (x < w - 1 && removed[p + 1]) || (y > 0 && removed[p - w]) || (y < h - 1 && removed[p + w])) {
      data[p * 4 + 3] = Math.round(data[p * 4 + 3] * Math.max(0, (diff[p] - thr) / (thr * 0.6)));
    }
  }
  return thr;
}

/**
 * Pass 1 — the studio background around the photo's border, cleared
 * like a magic wand: the fill spreads from the border to a neighbouring
 * pixel only while the colour changes gently (soft shadows, lighting
 * gradients, paper grain) and stays within reach of the background
 * colour. It stops at any real edge — a chain, a card, a stone — even a
 * faint one, so pale jewellery on a pale background survives.
 * Returns the step tolerance it used.
 */
function clearBorderBackground(data, w, h, bg, reach = 80) {
  const n = w * h;
  /* How much neighbouring background pixels normally differ (grain,
     JPEG noise), measured along the border. */
  const steps = [];
  const step = (p, q) => cdist(data, p * 4, [data[q * 4], data[q * 4 + 1], data[q * 4 + 2]]);
  for (let x = 1; x < w; x += 1) { steps.push(step(x, x - 1), step((h - 1) * w + x, (h - 1) * w + x - 1)); }
  for (let y = 1; y < h; y += 1) { steps.push(step(y * w, (y - 1) * w), step(y * w + w - 1, (y - 1) * w + w - 1)); }
  steps.sort((a, b) => a - b);
  const grain = steps[Math.floor(steps.length * 0.75)] || 2;
  const maxStep = Math.max(6, Math.min(16, grain * 2.5 + 3));

  /* Local contrast against nearby background-coloured pixels only (a
     coloured card next to the white doesn't count as "background", so
     the fill still reaches right up to the card's edge). */
  const cand = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (data[p * 4 + 3] && cdist(data, p * 4, bg) <= 45) cand[p] = 1;
  const { diff, thr } = localContrast(data, w, h, cand, 8);

  const seen = new Uint8Array(n);
  const stack = [];
  for (let x = 0; x < w; x += 1) for (const p of [x, (h - 1) * w + x]) if (!seen[p] && data[p * 4 + 3] && cdist(data, p * 4, bg) <= reach / 2) { seen[p] = 1; stack.push(p); }
  for (let y = 0; y < h; y += 1) for (const p of [y * w, y * w + w - 1]) if (!seen[p] && data[p * 4 + 3] && cdist(data, p * 4, bg) <= reach / 2) { seen[p] = 1; stack.push(p); }
  const cleared = [];
  while (stack.length) {
    const p = stack.pop();
    cleared.push(p);
    const x = p % w; const y = (p - x) / w;
    const nbrs = [];
    if (x > 0) nbrs.push(p - 1);
    if (x < w - 1) nbrs.push(p + 1);
    if (y > 0) nbrs.push(p - w);
    if (y < h - 1) nbrs.push(p + w);
    for (const q of nbrs) {
      if (seen[q] || !data[q * 4 + 3]) continue;
      /* Gentle change from here, near the background colour, and not a
         line standing out from its surroundings (a faint chain). */
      if (step(p, q) <= maxStep && cdist(data, q * 4, bg) <= reach && (!cand[q] || diff[q] <= thr)) { seen[q] = 1; stack.push(q); }
    }
  }
  for (const p of cleared) data[p * 4 + 3] = 0;
  return maxStep;
}

/**
 * Clears outline pixels left between cleared areas — e.g. the edge of a
 * round card, which blends the card and the studio white. Such a pixel's
 * colour lies BETWEEN the cleared colours around it. A chain or stone
 * pixel is darker, brighter or more coloured than everything cleared
 * beside it, so it stays — even a faint silver chain on a pale card.
 */
function absorbEdges(data, w, h, margin = 1, rounds = 3, reach = 3) {
  const ch = [[], [], []];
  for (let r = 0; r < rounds; r += 1) {
    const drop = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        if (!data[i + 3]) continue;
        ch[0].length = 0; ch[1].length = 0; ch[2].length = 0;
        for (let dy = -reach; dy <= reach; dy += 1) {
          for (let dx = -reach; dx <= reach; dx += 1) {
            const nx = x + dx; const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = (ny * w + nx) * 4;
            if (data[j + 3]) continue;
            for (let c = 0; c < 3; c += 1) ch[c].push(data[j + c]);
          }
        }
        if (ch[0].length < 3) continue;
        /* Central 80% of the cleared colours around it (robust to JPEG
           noise): the rim of a card lies between white and card colour;
           a faint chain lies outside that band. */
        const inside = ch.every((vals, c) => {
          vals.sort((a, b) => a - b);
          const lo = vals[Math.floor(vals.length * 0.1)];
          const hi = vals[Math.ceil(vals.length * 0.9) - 1];
          return data[i + c] >= lo - margin && data[i + c] <= hi + margin;
        });
        if (inside) drop.push(i);
      }
    }
    if (!drop.length) return;
    for (const i of drop) data[i + 3] = 0;
  }
}

/**
 * JPEG ringing and glare hugging the piece: near-exact background colour
 * that the careful first pass stopped short of. Spreads from the cleared
 * area only through pixels within `tol` of the background colour — too
 * tight to reach a chain, and a pearl's darker rim keeps it out of the
 * pearl.
 */
function clearNearBackground(data, w, h, bg, tol = 12) {
  const n = w * h;
  const stack = [];
  const done = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) if (!data[p * 4 + 3]) { stack.push(p); done[p] = 1; }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w; const y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || done[q]) continue;
      done[q] = 1;
      if (cdist(data, q * 4, bg) > tol) continue;
      data[q * 4 + 3] = 0;
      stack.push(q);
    }
  }
}

/**
 * Edge matting: pixels on the cut edge are part jewellery, part
 * background (anti-aliasing, soft shadow, JPEG ringing). For each, take
 * the background colour just outside and the jewellery colour just
 * inside, estimate how much of the pixel is jewellery (alpha), and
 * un-mix the background out of its colour. Removes grey / dark / pink
 * halos while keeping edges soft and thin chains intact.
 */
export function refineEdges(data, w, h, band = 3) {
  const n = w * h;
  /* Distance (in px, up to band+1) from the nearest cleared pixel. */
  const dist = new Uint8Array(n).fill(255);
  for (let p = 0; p < n; p += 1) if (!data[p * 4 + 3]) dist[p] = 0;
  for (let d = 1; d <= band + 1; d += 1) {
    for (let p = 0; p < n; p += 1) {
      if (dist[p] !== 255) continue;
      const x = p % w; const y = (p - x) / w;
      if ((x > 0 && dist[p - 1] === d - 1) || (x < w - 1 && dist[p + 1] === d - 1)
        || (y > 0 && dist[p - w] === d - 1) || (y < h - 1 && dist[p + w] === d - 1)) dist[p] = d;
    }
  }
  const updates = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (dist[p] === 0 || dist[p] > band) continue;
      const i = p * 4;
      const bg = [0, 0, 0]; let nb = 0;
      const fg = [0, 0, 0]; let nf = 0;
      let far = null; let farD = -1;
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const nx = x + dx; const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx; const j = q * 4;
          if (dist[q] === 0) { if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) { for (let c = 0; c < 3; c += 1) bg[c] += data[j + c]; nb += 1; } }
          else if (dist[q] > band) { for (let c = 0; c < 3; c += 1) fg[c] += data[j + c]; nf += 1; }
        }
      }
      if (!nb) continue;
      for (let c = 0; c < 3; c += 1) bg[c] /= nb;
      let F;
      if (nf) F = fg.map((v) => v / nf);
      else {
        /* Thin piece (chain): its own core is the most jewellery-like
           pixel nearby — the one furthest from the background. */
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx; const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !data[(ny * w + nx) * 4 + 3]) continue;
            const j = (ny * w + nx) * 4;
            const d = cdist(data, j, bg);
            if (d > farD) { farD = d; far = [data[j], data[j + 1], data[j + 2]]; }
          }
        }
        F = far;
      }
      /* Drop shadow / grey halo beside a COLOURED piece (gold, enamel):
         neutral like the background while the piece next to it is not.
         Never fires beside silver, pearls or white stones. */
      if (nf && saturation(F) > 0.25 && saturation([data[i], data[i + 1], data[i + 2]]) < 0.12 && saturation(bg) < 0.12) {
        updates.push([i, 0, bg]);
        continue;
      }
      const v = [F[0] - bg[0], F[1] - bg[1], F[2] - bg[2]];
      const len2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
      if (len2 < 400) continue; // jewellery ≈ background colour: can't tell, leave it
      const a = Math.min(1, Math.max(0, ((data[i] - bg[0]) * v[0] + (data[i + 1] - bg[1]) * v[1] + (data[i + 2] - bg[2]) * v[2]) / len2));
      updates.push([i, a, bg]);
    }
  }
  for (const [i, a, bg] of updates) {
    if (a < 0.12) { data[i + 3] = 0; continue; }
    /* Un-mix the background: observed = a·fg + (1−a)·bg. */
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.min(255, Math.max(0, bg[c] + (data[i + c] - bg[c]) / a));
    data[i + 3] = Math.round(data[i + 3] * a);
  }
}

/* Removes specks: visible clusters far smaller than the main piece. */
export function despeckle(data, w, h, minShare = 0.02) {
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
    /* Dark velvet shows JPEG specks more; a little wider there. */
    clearNearBackground(data, w, h, bg, bg[0] + bg[1] + bg[2] < 240 ? 22 : 12);
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
    refineEdges(data, w, h);
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

/* ── Cloudinary AI background removal (optional add-on) ── */

/**
 * The same Cloudinary image with AI background removal applied, as a
 * transparent PNG — or null for images not hosted on Cloudinary.
 * Needs the "Cloudinary AI Background Removal" add-on on the account.
 */
export function cloudinaryCutoutUrl(url) {
  const m = typeof url === 'string' && url.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/);
  if (!m) return null;
  if (m[2].includes('e_background_removal')) return url;
  /* Background removal first, then any existing transformations; PNG keeps the alpha. */
  return `${m[1]}e_background_removal/${m[2].replace(/\.(jpe?g|webp|avif|gif)$/i, '')}.png`;
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
