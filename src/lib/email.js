import nodemailer from 'nodemailer';

/* ── SMTP Transporter ── */
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const BRAND = {
  name:    'Tulsi Bridal Jewellery',
  primary: '#8b1a4a',
  gold:    '#c9973a',
  site:    process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tulsibridal.com',
};

/* ── Shared email wrapper ── */
function emailWrapper(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${BRAND.name}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#8b1a4a 0%,#601238 100%);padding:32px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.12em;">TULSI</p>
          <p style="margin:0;font-size:10px;letter-spacing:0.3em;color:#c9973a;text-transform:uppercase;">Bridal Jewellery</p>
        </td>
      </tr>

      <!-- Content -->
      <tr><td style="padding:36px 40px;">${content}</td></tr>

      <!-- Footer -->
      <tr>
        <td style="background:#1c1917;padding:24px 40px;text-align:center;">
          <p style="margin:0 0 6px;font-size:12px;color:#78716c;">${BRAND.name}</p>
          <p style="margin:0 0 12px;font-size:11px;color:#57534e;">
            <a href="${BRAND.site}" style="color:#c9973a;text-decoration:none;">${BRAND.site}</a>
          </p>
          <p style="margin:0;font-size:10px;color:#44403c;">© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/* ── Helper: format price ── */
function fmt(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
}

/* ── Helper: order items table ── */
function itemsTable(items = []) {
  const rows = items.map((item) => `
    <tr style="border-bottom:1px solid #f5f5f4;">
      <td style="padding:10px 0;">
        ${item.image ? `<img src="${item.image}" alt="${item.name}" width="48" height="48" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid #e7e5e4;vertical-align:middle;margin-right:10px;"/>` : ''}
        <span style="font-size:14px;color:#292524;font-weight:600;">${item.name}</span>
        <span style="font-size:12px;color:#78716c;margin-left:6px;">× ${item.quantity}</span>
      </td>
      <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:700;color:#8b1a4a;white-space:nowrap;">${fmt((item.price || 0) * item.quantity)}</td>
    </tr>`).join('');

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
}

/* ── Helper: CTA button ── */
function ctaBtn(text, url) {
  return `<a href="${url}" style="display:inline-block;margin-top:24px;padding:14px 32px;background:#8b1a4a;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.05em;">${text}</a>`;
}

/* ═══════════════════════════════════════════
   1. CUSTOMER ORDER CONFIRMATION
   ═══════════════════════════════════════════ */
export async function sendOrderConfirmation(order) {
  const to = order.guestEmail || order.shippingAddress?.email;
  if (!to || !process.env.SMTP_USER) return;

  const addr = order.shippingAddress || {};
  const trackUrl = `${BRAND.site}/track-order?orderNumber=${order.orderNumber}&email=${encodeURIComponent(to)}`;

  const html = emailWrapper(`
    <h2 style="margin:0 0 6px;font-family:Georgia,serif;font-size:24px;color:#292524;">Your Order is Confirmed! 🎉</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#78716c;">Thank you for shopping with ${BRAND.name}. We're preparing your jewellery with care.</p>

    <!-- Order number box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf9ee;border:1px solid #e4dfc8;border-radius:12px;margin-bottom:28px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#78716c;">Order Number</p>
          <p style="margin:0;font-family:monospace;font-size:22px;font-weight:700;color:#8b1a4a;">#${order.orderNumber}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#a8a29e;">${new Date(order.createdAt).toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
        </td>
      </tr>
    </table>

    <!-- Items -->
    <h3 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#44403c;text-transform:uppercase;letter-spacing:0.1em;">Items Ordered</h3>
    ${itemsTable(order.items)}

    <!-- Totals -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:2px solid #f5f5f4;">
      <tr><td style="padding:8px 0;font-size:13px;color:#78716c;">Subtotal</td><td style="padding:8px 0;text-align:right;font-size:13px;color:#78716c;">${fmt(order.subtotal)}</td></tr>
      ${order.discount > 0 ? `<tr><td style="padding:4px 0;font-size:13px;color:#16a34a;">Discount</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#16a34a;">−${fmt(order.discount)}</td></tr>` : ''}
      <tr><td style="padding:4px 0;font-size:13px;color:#78716c;">Shipping</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#78716c;">${order.shippingCost === 0 ? 'FREE' : fmt(order.shippingCost)}</td></tr>
      <tr><td style="padding:10px 0 0;font-size:16px;font-weight:700;color:#292524;border-top:1px solid #e7e5e4;">Total Paid</td><td style="padding:10px 0 0;text-align:right;font-size:18px;font-weight:700;color:#8b1a4a;border-top:1px solid #e7e5e4;">${fmt(order.total)}</td></tr>
    </table>

    <!-- Delivery address -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;background:#f9f9f8;border-radius:10px;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.15em;color:#78716c;font-weight:700;">Delivering To</p>
        <p style="margin:0;font-size:14px;color:#292524;font-weight:600;">${addr.name || ''}</p>
        <p style="margin:2px 0 0;font-size:13px;color:#57534e;line-height:1.6;">${[addr.street, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ')}</p>
        ${addr.phone ? `<p style="margin:4px 0 0;font-size:13px;color:#78716c;">${addr.phone}</p>` : ''}
      </td></tr>
    </table>

    <!-- Payment -->
    <p style="margin:20px 0 0;font-size:13px;color:#78716c;">
      <strong style="color:#292524;">Payment:</strong> ${order.payment?.method?.toUpperCase() || 'COD'} —
      <span style="color:${order.payment?.status === 'paid' ? '#16a34a' : '#ca8a04'};font-weight:600;">${order.payment?.status || 'Pending'}</span>
    </p>

    <p style="margin:24px 0 0;font-size:14px;color:#57534e;">We'll notify you once your order is shipped. Estimated delivery: <strong style="color:#292524;">4–7 business days</strong>.</p>

    ${ctaBtn('Track Your Order →', trackUrl)}

    <p style="margin:28px 0 0;font-size:13px;color:#a8a29e;">Questions? Reply to this email or WhatsApp us at +91 98765 43210.</p>
  `);

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"${BRAND.name}" <${process.env.SMTP_USER}>`,
      to,
      subject: `Order Confirmed #${order.orderNumber} | ${BRAND.name}`,
      html,
    });
  } catch (err) {
    console.error('[Email] Order confirmation failed:', err.message);
  }
}

/* ═══════════════════════════════════════════
   2. ADMIN NEW ORDER NOTIFICATION
   ═══════════════════════════════════════════ */
export async function sendOrderNotificationToAdmin(order) {
  const adminEmails = [
    process.env.ADMIN_EMAIL,
    ...(process.env.STAFF_EMAILS || '').split(',').map((e) => e.trim()),
  ].filter(Boolean);

  if (!adminEmails.length || !process.env.SMTP_USER) return;

  const customerEmail = order.guestEmail || order.shippingAddress?.email || '—';
  const adminUrl = `${BRAND.site}/admin/orders`;

  const html = emailWrapper(`
    <h2 style="margin:0 0 6px;font-family:Georgia,serif;font-size:22px;color:#292524;">New Order Received 🛍️</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#78716c;">A new order has been placed on ${BRAND.name}.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f0;border:1px solid #e4dfc8;border-radius:12px;margin-bottom:24px;">
      <tr><td style="padding:20px 24px;">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#78716c;">Order</p>
        <p style="margin:0 0 12px;font-family:monospace;font-size:22px;font-weight:700;color:#8b1a4a;">#${order.orderNumber}</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#78716c;padding:3px 0;"><strong style="color:#44403c;">Customer:</strong></td>
            <td style="font-size:13px;color:#44403c;padding:3px 0;">${order.shippingAddress?.name || '—'}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#78716c;padding:3px 0;"><strong style="color:#44403c;">Email:</strong></td>
            <td style="font-size:13px;color:#44403c;padding:3px 0;">${customerEmail}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#78716c;padding:3px 0;"><strong style="color:#44403c;">Phone:</strong></td>
            <td style="font-size:13px;color:#44403c;padding:3px 0;">${order.shippingAddress?.phone || '—'}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#78716c;padding:3px 0;"><strong style="color:#44403c;">Total:</strong></td>
            <td style="font-size:16px;font-weight:700;color:#8b1a4a;padding:3px 0;">${fmt(order.total)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#78716c;padding:3px 0;"><strong style="color:#44403c;">Payment:</strong></td>
            <td style="font-size:13px;color:#44403c;padding:3px 0;">${order.payment?.method || '—'} — ${order.payment?.status || '—'}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#78716c;padding:3px 0;"><strong style="color:#44403c;">Items:</strong></td>
            <td style="font-size:13px;color:#44403c;padding:3px 0;">${order.items?.length || 0} item(s)</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <h3 style="margin:0 0 10px;font-size:13px;font-weight:700;color:#44403c;text-transform:uppercase;letter-spacing:0.1em;">Items</h3>
    ${itemsTable(order.items)}

    ${ctaBtn('View Order in Admin →', adminUrl)}
  `);

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"${BRAND.name}" <${process.env.SMTP_USER}>`,
      to: adminEmails,
      subject: `🛍 New Order #${order.orderNumber} — ${fmt(order.total)} | ${BRAND.name}`,
      html,
    });
  } catch (err) {
    console.error('[Email] Admin order notification failed:', err.message);
  }
}

