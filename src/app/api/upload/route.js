import { NextResponse } from 'next/server';
import { uploadImage } from '@/lib/cloudinary';
import { requireRole, ROLES } from '@/lib/requireRole';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const auth = await requireRole([ROLES.SUPER_ADMIN, ROLES.CATALOG_STAFF]);
    if (auth.error) return auth.error;
    const { session } = auth;

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return NextResponse.json({ success: false, message: 'Cloudinary not configured — add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to Vercel environment variables.' }, { status: 503 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return NextResponse.json({ success: false, message: 'No file provided' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`;
    const result = await uploadImage(dataUrl, 'tulsi-bridal/products');
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
