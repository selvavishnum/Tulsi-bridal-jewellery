'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { FiUploadCloud, FiDownload, FiRefreshCw, FiZap } from 'react-icons/fi';
import toast from 'react-hot-toast';

/* ─── HSL helpers for saturation / warmth manipulation ─── */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

/* ─── Enhancement presets ─── */
const PRESETS = [
  {
    id: 'catalog',
    label: 'Catalog Style',
    emoji: '📸',
    desc: 'Dark velvet look — exactly like Swastik catalog photos',
    settings: { brightness: 1.08, contrast: 1.38, saturation: 1.55, warmth: 0.25, vignette: 0.72, clarity: 1.3, style: 'velvet' },
  },
  {
    id: 'warm-gold',
    label: 'Warm Gold',
    emoji: '✨',
    desc: 'Warm golden tone — antique jewellery catalog look',
    settings: { brightness: 1.12, contrast: 1.25, saturation: 1.45, warmth: 0.45, vignette: 0.55, clarity: 1.2, style: 'warm' },
  },
  {
    id: 'clean-white',
    label: 'E-commerce White',
    emoji: '🤍',
    desc: 'Clean white background — online shop style',
    settings: { brightness: 1.18, contrast: 1.15, saturation: 1.2, warmth: 0.05, vignette: 0.1, clarity: 1.1, style: 'white' },
  },
  {
    id: 'drama',
    label: 'High Drama',
    emoji: '🖤',
    desc: 'Maximum contrast — jewellery pops against deep shadow',
    settings: { brightness: 1.0, contrast: 1.6, saturation: 1.7, warmth: 0.2, vignette: 0.88, clarity: 1.5, style: 'drama' },
  },
];

/* ─── Core canvas enhancement ─── */
async function enhanceOnCanvas(sourceImg, settings) {
  const { brightness, contrast, saturation, warmth, vignette, clarity } = settings;

  const w = sourceImg.naturalWidth || sourceImg.width;
  const h = sourceImg.naturalHeight || sourceImg.height;

  /* --- Pass 1: pixel-level saturation + warmth on an offscreen canvas --- */
  const offscreen = document.createElement('canvas');
  offscreen.width = w; offscreen.height = h;
  const octx = offscreen.getContext('2d');
  octx.drawImage(sourceImg, 0, 0, w, h);

  if (saturation !== 1 || warmth !== 0) {
    const imgData = octx.getImageData(0, 0, w, h);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      let [r, g, b] = [d[i], d[i+1], d[i+2]];
      /* Saturation */
      const [hue, sat, lum] = rgbToHsl(r, g, b);
      const newSat = Math.min(1, sat * saturation);
      [r, g, b] = hslToRgb(hue, newSat, lum);
      /* Warmth — boost red channel, slightly reduce blue */
      r = clamp(r + warmth * 28);
      g = clamp(g + warmth * 8);
      b = clamp(b - warmth * 18);
      d[i] = r; d[i+1] = g; d[i+2] = b;
    }
    octx.putImageData(imgData, 0, 0);
  }

  /* --- Pass 2: brightness + contrast + clarity via CSS filter on main canvas --- */
  const main = document.createElement('canvas');
  main.width = w; main.height = h;
  const mctx = main.getContext('2d');
  mctx.filter = `brightness(${brightness}) contrast(${contrast})`;
  mctx.drawImage(offscreen, 0, 0);
  mctx.filter = 'none';

  /* --- Pass 3: clarity (unsharp-mask simulation via overlay blend) --- */
  if (clarity > 1) {
    const tempBlur = document.createElement('canvas');
    tempBlur.width = w; tempBlur.height = h;
    const bctx = tempBlur.getContext('2d');
    bctx.filter = 'blur(2px)';
    bctx.drawImage(main, 0, 0);
    bctx.filter = 'none';

    /* composite: original + (original - blurred)*amount → sharpens details */
    const sharp = document.createElement('canvas');
    sharp.width = w; sharp.height = h;
    const sctx = sharp.getContext('2d');
    sctx.drawImage(main, 0, 0);
    sctx.globalCompositeOperation = 'soft-light';
    sctx.globalAlpha = (clarity - 1) * 0.55;
    sctx.drawImage(main, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.globalAlpha = 1;

    mctx.clearRect(0, 0, w, h);
    mctx.drawImage(sharp, 0, 0);
  }

  /* --- Pass 4: vignette radial gradient overlay --- */
  if (vignette > 0) {
    const grad = mctx.createRadialGradient(w/2, h/2, h * 0.22, w/2, h/2, Math.max(w, h) * 0.82);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.6, `rgba(0,0,0,${vignette * 0.25})`);
    grad.addColorStop(1, `rgba(0,0,0,${vignette})`);
    mctx.fillStyle = grad;
    mctx.fillRect(0, 0, w, h);
  }

  /* --- Pass 5: style-specific corner deepening (for velvet / drama) --- */
  if (settings.style === 'velvet' || settings.style === 'drama') {
    /* deepen corners with dark brown tinted radial */
    const corners = [[0, 0], [w, 0], [w, h], [0, h]];
    corners.forEach(([cx, cy]) => {
      const r2 = Math.max(w, h) * 0.72;
      const cg = mctx.createRadialGradient(cx, cy, 0, cx, cy, r2);
      cg.addColorStop(0, 'rgba(20,8,4,0.55)');
      cg.addColorStop(1, 'rgba(20,8,4,0)');
      mctx.fillStyle = cg;
      mctx.fillRect(0, 0, w, h);
    });
  }

  return main;
}

