/* 005 — Shiprocket multi-warehouse.
     1. Registers every vendor's saved warehouse address as a Shiprocket
        pickup location (VENDOR_<id>) — the same sync the Vendor Portal runs
        when a vendor saves their address.
     2. Copies the single Shiprocket booking of older orders into the new
        per-parcel field (shipments.tulsi), so labels and tracking work the
        same for old and new orders.

   Needs the Shiprocket env vars too, and the "@/" import alias:
     node --env-file=.env.local --import ./tests/helpers/register-alias.mjs scripts/migrations/005-shiprocket-pickups.mjs          (dry run)
     node --env-file=.env.local --import ./tests/helpers/register-alias.mjs scripts/migrations/005-shiprocket-pickups.mjs --apply  (writes)
   Safe to re-run. */
import { db, APPLY, pages } from './_lib.mjs';
import { pickupAddressProblem } from '../../src/lib/shipmentPlan.js';

const firestore = db();

console.log('— Vendor pickup locations —');
let synced = 0;
for await (const docs of pages(firestore, 'vendors')) {
  for (const d of docs) {
    if (d.id === 'tulsi') continue;
    const v = d.data();
    if (!v.pickupAddress) { console.log(`  ${d.id} ${v.name}: no warehouse address saved — skip`); continue; }
    if (v.shiprocketPickup?.nickname) { console.log(`  ${d.id} ${v.name}: already ${v.shiprocketPickup.nickname}`); continue; }
    const problem = pickupAddressProblem({ ...v.pickupAddress, name: v.contactName || v.name, phone: v.phone });
    if (problem) { console.log(`  ${d.id} ${v.name}: can't register — ${problem}`); continue; }
    if (!APPLY) { console.log(`  ${d.id} ${v.name}: would register as VENDOR_${d.id}`); continue; }
    const { syncVendorPickup } = await import('../../src/lib/pickupSync.js');
    const r = await syncVendorPickup(firestore, d.id);
    console.log(`  ${d.id} ${v.name}: ${r.status}${r.message ? ` — ${r.message}` : ''}`);
    if (['active', 'needs_verification'].includes(r.status)) synced += 1;
  }
}

console.log('\n— Older single-parcel bookings —');
let moved = 0;
for await (const docs of pages(firestore, 'orders')) {
  for (const d of docs) {
    const o = d.data();
    if (!o.shiprocketShipmentId || o.shipments) continue;
    const rec = {
      key: 'tulsi', vendorId: null, pickupLocation: process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
      subOrderId: o.orderNumber, srOrderId: o.shiprocketOrderId || null, shipmentId: o.shiprocketShipmentId,
      awb: o.trackingNumber || null, courierName: o.courierName || null,
      ...(o.trackingNumber && { trackingUrl: `https://shiprocket.co/tracking/${encodeURIComponent(o.trackingNumber)}` }),
      items: (o.items || []).map((i) => ({ product: i.product, name: i.name, quantity: i.quantity })),
      migratedAt: new Date().toISOString(),
    };
    if (APPLY) await d.ref.update({ 'shipments.tulsi': rec });
    moved += 1;
  }
}
console.log(`${APPLY ? 'Moved' : 'Would move'} ${moved} order booking(s).`);
if (APPLY) console.log(`Registered ${synced} vendor pickup location(s).`);
else console.log('\nRe-run with --apply to write.');
