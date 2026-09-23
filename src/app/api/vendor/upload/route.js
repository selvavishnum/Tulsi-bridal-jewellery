import { NextResponse } from 'next/server';
import { uploadImage } from '@/lib/cloudinary';
import { requireActiveVendor } from '@/lib/vendorAuth';

export const maxDuration = 60;

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

/* POST /api/vendor/upload — one product photo to Cloudinary, in a folder
   per vendor. Returns { url, publicId } for the product form. */
export async function POST(request) {
  try {
    const ctx = await requireActiveVendor();
    if (ctx.error) return ctx.error;
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return NextResponse.json({ success: false, message: 'Image upload is not set up yet — contact Tulsi.' }, { status: 503 });
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ success: false, message: 'No file provided' }, { status: 400 });
    if (!TYPES.has(file.type)) return NextResponse.json({ success: false, message: 'Use a JPG, PNG or WebP image.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ success: false, message: 'Image must be 8 MB or smaller.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadImage(`data:${file.type};base64,${buffer.toString('base64')}`, `tulsi-bridal/vendors/${ctx.vendorId}`);
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    console.error('[vendor/upload]', e.message);
    return NextResponse.json({ success: false, message: 'Upload failed. Try again.' }, { status: 500 });
  }
}
