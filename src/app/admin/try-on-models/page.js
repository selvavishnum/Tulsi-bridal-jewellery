'use client';
/* AI Try-On Models: one portrait per skin tone for AI Model Studio.
   Upload a photo or generate one with AI, then "Detect face" measures
   where the ears and chin are, so jewellery lands in the right place. */
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FiUpload, FiZap, FiCrosshair, FiSave, FiTrash2, FiRefreshCw } from 'react-icons/fi';
import { SKIN_TONES, parseAnchors } from '@/lib/tryOn';

const btn = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border disabled:opacity-40';

function Dots({ anchors }) {
  if (!anchors) return null;
  const pts = [anchors.earL, anchors.earR, anchors.chin];
  return pts.map((p, i) => (
    <span key={i} className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500 shadow" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
  ));
}

function ToneCard({ tone, saved, aiConfigured, onSaved }) {
  const [draft, setDraft] = useState(null); // { portrait, anchors, source }
  const [busy, setBusy] = useState('');
  const current = draft || saved || null;
  const dirty = !!draft;

  async function detect(portrait, source) {
    setBusy('detect');
    try {
      const { detectPortraitAnchors } = await import('@/lib/tryOnClient');
      const anchors = await detectPortraitAnchors(portrait);
      setDraft({ portrait, anchors, source });
      toast.success(`${tone.label}: face found — check the dots, then Save`);
    } catch (e) {
      setDraft({ portrait, anchors: null, source });
      toast.error(e.message || 'Face not found');
    } finally {
      setBusy('');
    }
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('upload');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const d = await fetch('/api/upload', { method: 'POST', body: fd }).then((r) => r.json());
      if (!d.success) throw new Error(d.message);
      setBusy('');
      await detect(d.data.secure_url || d.data.url, 'upload');
    } catch (err) {
      toast.error(err.message || 'Upload failed');
      setBusy('');
    }
  }

  async function generate(force) {
    setBusy('generate');
    try {
      const d = await fetch('/api/admin/try-on-models/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tone: tone.id, force }),
      }).then((r) => r.json());
      if (!d.success) throw new Error(d.message);
      if (d.data.cached) toast('Using the portrait already generated for this tone (no new cost). Tap Regenerate for a new one.', { icon: '♻️' });
      setBusy('');
      await detect(d.data.url, 'ai');
    } catch (err) {
      toast.error(err.message || 'Generation failed', { duration: 8000 });
      setBusy('');
    }
  }

  async function save() {
    setBusy('save');
    try {
      const d = await fetch('/api/admin/try-on-models', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone: tone.id, portrait: draft.portrait, anchors: draft.anchors, source: draft.source }),
      }).then((r) => r.json());
      if (!d.success) throw new Error(d.message);
      toast.success(`${tone.label} model saved — live on the store`);
      setDraft(null);
      onSaved();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!confirm(`Remove the ${tone.label} model from the store?`)) return;
    setBusy('remove');
    try {
      const d = await fetch('/api/admin/try-on-models', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tone: tone.id, remove: true }),
      }).then((r) => r.json());
      if (!d.success) throw new Error(d.message);
      setDraft(null);
      onSaved();
    } catch (err) {
      toast.error(err.message || 'Remove failed');
    } finally {
      setBusy('');
    }
  }

  const live = !!(saved?.portrait && parseAnchors(saved.anchors));

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-50">
        <span className="h-5 w-5 rounded-full ring-2 ring-gray-100" style={{ background: tone.hex }} />
        <p className="font-semibold text-gray-900 flex-1">{tone.label}</p>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${dirty ? 'bg-amber-50 text-amber-700' : live ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {dirty ? 'Not saved' : live ? 'Live' : 'Not set'}
        </span>
      </div>
      <div className="relative aspect-[3/4] bg-gray-50">
        {current?.portrait ? (
          <>
            <img src={current.portrait} alt={`${tone.label} model`} className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0"><Dots anchors={current.anchors} /></div>
          </>
        ) : (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-gray-400">
            Front-facing, ears and neck visible, no jewellery, plain background.
          </p>
        )}
        {busy && busy !== 'save' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 text-xs font-semibold text-gray-600">
            <FiRefreshCw className="animate-spin" /> {{ upload: 'Uploading…', generate: 'Generating with AI… (up to a minute)', detect: 'Finding the face…', remove: 'Removing…' }[busy]}
          </div>
        )}
      </div>
      <div className="p-3 grid grid-cols-2 gap-2">
        <label className={`${btn} border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}>
          <FiUpload /> Upload photo
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={upload} disabled={!!busy} />
        </label>
        <button onClick={() => generate(false)} disabled={!!busy || !aiConfigured} title={aiConfigured ? '' : 'Add REPLICATE_API_TOKEN to enable'}
          className={`${btn} border-purple-200 text-purple-700 hover:bg-purple-50`}>
          <FiZap /> Generate with AI
        </button>
        {current?.portrait && (
          <button onClick={() => detect(current.portrait, current.source)} disabled={!!busy} className={`${btn} border-gray-200 text-gray-700 hover:bg-gray-50`}>
            <FiCrosshair /> Detect face
          </button>
        )}
        {aiConfigured && current?.source === 'ai' && (
          <button onClick={() => generate(true)} disabled={!!busy} className={`${btn} border-gray-200 text-gray-700 hover:bg-gray-50`}>
            <FiRefreshCw /> Regenerate
          </button>
        )}
        {dirty && (
          <button onClick={save} disabled={!!busy || !draft.anchors} className={`${btn} col-span-2 border-green-600 bg-green-600 text-white hover:bg-green-700`}>
            <FiSave /> {busy === 'save' ? 'Saving…' : 'Save & publish'}
          </button>
        )}
        {!dirty && live && (
          <button onClick={remove} disabled={!!busy} className={`${btn} col-span-2 border-red-100 text-red-600 hover:bg-red-50`}>
            <FiTrash2 /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

export default function TryOnModelsPage() {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/admin/try-on-models').then((r) => r.json());
      if (!d.success) throw new Error(d.message);
      setData(d.data);
    } catch (e) {
      toast.error(e.message || 'Could not load');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <h1 className="text-xl font-bold text-gray-900">AI Try-On Models</h1>
      <p className="text-sm text-gray-500 mt-1 mb-2 max-w-2xl">
        Shoppers pick a skin tone and see the piece on that model. The jewellery shown is always the product&apos;s own photo
        (its transparent Try-On image when set), so what they see is what ships.
      </p>
      <p className="text-xs text-gray-400 mb-5 max-w-2xl">
        Orange dots mark the ears and chin — if they&apos;re off, use a straighter, front-facing photo. Generated portraits are cached, so each tone costs only once.
      </p>
      {!data ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {SKIN_TONES.map((t) => (
            <ToneCard key={t.id} tone={t} saved={data.tones[t.id]} aiConfigured={data.aiConfigured} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}
