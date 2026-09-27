import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { uploadImage } from '@/lib/cloudinary';
import { hit, clientIp, LIMITS, tooManyRequests } from '@/lib/rateLimit';

export const maxDuration = 60;

const TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;

/* The file really is what it says (first bytes), not just by its label. */
function sniff(buf) {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/* POST /api/vendor-applications/upload — GST certificate for a seller application (public). */
export async function POST(request) {
  try {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return NextResponse.json({ success: false, message: 'Uploads are unavailable right now. Please try again later.' }, { status: 503 });
    }
    const limited = await hit(getDB(), `vendorUpload:ip:${clientIp(request.headers)}`, LIMITS.vendorUpload);
    if (!limited.allowed) return tooManyRequests(limited.retryAfterSec, 'Too many uploads. Please try again in an hour.');

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ success: false, message: 'Choose a file to upload.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ success: false, message: 'File must be 5 MB or smaller.' }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const type = sniff(buf);
    if (!type || !TYPES[file.type]) return NextResponse.json({ success: false, message: 'Upload a PDF, JPG or PNG file.' }, { status: 400 });

    const result = await uploadImage(`data:${type};base64,${buf.toString('base64')}`, 'tulsi-bridal/vendor-applications', {
      allowedFormats: Object.values(TYPES).concat('jpeg'),
    });
    return NextResponse.json({ success: true, data: { url: result.secure_url, type: TYPES[type] } });
  } catch (e) {
    console.error('[vendor-applications/upload]', e.message);
    return NextResponse.json({ success: false, message: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
