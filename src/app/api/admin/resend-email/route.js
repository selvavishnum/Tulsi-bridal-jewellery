import { NextResponse } from 'next/server';
import { getDB, docToObj } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import nodemailer from 'nodemailer';

/* POST /api/admin/resend-email  { orderId, type: 'customer' | 'admin' } */
export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { orderId, type = 'admin' } = await request.json();
    if (!orderId) return NextResponse.json({ success: false, message: 'orderId required' }, { status: 400 });

    /* Check env vars */
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return NextResponse.json({
        success: false,
        message: 'SMTP_USER or SMTP_PASS not set in .env.local — add them and restart server.',
      });
    }
    if (!process.env.ADMIN_EMAIL) {
      return NextResponse.json({
        success: false,
        message: 'ADMIN_EMAIL not set in .env.local',
      });
    }

    const db = getDB();
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });

    const order = { id: doc.id, _id: doc.id, ...docToObj(doc) };
    const addr  = order.shippingAddress || {};
    addr.name   = addr.name || addr.fullName || 'Customer';

    /* Who receives this email? */
    const customerEmail = order.guestEmail || addr.email || '';
    const adminEmails   = [
      process.env.ADMIN_EMAIL,
      ...(process.env.STAFF_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean),
    ].filter(Boolean);

    if (type === 'customer' && !customerEmail) {
      return NextResponse.json({ success: false, message: 'No customer email on this order' });
    }

    /* Build a simple plain confirmation email for debugging */
    const to      = type === 'customer' ? customerEmail : adminEmails;
    const subject = type === 'customer'
      ? `Order Confirmed #${order.orderNumber} | Tulsi Bridal Jewellery`
      : `🛍 New Order #${order.orderNumber} — ₹${order.total} | Tulsi Bridal Jewellery`;

    const itemRows = (order.items || []).map((i) =>
      `<tr>
        <td style="padding:6px 0;font-size:14px;color:#292524;">${i.name} × ${i.quantity}</td>
        <td style="padding:6px 0;font-size:14px;color:#8b1a4a;text-align:right;font-weight:700;">
          ₹${((i.price || 0) * i.quantity).toLocaleString('en-IN')}
        </td>
      </tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;">

  <tr><td style="background:linear-gradient(135deg,#8b1a4a,#601238);padding:28px 40px;text-align:center;">
    <p style="margin:0;font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#fff;letter-spacing:0.12em;">TULSI</p>
    <p style="margin:2px 0 0;font-size:10px;letter-spacing:0.3em;color:#c9973a;text-transform:uppercase;">Bridal Jewellery</p>
  </td></tr>

  <tr><td style="padding:32px 40px;">
    ${type === 'customer'
      ? `<h2 style="margin:0 0 8px;font-family:Georgia,serif;font-size:22px;color:#292524;">Your Order is Confirmed! 🎉</h2>
         <p style="margin:0 0 20px;font-size:14px;color:#78716c;">Thank you ${addr.name}! We are preparing your order.</p>`
      : `<h2 style="margin:0 0 8px;font-family:Georgia,serif;font-size:22px;color:#292524;">New Order Received 🛍️</h2>
         <p style="margin:0 0 20px;font-size:14px;color:#78716c;">A new order has been placed.</p>`
    }

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf9ee;border:1px solid #e4dfc8;border-radius:12px;margin-bottom:20px;">
      <tr><td style="padding:18px 22px;">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#78716c;">Order Number</p>
        <p style="margin:0;font-family:monospace;font-size:22px;font-weight:700;color:#8b1a4a;">#${order.orderNumber}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#78716c;">Customer: <strong style="color:#44403c;">${addr.name}</strong></p>
        <p style="margin:3px 0 0;font-size:13px;color:#78716c;">Email: <strong style="color:#44403c;">${customerEmail || '—'}</strong></p>
        <p style="margin:3px 0 0;font-size:13px;color:#78716c;">Phone: <strong style="color:#44403c;">${addr.phone || '—'}</strong></p>
        <p style="margin:3px 0 0;font-size:13px;color:#78716c;">Payment: <strong style="color:#44403c;">${order.payment?.method || '—'} — ${order.payment?.status || '—'}</strong></p>
      </td></tr>
    </table>

    <h3 style="margin:0 0 10px;font-size:13px;font-weight:700;color:#44403c;text-transform:uppercase;letter-spacing:0.1em;">Items Ordered</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${itemRows}
      <tr style="border-top:2px solid #f5f5f4;">
        <td style="padding:10px 0;font-size:15px;font-weight:700;color:#292524;">Total</td>
        <td style="padding:10px 0;text-align:right;font-size:16px;font-weight:700;color:#8b1a4a;">₹${(order.total || 0).toLocaleString('en-IN')}</td>
      </tr>
    </table>

    <p style="margin:24px 0 0;font-size:13px;color:#a8a29e;">Questions? WhatsApp us at +91 76958 68787</p>
  </td></tr>

  <tr><td style="background:#1c1917;padding:20px 40px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#78716c;">© ${new Date().getFullYear()} Tulsi Bridal Jewellery. All rights reserved.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

    /* Send */
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST  || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.verify();
    await transporter.sendMail({
      from: `"Tulsi Bridal Jewellery" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });

    return NextResponse.json({
      success: true,
      message: `Email sent to: ${Array.isArray(to) ? to.join(', ') : to}`,
    });
  } catch (err) {
    console.error('[Resend Email]', err);
    return NextResponse.json({ success: false, message: err.message, code: err.code || null });
  }
}