/* ═══════════════════════════════════════════
   3. CUSTOMER ORDER STATUS UPDATE
   ═══════════════════════════════════════════ */
export async function sendStatusUpdateEmail(order, newStatus) {
  const to = order.guestEmail || order.shippingAddress?.email;
  if (!to || !process.env.SMTP_USER) return;

  const STATUS_MSG = {
    confirmed:  { emoji: '✅', title: 'Order Confirmed', body: 'Great news! Your order has been confirmed and will be prepared soon.' },
    processing: { emoji: '🎁', title: 'Being Prepared',  body: 'Your jewellery is being carefully prepared and packaged with love.' },
    shipped:    { emoji: '🚚', title: 'Order Shipped',   body: 'Your order is on its way! Expected delivery in 2–4 business days.' },
    delivered:  { emoji: '🎉', title: 'Delivered!',      body: 'Your order has been delivered. We hope you love your jewellery!' },
    cancelled:  { emoji: '❌', title: 'Order Cancelled', body: 'Your order has been cancelled. If you paid, a refund will be processed in 5–7 business days.' },
  };

  const msg = STATUS_MSG[newStatus];
  if (!msg) return;

  const trackUrl = `${BRAND.site}/track-order?orderNumber=${order.orderNumber}&email=${encodeURIComponent(to)}`;

  const html = emailWrapper(`
    <p style="font-size:36px;margin:0 0 12px;">${msg.emoji}</p>
    <h2 style="margin:0 0 8px;font-family:Georgia,serif;font-size:22px;color:#292524;">${msg.title}</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#78716c;">${msg.body}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf9ee;border:1px solid #e4dfc8;border-radius:12px;margin-bottom:24px;">
      <tr><td style="padding:18px 22px;">
        <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#78716c;">Order Number</p>
        <p style="margin:4px 0 0;font-family:monospace;font-size:18px;font-weight:700;color:#8b1a4a;">#${order.orderNumber}</p>
        ${order.trackingNumber ? `<p style="margin:8px 0 0;font-size:13px;color:#57534e;"><strong>Tracking #:</strong> <span style="font-family:monospace;color:#8b1a4a;">${order.trackingNumber}</span>${order.courierName ? ` (${order.courierName})` : ''}</p>` : ''}
      </td></tr>
    </table>

    ${newStatus !== 'cancelled' ? ctaBtn('Track Your Order →', trackUrl) : ''}
    <p style="margin:24px 0 0;font-size:13px;color:#a8a29e;">Questions? Reply to this email or WhatsApp us at +91 98765 43210.</p>
  `);

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"${BRAND.name}" <${process.env.SMTP_USER}>`,
      to,
      subject: `${msg.emoji} ${msg.title} — Order #${order.orderNumber}`,
      html,
    });
  } catch (err) {
    console.error('[Email] Status update email failed:', err.message);
  }
}

