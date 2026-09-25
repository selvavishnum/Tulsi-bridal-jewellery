import { sendVendorOrderNotification } from '@/lib/email';
import { toVendorOrderDetail } from '@/lib/vendorOrders';
import { PLATFORM_VENDOR_ID } from '@/lib/settlement';

/* Emails each vendor in an order about their own pieces, once per order.
   Called when the order is real: at checkout for COD, and when payment
   is confirmed for online orders (an unpaid online order isn't one yet).
   The `vendorsNotifiedAt` flag is claimed in a transaction first, so the
   payment page and the Razorpay webhook can't both send it. */
export async function notifyVendorsOfOrder(db, orderId) {
  const ref = db.collection('orders').doc(orderId);
  const order = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().vendorsNotifiedAt) return null;
    tx.update(ref, { vendorsNotifiedAt: new Date().toISOString() });
    return { id: snap.id, ...snap.data() };
  });
  if (!order) return;

  const vendorIds = (order.vendorIds || []).filter((v) => v && v !== PLATFORM_VENDOR_ID);
  await Promise.all(vendorIds.map(async (vendorId) => {
    try {
      const vSnap = await db.collection('vendors').doc(vendorId).get();
      if (!vSnap.exists) return;
      const vendor = vSnap.data();
      let to = vendor.contactEmail;
      if (!to) {
        const login = await db.collection('staff').where('vendorId', '==', vendorId).limit(1).get();
        to = login.empty ? null : login.docs[0].data().email;
      }
      const detail = toVendorOrderDetail(order, vendorId, vendor);
      if (to && detail) await sendVendorOrderNotification(to, vendor.name, detail);
    } catch (e) {
      console.error('[vendor notify]', vendorId, e.message);
    }
  }));
}
