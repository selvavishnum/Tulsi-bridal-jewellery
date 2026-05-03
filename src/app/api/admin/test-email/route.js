import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { requireAdmin } from '@/lib/adminCollection';

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { testEmail } = await request.json();

    /* Check env vars are set */
    const missing = [];
    if (!process.env.SMTP_USER)   missing.push('SMTP_USER');
    if (!process.env.SMTP_PASS)   missing.push('SMTP_PASS');
    if (!process.env.ADMIN_EMAIL) missing.push('ADMIN_EMAIL');
    if (missing.length) {
      return NextResponse.json({
        success: false,
        message: `Missing env variables: ${missing.join(', ')}. Add them to your .env.local file and restart the server.`,
      });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    /* Verify connection first */
    await transporter.verify();

    /* Send test mail */
    const to = testEmail || process.env.ADMIN_EMAIL;
    await transporter.sendMail({
      from: `"Tulsi Bridal Jewellery" <${process.env.SMTP_USER}>`,
      to,
      subject: '✅ Email Test — Tulsi Bridal Jewellery',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="color:#8b1a4a;margin:0 0 12px;">Email is Working! ✅</h2>
          <p style="color:#374151;font-size:15px;">Your SMTP email notifications are configured correctly for <strong>Tulsi Bridal Jewellery</strong>.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"/>
          <p style="color:#6b7280;font-size:13px;">SMTP: <strong>${process.env.SMTP_HOST || 'smtp.gmail.com'}:${process.env.SMTP_PORT || '587'}</strong></p>
          <p style="color:#6b7280;font-size:13px;">Sent to: <strong>${to}</strong></p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, message: `Test email sent to ${to}` });
  } catch (err) {
    /* Return the real error so user knows what to fix */
    return NextResponse.json({
      success: false,
      message: err.message,
      code: err.code || null,
    });
  }
}
