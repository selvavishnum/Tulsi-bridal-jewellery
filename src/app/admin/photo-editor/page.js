'use client';

import { useState, useRef, useCallback } from 'react';
import { FiUploadCloud, FiDownload, FiImage, FiZap, FiSliders, FiCheck } from 'react-icons/fi';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

/* ── canvas helpers ── */
function applyAdjustments(src, { brightness, contrast, saturation, warmth, sharpness }) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      ctx.filter = [
        `brightness(${brightness / 100})`,
        `contrast(${contrast / 100})`,
        `saturate(${saturation / 100})`,
        `sepia(${Math.max(0, warmth - 100) / 200})`,
      ].join(' ');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = src;
  });
}

const PRESETS = [
  { id: 'natural',   label: 'Natural',    adj: { brightness: 105, contrast: 105, saturation: 100, warmth: 100 } },
  { id: 'bright',    label: 'Bright',     adj: { brightness: 120, contrast: 110, saturation: 110, warmth: 105 } },
  { id: 'warm',      label: 'Warm Gold',  adj: { brightness: 110, contrast: 108, saturation: 115, warmth: 130 } },
  { id: 'vivid',     label: 'Vivid',      adj: { brightness: 108, contrast: 120, saturation: 140, warmth: 100 } },
  { id: 'soft',      label: 'Soft',       adj: { brightness: 112, contrast: 95,  saturation: 85,  warmth: 108 } },
  { id: 'dramatic',  label: 'Dramatic',   adj: { brightness: 95,  contrast: 135, saturation: 120, warmth: 95 } },
];

export default function AdminPhotoEditorPage() {
  const fileRef = useRef(null);
  const [original, setOriginal] = useState(null);
  const [preview, setPreview]   = useState(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState(null);
  const [activePreset, setActivePreset] = useState(null);
  const [adj, setAdj] = useState({ brightness: 100, contrast: 100, saturation: 100, warmth: 100 });

  const sliders = [
    { key: 'brightness', label: 'Brightness', min: 50,  max: 150 },
    { key: 'contrast',   label: 'Contrast',   min: 50,  max: 150 },
    { key: 'saturation', label: 'Saturation', min: 0,   max: 200 },
    { key: 'warmth',     label: 'Warmth',     min: 80,  max: 140 },
  ];

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    const reader = new FileReader();
    reader.onload = (e) => { setOriginal(e.target.result); setPreview(e.target.result); setUploadedUrl(null); setActivePreset(null); setAdj({ brightness: 100, contrast: 100, saturation: 100, warmth: 100 }); };
    reader.readAsDataURL(file);
  }

  const applyPreset = useCallback(async (preset) => {
    if (!original) return;
    setProcessing(true);
    setActivePreset(preset.id);
    setAdj(preset.adj);
    const result = await applyAdjustments(original, preset.adj);
    setPreview(result);
    setProcessing(false);
  }, [original]);

  const applyManual = useCallback(async () => {
    if (!original) return;
    setProcessing(true);
    const result = await applyAdjustments(original, adj);
    setPreview(result);
    setProcessing(false);
  }, [original, adj]);

  function reset() {
    setPreview(original);
    setAdj({ brightness: 100, contrast: 100, saturation: 100, warmth: 100 });
    setActivePreset(null);
  }

  async function uploadToCloudinary() {
    if (!preview) return;
    setUploading(true);
    try {
      const blob = await fetch(preview).then((r) => r.blob());
      const fd = new FormData();
      fd.append('file', blob, 'product.jpg');
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setUploadedUrl(data.data.url);
      toast.success('Image uploaded! Copy the URL below to use it in your product.');
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function download() {
    const a = document.createElement('a');
    a.href = preview;
    a.download = 'tulsi-product.jpg';
    a.click();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><FiImage /> Product Photo Editor</h1>
        <p className="text-sm text-gray-400 mt-0.5">Enhance your product images and upload them directly to your catalogue</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">

        {/* Left — controls */}
        <div className="space-y-4">

          {/* Upload zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDrop={(e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); }}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-gold-400 hover:bg-gold-50/30 transition-all"
          >
            <FiUploadCloud className="text-4xl text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-600">Click or drag a product photo here</p>
            <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP — any size</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => loadFile(e.target.files[0])} />
          </div>

          {original && (
            <>
              {/* Style presets */}
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Quick Enhance Styles</p>
                <div className="grid grid-cols-3 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p)}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                        activePreset === p.id
                          ? 'bg-maroon-950 text-white border-maroon-950'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gold-400 hover:text-gold-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fine-tune sliders */}
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2"><FiSliders /> Fine-tune</p>
                <div className="space-y-3">
                  {sliders.map(({ key, label, min, max }) => (
                    <div key={key}>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{label}</span><span className="font-mono">{adj[key]}</span>
                      </div>
                      <input
                        type="range" min={min} max={max} value={adj[key]}
                        onChange={(e) => setAdj((a) => ({ ...a, [key]: Number(e.target.value) }))}
                        className="w-full accent-maroon-950"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={applyManual}
                  disabled={processing}
                  className="mt-3 w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-2"
                >
                  {processing ? <LoadingSpinner size="sm" /> : <FiZap />} Apply Adjustments
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button onClick={reset} className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50 transition">
                  Reset
                </button>
                <button onClick={download} className="flex-1 py-2.5 bg-gray-800 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 transition flex items-center justify-center gap-2">
                  <FiDownload /> Download
                </button>
                <button
                  onClick={uploadToCloudinary}
                  disabled={uploading}
                  className="flex-1 py-2.5 bg-maroon-950 text-white text-sm font-semibold rounded-lg hover:bg-maroon-900 disabled:opacity-60 transition flex items-center justify-center gap-2"
                >
                  {uploading ? <LoadingSpinner size="sm" /> : <FiUploadCloud />} Upload
                </button>
              </div>

              {/* Uploaded URL */}
              {uploadedUrl && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-xs font-bold text-green-700 flex items-center gap-1 mb-2"><FiCheck /> Uploaded! Copy URL to use in product form:</p>
                  <div className="flex gap-2">
                    <input readOnly value={uploadedUrl} className="flex-1 text-xs bg-white border border-green-200 rounded-lg px-3 py-2 font-mono text-gray-700 outline-none" />
                    <button
                      onClick={() => { navigator.clipboard.writeText(uploadedUrl); toast.success('Copied!'); }}
                      className="px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-500 transition"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right — preview */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Preview</p>
            {processing && <span className="text-xs text-gold-600 flex items-center gap-1"><LoadingSpinner size="sm" /> Processing…</span>}
          </div>
          <div className="p-4 min-h-80 flex items-center justify-center bg-gray-50">
            {preview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={preview} alt="Preview" className="max-w-full max-h-[500px] object-contain rounded-lg shadow-md" />
            ) : (
              <div className="text-center">
                <FiImage className="text-5xl text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400">Upload a photo to see preview</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* How to use */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
        <p className="text-xs font-bold text-amber-800 mb-2">How to add this image to a product</p>
        <ol className="text-xs text-amber-700 space-y-1 list-decimal list-inside">
          <li>Upload your photo above → click <strong>Upload</strong></li>
          <li>Copy the URL that appears</li>
          <li>Go to <strong>Products</strong> → Add/Edit product → paste the URL in the images field</li>
        </ol>
        <p className="text-xs text-amber-500 mt-2">Note: Image upload requires Cloudinary to be configured in Vercel environment variables.</p>
      </div>
    </div>
  );
}
