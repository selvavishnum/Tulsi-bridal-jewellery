import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireRole, CAN } from '@/lib/requireRole';
import { uploadImage } from '@/lib/cloudinary';
import { portraitPrompt } from '@/lib/tryOn';
import { promptHash, cachedGeneration, rememberGeneration } from '@/lib/tryOnModels';
import { hit, tooManyRequests } from '@/lib/rateLimit';

export const maxDuration = 60;

const MODEL = process.env.REPLICATE_MODEL || 'black-forest-labs/flux-1.1-pro';
const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* Runs a text-to-image prediction on Replicate; returns the image URL. */
async function generate(prompt, token) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
    method: 'POST',
    headers: { ...headers, prefer: 'wait=50' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: '3:4', output_format: 'png', safety_tolerance: 2 } }),
  });
  let p = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(p.detail || p.error || `Replicate error ${res.status}`);
  for (let i = 0; i < 8 && ['starting', 'processing'].includes(p.status) && p.urls?.get; i += 1) {
    await sleep(1500);
    p = await (await fetch(p.urls.get, { headers })).json();
  }
  if (p.status !== 'succeeded') throw new Error(p.error || 'The image is still generating — try again in a minute.');
  const out = Array.isArray(p.output) ? p.output[0] : p.output;
  if (typeof out !== 'string' || !out.startsWith('https://')) throw new Error('Replicate returned no image.');
  return out;
}

/* POST /api/admin/try-on-models/generate { tone, force? } — Option B:
   generate a base model portrait for one skin tone and store it in
   Cloudinary. The same prompt is served from cache unless `force`. */
export async function POST(request) {
  try {
    const auth = await requireRole(CAN.editCatalog);
    if (auth.error) return auth.error;
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return fail('AI generation isn’t set up — add REPLICATE_API_TOKEN in Vercel, or upload a portrait instead.', 503);
    const body = await request.json().catch(() => ({}));
    const prompt = portraitPrompt(body.tone);
    if (!prompt) return fail('Unknown skin tone.');

    const db = getDB();
    const hash = promptHash(prompt);
    if (!body.force) {
      const cached = await cachedGeneration(db, body.tone, hash);
      if (cached) return NextResponse.json({ success: true, data: { url: cached, cached: true } });
    }
    const limited = await hit(db, `tryonGen:${auth.session?.user?.email || 'admin'}`, { limit: 12, windowMs: 60 * 60_000 });
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Generation limit reached (12 per hour). Try again later.');

    const remote = await generate(prompt, token);
    const stored = await uploadImage(remote, 'tulsi-bridal/try-on-models', { allowedFormats: ['png', 'jpg', 'jpeg', 'webp'] });
    await rememberGeneration(db, body.tone, hash, stored.secure_url);
    return NextResponse.json({ success: true, data: { url: stored.secure_url, cached: false } });
  } catch (e) {
    console.error('[try-on/generate]', e.message);
    return fail(e.message || 'Generation failed', 502);
  }
}
