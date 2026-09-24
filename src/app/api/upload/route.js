import { NextResponse } from 'next/server';
import { uploadImage } from '@/lib/cloudinary';
import { requireRole, CAN } from '@/lib/requireRole';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const auth = await requireRole(CAN.editCatalog);
    if (auth.error) return auth.error;
    const { session } = auth;

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return NextResponse.json({ success: false, message: 'Cloudinary not configured — add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to Vercel environment variables.' }, { status: 503 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ success: false, message: 'No file provided' }, { status: 400 });
    /* Raster images only — an SVG can carry script. Same rule as vendor uploads. */
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return NextResponse.json({ success: false, message: 'Use a JPG, PNG or WebP image.' }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) return NextResponse.json({ success: false, message: 'Image must be 15 MB or smaller.' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`;
    const result = await uploadImage(dataUrl, 'tulsi-bridal/products');
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
