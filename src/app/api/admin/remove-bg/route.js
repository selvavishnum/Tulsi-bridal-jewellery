import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminCollection';

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const apiKey = process.env.REMOVE_BG_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        message: 'REMOVE_BG_API_KEY not set. Get a free key at remove.bg and add it to Vercel environment variables.',
      }, { status: 503 });
    }

    const formData = await request.formData();
    const imageFile = formData.get('image');
    if (!imageFile) return NextResponse.json({ success: false, message: 'No image provided' }, { status: 400 });

    const body = new FormData();
    body.append('image_file', imageFile);
    body.append('size', 'auto');

    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ success: false, message: `remove.bg error: ${res.status} ${err}` }, { status: 500 });
    }

    // remove.bg returns raw PNG bytes
    const pngBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(pngBuffer).toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;

    return NextResponse.json({ success: true, dataUrl });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