/* ═══════════════════════════════════════════
   4. ADMIN NEW REVIEW NOTIFICATION
   ═══════════════════════════════════════════ */
export async function sendReviewNotification(review) {
  const adminEmails = [
    process.env.ADMIN_EMAIL,
    ...(process.env.STAFF_EMAILS || '').split(',').map((e) => e.trim()),
  ].filter(Boolean);

  if (!adminEmails.length || !process.env.SMTP_USER) return;

  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);

  const html = emailWrapper(`
    <h2 style="margin:0 0 6px;font-family:Georgia,serif;font-size:22px;color:#292524;">New Product Review ⭐</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#78716c;">A customer has left a review on ${BRAND.name}.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf9ee;border:1px solid #e4dfc8;border-radius:12px;">
      <tr><td style="padding:20px 24px;">
        <p style="margin:0 0 4px;font-size:20px;color:#c9973a;letter-spacing:2px;">${stars}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#78716c;"><strong style="color:#44403c;">Reviewer:</strong> ${review.reviewerName || 'Anonymous'}</p>
        ${review.reviewerEmail ? `<p style="margin:4px 0 0;font-size:13px;color:#78716c;"><strong style="color:#44403c;">Email:</strong> ${review.reviewerEmail}</p>` : ''}
        <p style="margin:4px 0 0;font-size:13px;color:#78716c;"><strong style="color:#44403c;">Product:</strong> ${review.productName || review.productId}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#78716c;"><strong style="color:#44403c;">Rating:</strong> ${review.rating}/5</p>
        <p style="margin:12px 0 0;font-size:14px;color:#292524;font-style:italic;border-left:3px solid #c9973a;padding-left:12px;">"${review.comment}"</p>
      </td></tr>
    </table>

    ${ctaBtn('View in Admin →', `${BRAND.site}/admin/products`)}
  `);

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"${BRAND.name}" <${process.env.SMTP_USER}>`,
      to: adminEmails,
      subject: `⭐ New ${review.rating}-star Review — ${review.productName || 'Product'} | ${BRAND.name}`,
      html,
    });
  } catch (err) {
    console.error('[Email] Review notification failed:', err.message);
  }
}

/* ═══════════════════════════════════════════
   5. ADMIN NEW CONTACT MESSAGE
   ═══════════════════════════════════════════ */
export async function sendContactNotification(msg) {
  const adminEmails = [
    process.env.ADMIN_EMAIL,
    ...(process.env.STAFF_EMAILS || '').split(',').map((e) => e.trim()),
  ].filter(Boolean);

  if (!adminEmails.length || !process.env.SMTP_USER) return;

  const html = emailWrapper(`
    <h2 style="margin:0 0 6px;font-family:Georgia,serif;font-size:22px;color:#292524;">New Contact Message 📩</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#78716c;">A visitor has sent a message via the contact form.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f8;border-radius:12px;">
      <tr><td style="padding:20px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="100" style="font-size:13px;color:#78716c;padding:4px 0;font-weight:600;">Name:</td>
            <td style="font-size:13px;color:#292524;padding:4px 0;">${msg.name}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#78716c;padding:4px 0;font-weight:600;">Email:</td>
            <td style="font-size:13px;padding:4px 0;"><a href="mailto:${msg.email}" style="color:#8b1a4a;">${msg.email}</a></td>
          </tr>
          ${msg.phone ? `<tr><td style="font-size:13px;color:#78716c;padding:4px 0;font-weight:600;">Phone:</td><td style="font-size:13px;color:#292524;padding:4px 0;">${msg.phone}</td></tr>` : ''}
          ${msg.subject ? `<tr><td style="font-size:13px;color:#78716c;padding:4px 0;font-weight:600;">Subject:</td><td style="font-size:13px;color:#292524;padding:4px 0;">${msg.subject}</td></tr>` : ''}
        </table>
        <p style="margin:16px 0 0;font-size:14px;color:#292524;line-height:1.6;border-top:1px solid #e7e5e4;padding-top:16px;">${msg.message.replace(/\n/g, '<br/>')}</p>
      </td></tr>
    </table>

    <a href="mailto:${msg.email}?subject=Re: ${encodeURIComponent(msg.subject || 'Your enquiry')}" style="display:inline-block;margin-top:24px;padding:12px 28px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">Reply to ${msg.name} →</a>
    ${ctaBtn('View in Admin →', `${BRAND.site}/admin/messages`)}
  `);

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"${BRAND.name}" <${process.env.SMTP_USER}>`,
      to: adminEmails,
      replyTo: msg.email,
      subject: `📩 New Message from ${msg.name}${msg.subject ? ` — ${msg.subject}` : ''} | ${BRAND.name}`,
      html,
    });
  } catch (err) {
    console.error('[Email] Contact notification failed:', err.message);
  }
}
