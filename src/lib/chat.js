/* ─────────────────────────────────────────────
   Customer ↔ seller chat — the rules both sides share.

   One conversation per (customer, seller). Messages are plain text, kept
   on the platform: phone numbers, emails and chat-app links are masked,
   so deals and payments stay on Tulsi where the customer is protected.

   Pure module — no '@/…' imports.
   ───────────────────────────────────────────── */

export const MAX_MESSAGE = 1000;
export const THREAD_LIMIT = 300;

export const conversationId = (customerId, vendorId) => `${customerId}__${vendorId}`;

const HIDDEN = '[contact hidden]';

/** Masks contact details so conversations stay on the platform. */
export function maskContacts(text) {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, HIDDEN)
    .replace(/\b(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me|instagram\.com|ig\.me)\/\S*/gi, HIDDEN)
    /* 10-digit Indian mobiles, with or without +91 / 0 and spaces or dashes. */
    .replace(/(?:\+?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}\b/g, HIDDEN);
}

/**
 * Cleans a message before it is stored.
 * @returns {{ text: string, masked: boolean } | { error: string }}
 */
export function cleanMessage(input) {
  const raw = typeof input === 'string' ? input.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
  if (!raw) return { error: 'Type a message.' };
  if (raw.length > MAX_MESSAGE) return { error: `Messages can be up to ${MAX_MESSAGE} characters.` };
  const text = maskContacts(raw);
  return { text, masked: text !== raw };
}

/** Short preview for lists and notifications. */
export const preview = (text, n = 90) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** What one side sees of a conversation. `side` is 'customer' or 'vendor'. */
export function conversationView(c, side) {
  return {
    id: c.id,
    with: side === 'customer' ? c.vendorName || 'Seller' : c.customerName || 'Customer',
    lastMessage: c.lastMessage || null,
    unread: (side === 'customer' ? c.unreadForCustomer : c.unreadForVendor) || 0,
    product: c.lastProduct || null,
    updatedAt: c.updatedAt,
  };
}

/** A message as either side sees it (no emails, ids of other people, or originals). */
export function messageView(m, side) {
  return {
    id: m.id,
    mine: m.from === side,
    from: m.from,
    text: m.text,
    product: m.product || null,
    orderNumber: m.orderNumber || null,
    at: m.at,
  };
}
