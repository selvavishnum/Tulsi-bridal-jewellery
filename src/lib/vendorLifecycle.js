/* ─────────────────────────────────────────────
   Suspending, blocking, reactivating and deleting a vendor.

   Leaving "active" hides the vendor's shop products (only those that were
   visible, flagged hiddenByVendorStatus) so shoppers never see a piece
   they can't buy; returning to "active" restores exactly those. Blocking
   also turns off their dashboard logins (flagged loginDisabledByBlock),
   and unblocking turns those back on. Takes `db`.
   ───────────────────────────────────────────── */
import { VENDOR_STATUSES, vendorStatusOf } from './vendorStatus.js';

export class VendorLifecycleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * @returns {Promise<{ from: string, to: string, productsHidden: number, productsRestored: number, loginsOff: number, loginsOn: number }>}
 */
export async function setVendorStatus(db, vendorId, next, by = null) {
  if (!VENDOR_STATUSES.includes(next)) throw new VendorLifecycleError('Status must be active, suspended or blocked.');
  const ref = db.collection('vendors').doc(vendorId);
  const snap = await ref.get();
  if (!snap.exists) throw new VendorLifecycleError('Vendor not found', 404);
  const from = vendorStatusOf(snap.data());
  const now = new Date().toISOString();
  const out = { from, to: next, productsHidden: 0, productsRestored: 0, loginsOff: 0, loginsOn: 0 };
  if (from === next) return out;

  await ref.update({ status: next, statusChangedAt: now, statusChangedBy: by, updatedAt: now });

  const products = await db.collection('products').where('vendorId', '==', vendorId).get();
  if (from === 'active') {
    for (const d of products.docs) {
      if (d.data().showMe === false) continue;
      await d.ref.update({ showMe: false, hiddenByVendorStatus: true, updatedAt: now });
      out.productsHidden += 1;
    }
  } else if (next === 'active') {
    for (const d of products.docs) {
      if (d.data().hiddenByVendorStatus !== true) continue;
      await d.ref.update({ showMe: true, hiddenByVendorStatus: false, updatedAt: now });
      out.productsRestored += 1;
    }
  }

  const logins = await db.collection('staff').where('vendorId', '==', vendorId).get();
  if (next === 'blocked') {
    for (const d of logins.docs) {
      if (d.data().status !== 'Active') continue;
      await d.ref.update({ status: 'Inactive', loginDisabledByBlock: true, updatedAt: now });
      out.loginsOff += 1;
    }
  } else if (from === 'blocked') {
    for (const d of logins.docs) {
      if (d.data().loginDisabledByBlock !== true) continue;
      await d.ref.update({ status: 'Active', loginDisabledByBlock: false, updatedAt: now });
      out.loginsOn += 1;
    }
  }
  return out;
}

/**
 * Permanently deletes a vendor with no trading history: their products,
 * dashboard logins, chats and the vendor record. A vendor with orders or
 * ledger/payout entries can't be deleted — those records back accounts
 * and GST — so block them instead.
 */
export async function deleteVendor(db, vendorId) {
  const ref = db.collection('vendors').doc(vendorId);
  if (!(await ref.get()).exists) throw new VendorLifecycleError('Vendor not found', 404);
  const [ledger, orders] = await Promise.all([
    db.collection('vendorLedger').where('vendorId', '==', vendorId).limit(1).get(),
    db.collection('orders').where('vendorIds', 'array-contains', vendorId).limit(1).get(),
  ]);
  if (!ledger.empty || !orders.empty) {
    throw new VendorLifecycleError('This vendor has orders or payout history, which must be kept for your accounts. Block them instead — it hides their products and turns off their login.', 409);
  }
  const removed = { products: 0, logins: 0, chats: 0 };
  for (const d of (await db.collection('products').where('vendorId', '==', vendorId).get()).docs) { await d.ref.delete(); removed.products += 1; }
  for (const d of (await db.collection('staff').where('vendorId', '==', vendorId).get()).docs) { await d.ref.delete(); removed.logins += 1; }
  for (const c of (await db.collection('conversations').where('vendorId', '==', vendorId).get()).docs) {
    for (const m of (await db.collection('chat_messages').where('conversationId', '==', c.id).get()).docs) await m.ref.delete();
    await c.ref.delete();
    removed.chats += 1;
  }
  await ref.delete();
  return removed;
}
