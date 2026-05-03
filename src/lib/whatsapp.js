/**
 * WhatsApp notifications via UltraMsg API
 * Sign up free at: https://ultramsg.com
 * Get Instance ID + Token from your dashboard
 *
 * Env vars required:
 *   ULTRAMSG_INSTANCE_ID   — e.g. instance12345
 *   ULTRAMSG_TOKEN         — your API token
 *   ADMIN_WHATSAPP         — e.g. +917695868787  (admin number)
 *   STAFF_WHATSAPP         — comma-separated, e.g. +917695868787,+918765432109
 */

const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN    = process.env.ULTRAMSG_TOKEN;
const BASE_URL = () => `https://api.ultramsg.com/${INSTANCE}/messages/chat`;

export function isConfigured() {
  return !!(INSTANCE && TOKEN);
}

/* Normalize phone — ensure +91 prefix for Indian numbers */
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}

/* Core send function */
async function sendMessage(to, body) {
  if (!isConfigured()) return { success: false, message: 'WhatsApp not configured' };
  const phone = normalizePhone(to);
  if (!phone) return { success: false, message: 'Invalid phone number' };

  const res = await fetch(BASE_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: TOKEN, to: phone, body }).toString(),
  });
  const data = await res.json();
  return data?.sent === 'true' ? { success: true } : { success: false, message: data?.message };
}

/* Send to admin + all staff WhatsApp numbers */
async function notifyAdminAndStaff(body) {
  const numbers = [
    process.env.ADMIN_WHATSAPP,
    ...(process.env.STAFF_WHATSAPP || '').split(',').map((s) => s.trim()).filter(Boolean),
  ].filter(Boolean);

  return Promise.allSettled(numbers.map((n) => sendMessage(n, body)));
}

/* ─── Format helpers ─────────────────────────────── */

function formatCurrency(v) {
  return `₹${Number(v || 0).toLocaleString('en-IN')}`;
}

function formatItems(items = []) {
  return items
    .map((i) => `  • ${i.name} × ${i.quantity} — ${formatCurrency(i.price * i.quantity)}`)
    .join('\n');
}

/* ─── Notification functions ─────────────────────── */

/**
 * Admin alert: new order received
 */
export async function sendOrderWhatsAppToAdmin(order) {
  const addr = order.shippingAddress || {};
  const body =
`🛍️ *New Order — Tulsi Bridal Jewellery*

📦 Order: *${order.orderNumber}*
👤 Customer: ${addr.name || order.guestEmail || 'Guest'}
📱 Phone: ${addr.phone || 'N/A'}
💰 Total: *${formatCurrency(order.total)}*
💳 Payment: ${order.payment?.method || 'N/A'} — ${order.payment?.status || 'pending'}

🛒 Items:
${formatItems(order.items)}

📍 Delivery to: ${addr.city || ''}, ${addr.state || ''}

View in admin: ${process.env.NEXT_PUBLIC_SITE_URL || ''}/admin/orders`;

  return notifyAdminAndStaff(body);
}

/**
 * Customer confirmation: order placed successfully
 */
export async function sendOrderWhatsAppToCustomer(order) {
  const addr = order.shippingAddress || {};
  const phone = addr.phone;
  if (!phone) return { success: false, message: 'No customer phone number' };

  const body =
`✨ *Order Confirmed — Tulsi Bridal Jewellery*

Namaste ${addr.name || 'Customer'}! 🙏

Your order has been received and is being processed.

📦 Order No: *${order.orderNumber}*
💰 Total: *${formatCurrency(order.total)}*

🛒 Your items:
${formatItems(order.items)}

📍 Delivering to:
${addr.address || ''}${addr.city ? ', ' + addr.city : ''}${addr.state ? ', ' + addr.state : ''} — ${addr.pincode || ''}

📅 Expected delivery: 5–7 business days

Track your order: ${process.env.NEXT_PUBLIC_SITE_URL || ''}/track-order?order=${order.orderNumber}

Need help? Reply to this message or call us.
*Tulsi Bridal Jewellery* 💍`;

  return sendMessage(phone, body);
}

/**
 * Customer: order status changed (shipped, delivered, cancelled)
 */
export async function sendStatusWhatsApp(order, newStatus) {
  const addr = order.shippingAddress || {};
  const phone = addr.phone;
  if (!phone) return { success: false, message: 'No customer phone' };

  const statusMessages = {
    confirmed:  `✅ Your order *${order.orderNumber}* has been *confirmed* and will be packed soon.`,
    processing: `⚙️ Your order *${order.orderNumber}* is being *processed and packed*.`,
    shipped:    `🚚 Your order *${order.orderNumber}* has been *shipped!*\n\n📦 Courier: ${order.courierName || 'N/A'}\n🔢 Tracking: ${order.trackingNumber || 'Will be updated soon'}`,
    delivered:  `🎉 Your order *${order.orderNumber}* has been *delivered!*\n\nThank you for shopping with us. We hope you love your jewellery! 💍\n\nPlease leave a review: ${process.env.NEXT_PUBLIC_SITE_URL || ''}/product/${order.items?.[0]?.product || ''}`,
    cancelled:  `❌ Your order *${order.orderNumber}* has been *cancelled*.\n\nIf you paid online, refund will be processed in 5–7 business days.\n\nQuestions? Call or WhatsApp us.`,
  };

  const statusText = statusMessages[newStatus] || `Your order *${order.orderNumber}* status: *${newStatus}*`;

  const body =
`*Tulsi Bridal Jewellery — Order Update* 💍

Namaste ${addr.name || 'Customer'}!

${statusText}

View order: ${process.env.NEXT_PUBLIC_SITE_URL || ''}/track-order?order=${order.orderNumber}`;

  return sendMessage(phone, body);
}

/**
 * Admin alert: new contact message
 */
export async function sendContactWhatsApp(msg) {
  const body =
`📩 *New Contact Message — Tulsi Bridal*

👤 Name: ${msg.name}
📧 Email: ${msg.email}
📱 Phone: ${msg.phone || 'N/A'}
📝 Subject: ${msg.subject || 'No subject'}

💬 Message:
${msg.message}

Reply in admin: ${process.env.NEXT_PUBLIC_SITE_URL || ''}/admin/messages`;

  return notifyAdminAndStaff(body);
}

/**
 * Admin alert: new product review
 */
export async function sendReviewWhatsApp(review) {
  const stars = '⭐'.repeat(review.rating || 0);
  const body =
`⭐ *New Review — Tulsi Bridal*

Product: ${review.productName || review.productId}
By: ${review.reviewerName}
Rating: ${stars} (${review.rating}/5)

"${review.comment}"

View reviews: ${process.env.NEXT_PUBLIC_SITE_URL || ''}/admin`;

  return notifyAdminAndStaff(body);
}
