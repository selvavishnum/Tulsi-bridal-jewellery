/* ─────────────────────────────────────────────
   Customer ↔ seller chat — Firestore side.

   conversations/{customerId__vendorId}
     customerId, customerName, customerEmail, vendorId, vendorName,
     lastMessage { text, from, at }, lastProduct { id, name, image },
     unreadForVendor, unreadForCustomer, createdAt, updatedAt
   chat_messages/{auto}
     conversationId, from ('customer' | 'vendor'), text, masked,
     product?, orderNumber?, at

   Takes `db`; callers authenticate. Each side can only reach
   conversations that carry its own id.
   ───────────────────────────────────────────── */
import { conversationId, cleanMessage, conversationView, messageView, preview, THREAD_LIMIT } from './chat.js';
import { PLATFORM_VENDOR_ID } from './data/scopedDb.js';

export class ChatError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const firstImage = (p) => (Array.isArray(p.images) ? p.images.find((u) => typeof u === 'string' && u.startsWith('https://')) : null) || null;

/* Adds one message and bumps the other side's unread count.
   Returns { message, notify } — notify is true when the other side had
   nothing unread before (one email per burst, not per message). */
async function append(db, convRef, base, from, clean, context = {}) {
  const msgRef = db.collection('chat_messages').doc();
  const at = new Date().toISOString();
  const other = from === 'customer' ? 'unreadForVendor' : 'unreadForCustomer';
  const mine = from === 'customer' ? 'unreadForCustomer' : 'unreadForVendor';
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(convRef);
    const cur = snap.exists ? snap.data() : null;
    const message = { conversationId: convRef.id, from, text: clean.text, masked: clean.masked, at, ...context };
    const patch = {
      lastMessage: { text: preview(clean.text), from, at },
      [other]: ((cur && cur[other]) || 0) + 1,
      [mine]: 0,
      updatedAt: at,
      ...(context.product && { lastProduct: context.product }),
    };
    if (cur) tx.update(convRef, patch);
    else tx.set(convRef, { ...base, unreadForVendor: 0, unreadForCustomer: 0, createdAt: at, ...patch });
    tx.set(msgRef, message);
    return { message: { id: msgRef.id, ...message }, notify: !cur || !cur[other] };
  });
}

/**
 * A customer writes to the seller of a product (starts the conversation
 * if needed). `orderNumber` is attached only if it is the customer's order.
 */
export async function customerSendAboutProduct(db, customer, { productId, orderNumber, text }) {
  const clean = cleanMessage(text);
  if (clean.error) throw new ChatError(clean.error);
  const pSnap = productId ? await db.collection('products').doc(String(productId)).get() : null;
  if (!pSnap?.exists) throw new ChatError('Product not found', 404);
  const p = pSnap.data();
  if (!p.vendorId || p.vendorId === PLATFORM_VENDOR_ID) throw new ChatError('This piece is sold by Tulsi — please use WhatsApp or the contact page.');
  const vSnap = await db.collection('vendors').doc(p.vendorId).get();
  if (!vSnap.exists || vSnap.data().status === 'suspended') throw new ChatError('This seller isn’t taking messages right now.', 409);

  let order = null;
  if (orderNumber) {
    const o = await db.collection('orders').where('orderNumber', '==', String(orderNumber)).limit(1).get();
    if (!o.empty && o.docs[0].data().userId === customer.id) order = String(orderNumber);
  }
  const convRef = db.collection('conversations').doc(conversationId(customer.id, p.vendorId));
  const product = { id: pSnap.id, name: String(p.name || '').slice(0, 120), image: firstImage(p) };
  const base = {
    customerId: customer.id, customerName: customer.name || 'Customer', customerEmail: customer.email || null,
    vendorId: p.vendorId, vendorName: vSnap.data().name || 'Seller',
  };
  const r = await append(db, convRef, base, 'customer', clean, { product, ...(order && { orderNumber: order }) });
  return { conversationId: convRef.id, ...r, vendor: { id: p.vendorId, ...vSnap.data() } };
}

/** Loads a conversation if `side`/`ownerId` may see it; otherwise 404. */
export async function getConversation(db, id, side, ownerId) {
  const ref = db.collection('conversations').doc(String(id));
  const snap = await ref.get();
  const c = snap.exists ? { id: snap.id, ...snap.data() } : null;
  const owner = side === 'customer' ? c?.customerId : c?.vendorId;
  if (!c || !ownerId || owner !== ownerId) throw new ChatError('Conversation not found', 404);
  return { ref, conversation: c };
}

/** Reply inside an existing conversation. */
export async function sendInConversation(db, id, side, ownerId, text) {
  const clean = cleanMessage(text);
  if (clean.error) throw new ChatError(clean.error);
  const { ref, conversation } = await getConversation(db, id, side, ownerId);
  if (side === 'customer') {
    const v = await db.collection('vendors').doc(conversation.vendorId).get();
    if (!v.exists || v.data().status === 'suspended') throw new ChatError('This seller isn’t taking messages right now.', 409);
  }
  const r = await append(db, ref, null, side, clean);
  return { ...r, conversation };
}

/** One side's conversations, newest first. */
export async function listConversations(db, side, ownerId) {
  const field = side === 'customer' ? 'customerId' : 'vendorId';
  const snap = await db.collection('conversations').where(field, '==', ownerId).get();
  return snap.docs
    .map((d) => conversationView({ id: d.id, ...d.data() }, side))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Messages in a conversation (oldest first); marks them read for `side`. */
export async function readThread(db, id, side, ownerId) {
  const { ref, conversation } = await getConversation(db, id, side, ownerId);
  const snap = await db.collection('chat_messages').where('conversationId', '==', ref.id).get();
  /* Sorted here — no composite index needed. */
  const messages = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-THREAD_LIMIT)
    .map((m) => messageView(m, side));
  const unreadField = side === 'customer' ? 'unreadForCustomer' : 'unreadForVendor';
  if (conversation[unreadField]) await ref.update({ [unreadField]: 0 });
  return { conversation: conversationView({ ...conversation, [unreadField]: 0 }, side), messages };
}

/** Total unread for a badge. */
export async function unreadCount(db, side, ownerId) {
  const list = await listConversations(db, side, ownerId);
  return list.reduce((s, c) => s + c.unread, 0);
}
