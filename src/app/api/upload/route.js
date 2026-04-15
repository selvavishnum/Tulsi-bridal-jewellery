import { NextResponse } from 'next/server';
import { getBucket } from '@/lib/firebase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return NextResponse.json({ success: false, message: 'No file provided' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = file.name?.split('.').pop() || 'jpg';
    const filename = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const bucket = getBucket();
    const fileRef = bucket.file(filename);
    await fileRef.save(buffer, { contentType: file.type, public: true });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
    return NextResponse.json({
      success: true,
      data: { url: publicUrl, public_id: filename, secure_url: publicUrl },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