/* ─── COMPONENT ─── */
export default function PhotoEditorClient() {
  const [originalSrc, setOriginalSrc] = useState(null);
  const [processedSrc, setProcessedSrc] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activePreset, setActivePreset] = useState('catalog');
  const [customSettings, setCustomSettings] = useState(PRESETS[0].settings);
  const [tab, setTab] = useState('presets'); // 'presets' | 'manual'
  const [compareMode, setCompareMode] = useState(false);
  const imgRef = useRef(null);
  const dropRef = useRef(null);

  const applyEnhancement = useCallback(async (src, settings) => {
    if (!src) return;
    setProcessing(true);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
      const canvas = await enhanceOnCanvas(img, settings);
      setProcessedSrc(canvas.toDataURL('image/jpeg', 0.92));
    } catch (err) {
      toast.error('Enhancement failed — please try again.');
    } finally {
      setProcessing(false);
    }
  }, []);

  /* Re-apply whenever settings change and we have a source image */
  useEffect(() => {
    if (originalSrc) applyEnhancement(originalSrc, customSettings);
  }, [originalSrc, customSettings, applyEnhancement]);

  function handleFiles(files) {
    const file = files[0];
    if (!file || !file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    const reader = new FileReader();
    reader.onload = (e) => { setOriginalSrc(e.target.result); setProcessedSrc(null); };
    reader.readAsDataURL(file);
  }

  function applyPreset(preset) {
    setActivePreset(preset.id);
    setCustomSettings(preset.settings);
  }

  function updateSetting(key, value) {
    setCustomSettings((prev) => ({ ...prev, [key]: value }));
  }

  function downloadResult() {
    if (!processedSrc) return;
    const a = document.createElement('a');
    a.href = processedSrc;
    a.download = `tulsi-catalog-${Date.now()}.jpg`;
    a.click();
    toast.success('Image downloaded!');
  }

  function reset() {
    setOriginalSrc(null);
    setProcessedSrc(null);
    setActivePreset('catalog');
    setCustomSettings(PRESETS[0].settings);
  }

  /* ─── Drop zone ─── */
  function onDrop(e) {
    e.preventDefault();
    dropRef.current?.classList.remove('border-gold-500', 'bg-gold-50');
    handleFiles(e.dataTransfer.files);
  }
  function onDragOver(e) {
    e.preventDefault();
    dropRef.current?.classList.add('border-gold-500', 'bg-gold-50');
  }
  function onDragLeave() {
    dropRef.current?.classList.remove('border-gold-500', 'bg-gold-50');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-velvet-800 text-white py-5 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-serif text-xl font-bold tracking-wide flex items-center gap-2">
              <FiZap className="text-gold-400" /> Catalogue Photo Enhancer
            </h1>
            <p className="text-xs text-gray-300 mt-0.5 tracking-wide">
              Upload any mobile photo → get professional catalog-quality output
            </p>
          </div>
          {originalSrc && (
            <button onClick={reset} className="flex items-center gap-1.5 px-4 py-2 border border-white/30 text-white text-xs hover:bg-white/10 transition rounded">
              <FiRefreshCw className="text-xs" /> New Photo
            </button>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {!originalSrc ? (
          /* ─── Upload zone ─── */
          <div
            ref={dropRef}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className="border-2 border-dashed border-gray-300 rounded-2xl py-20 px-6 text-center transition-colors bg-white cursor-pointer"
            onClick={() => document.getElementById('photo-upload').click()}
          >
            <FiUploadCloud className="text-5xl text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 font-semibold text-lg mb-1">Drop your jewellery photo here</p>
            <p className="text-gray-400 text-sm mb-6">or click to browse — JPG, PNG, WEBP</p>

            {/* Preview presets */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto mt-8">
              {PRESETS.map((p) => (
                <div key={p.id} className="bg-gray-50 rounded-xl p-4 text-center border border-gray-200">
                  <div className="text-3xl mb-2">{p.emoji}</div>
                  <p className="text-xs font-bold text-gray-700">{p.label}</p>
                  <p className="text-xs text-gray-400 mt-1 leading-tight">{p.desc}</p>
                </div>
              ))}
            </div>

            <input
              id="photo-upload"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        ) : (
          /* ─── Editor layout ─── */
          <div className="grid lg:grid-cols-5 gap-6">
            {/* Controls panel — left */}
            <div className="lg:col-span-2 space-y-4">
              {/* Tabs */}
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex border-b">
                  {[['presets', 'Presets'], ['manual', 'Fine-tune']].map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={`flex-1 py-3 text-sm font-semibold transition ${tab === id ? 'bg-velvet-800 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="p-4">
                  {tab === 'presets' ? (
                    <div className="space-y-2">
                      {PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => applyPreset(preset)}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition text-left ${
                            activePreset === preset.id
                              ? 'border-velvet-700 bg-velvet-50'
                              : 'border-gray-200 hover:border-velvet-400 hover:bg-gray-50'
                          }`}
                        >
                          <span className="text-2xl flex-shrink-0">{preset.emoji}</span>
                          <div>
                            <p className="font-bold text-sm text-gray-800">{preset.label}</p>
                            <p className="text-xs text-gray-500 leading-tight">{preset.desc}</p>
                          </div>
                          {activePreset === preset.id && (
                            <span className="ml-auto text-velvet-700 text-xs font-bold">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    /* Fine-tune sliders */
                    <div className="space-y-4">
                      {[
                        { key: 'brightness', label: 'Brightness', min: 0.5, max: 1.8, step: 0.01 },
                        { key: 'contrast', label: 'Contrast', min: 0.7, max: 2.2, step: 0.01 },
                        { key: 'saturation', label: 'Saturation', min: 0.5, max: 2.5, step: 0.05 },
                        { key: 'warmth', label: 'Warmth', min: 0, max: 1, step: 0.05 },
                        { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05 },
                        { key: 'clarity', label: 'Clarity', min: 1, max: 2, step: 0.05 },
                      ].map(({ key, label, min, max, step }) => (
                        <div key={key}>
                          <div className="flex justify-between mb-1">
                            <label className="text-xs font-semibold text-gray-600">{label}</label>
                            <span className="text-xs text-gray-400 font-mono">
                              {Number(customSettings[key]).toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={min} max={max} step={step}
                            value={customSettings[key]}
                            onChange={(e) => updateSetting(key, parseFloat(e.target.value))}
                            className="w-full h-1.5 rounded-full appearance-none bg-gray-200 accent-velvet-700 cursor-pointer"
                          />
                        </div>
                      ))}

                      {/* Style selector */}
                      <div>
                        <label className="text-xs font-semibold text-gray-600 block mb-2">Background Style</label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'velvet', label: 'Dark Velvet', color: '#3d1a11' },
                            { id: 'warm', label: 'Warm Studio', color: '#a87040' },
                            { id: 'white', label: 'Clean White', color: '#f8f8f8' },
                            { id: 'drama', label: 'High Drama', color: '#0a0a0a' },
                          ].map((s) => (
                            <button
                              key={s.id}
                              onClick={() => updateSetting('style', s.id)}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-xs font-semibold transition ${
                                customSettings.style === s.id
                                  ? 'border-velvet-700 bg-velvet-50'
                                  : 'border-gray-200 hover:border-gray-400'
                              }`}
                            >
                              <span className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-300" style={{ background: s.color }} />
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <button
                  onClick={downloadResult}
                  disabled={!processedSrc || processing}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-velvet-800 text-white font-bold text-sm hover:bg-velvet-900 disabled:opacity-50 transition rounded-xl"
                >
                  <FiDownload /> Download Enhanced Photo
                </button>
                <button
                  onClick={() => document.getElementById('photo-upload').click()}
                  className="w-full py-2.5 border-2 border-gray-300 text-gray-600 text-sm font-semibold hover:border-gray-500 transition rounded-xl"
                >
                  Upload Different Photo
                </button>
                <input id="photo-upload" type="file" accept="image/*" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              </div>

              {/* Tips */}
              <div className="bg-gold-50 border border-gold-200 rounded-xl p-4">
                <p className="text-xs font-bold text-gold-800 mb-2">💡 Best Results Tips</p>
                <ul className="text-xs text-gold-700 space-y-1 leading-relaxed">
                  <li>• Place jewellery on a dark cloth or board for the Catalog Style preset</li>
                  <li>• Natural daylight or a desk lamp from the side gives the best look</li>
                  <li>• Keep the jewellery centered and fill the frame</li>
                  <li>• Avoid flash — it washes out the gold/stone details</li>
                </ul>
              </div>
            </div>

            {/* Preview panel — right */}
            <div className="lg:col-span-3">
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Toggle bar */}
                <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50">
                  <span className="text-sm font-semibold text-gray-700">
                    {compareMode ? 'Before vs After' : 'Enhanced Preview'}
                  </span>
                  <button
                    onClick={() => setCompareMode(!compareMode)}
                    className="text-xs text-velvet-700 font-semibold hover:underline"
                  >
                    {compareMode ? 'Show Result Only' : 'Compare Before/After'}
                  </button>
                </div>

                {processing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
                    <div className="text-center">
                      <div className="w-10 h-10 border-2 border-velvet-200 border-t-velvet-700 rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-xs text-gray-500">Enhancing…</p>
                    </div>
                  </div>
                )}

                <div className={`relative grid ${compareMode ? 'grid-cols-2' : 'grid-cols-1'} gap-0`}>
                  {compareMode && (
                    <div className="relative bg-gray-100">
                      <p className="absolute top-2 left-2 text-xs bg-black/50 text-white px-2 py-0.5 rounded z-10">Original</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={originalSrc} alt="Original" className="w-full object-contain max-h-[600px]" />
                    </div>
                  )}
                  <div className="relative bg-velvet-900">
                    {compareMode && <p className="absolute top-2 left-2 text-xs bg-black/50 text-white px-2 py-0.5 rounded z-10">Enhanced</p>}
                    {processedSrc ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={processedSrc} alt="Enhanced" ref={imgRef} className="w-full object-contain max-h-[600px]" />
                    ) : (
                      <div className="flex items-center justify-center min-h-64">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Active preset badge */}
                {activePreset && (
                  <div className="px-5 py-2 bg-gray-50 border-t text-xs text-gray-500">
                    Active preset: <strong className="text-velvet-700">{PRESETS.find((p) => p.id === activePreset)?.label}</strong>
                    {' '}— drag sliders in Fine-tune to customise further
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
