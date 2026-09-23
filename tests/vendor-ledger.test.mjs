/* Ledger lifecycle tests: delivery → hold → payout → refund clawback.
   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFirestore } from './helpers/fakeFirestore.mjs';
import { postDeliverySettlement, reverseOrderSettlements, recordVendorPayout, settlementEntryId } from '../src/lib/vendorLedger.js';
import { summarizeLedger } from '../src/lib/settlement.js';

const DAY = 86400000;
const delivered = '2026-09-01T10:00:00.000Z';
const afterHold = Date.parse(delivered) + 8 * DAY;

function seed(orderOverrides = {}) {
  return fakeFirestore({
    vendors: { v1: { name: 'Lakshmi Gold', payout: { method: 'upi', upiId: 'lakshmi@okaxis' } } },
    orders: {
      o1: {
        orderNumber: 'TBJ1', status: 'delivered', deliveredAt: delivered,
        payment: { method: 'razorpay', status: 'paid' },
        shippingCost: 0, shippingCostActual: 80,
        vendorFees: { v1: 500 },
        items: [
          { product: 'a', name: 'Jhumka', price: 2000, quantity: 1, vendorId: 'v1', supplyCost: 1200 },
          { product: 'b', name: 'Own set', price: 3000, quantity: 1 },
        ],
        ...orderOverrides,
      },
    },
  });
}

const ledger = (db) => [...db.store.get('vendorLedger')?.values() || []];

test('delivery posts one entry per vendor, and posting again changes nothing', async () => {
  const db = seed();
  assert.deepEqual(await postDeliverySettlement(db, 'o1'), { posted: 1, updated: 0 });
  assert.deepEqual(await postDeliverySettlement(db, 'o1'), { posted: 0, updated: 0 });
  const [e] = ledger(db);
  assert.equal(ledger(db).length, 1);
  assert.equal(e.vendorId, 'v1');
  assert.equal(e.status, 'unsettled');
  // ₹2,000 − ₹1,200 supply − 40% of ₹80 shipping (its share of the parcel) − 5% fee
  assert.equal(e.netPaise, 200000 - 120000 - 3200 - 10000);
  assert.equal(e.availableAt, new Date(Date.parse(delivered) + 7 * DAY).toISOString());
});

test('undelivered or unpaid orders are not settled', async () => {
  assert.match((await postDeliverySettlement(seed({ status: 'shipped' }), 'o1')).skipped, /not delivered/);
  assert.match((await postDeliverySettlement(seed({ payment: { method: 'cod', status: 'pending' } }), 'o1')).skipped, /not paid/);
});

test('payout is refused inside the return window and allowed after it', async () => {
  const db = seed();
  await postDeliverySettlement(db, 'o1');
  await assert.rejects(recordVendorPayout(db, { vendorId: 'v1', reference: 'UTR1', now: Date.parse(delivered) + DAY }), /Nothing is available/);
  const r = await recordVendorPayout(db, { vendorId: 'v1', reference: 'UTR1', now: afterHold });
  assert.equal(r.amountPaise, 66800);
  assert.equal(ledger(db)[0].status, 'settled');
  const payout = [...db.store.get('vendorPayouts').values()][0];
  assert.equal(payout.destination, 'lakshmi@okaxis');
  assert.equal(payout.reference, 'UTR1');
});

test('a second payout finds nothing left — money is never paid twice', async () => {
  const db = seed();
  await postDeliverySettlement(db, 'o1');
  await recordVendorPayout(db, { vendorId: 'v1', reference: 'UTR1', now: afterHold });
  await assert.rejects(recordVendorPayout(db, { vendorId: 'v1', reference: 'UTR2', now: afterHold }), /Nothing is available/);
});

test('payout requires a transfer reference', async () => {
  await assert.rejects(recordVendorPayout(seed(), { vendorId: 'v1', reference: '  ' }), /UTR/);
});

test('refund before payout voids the entry', async () => {
  const db = seed();
  await postDeliverySettlement(db, 'o1');
  assert.deepEqual(await reverseOrderSettlements(db, 'o1'), { voided: 1, clawedBack: 0 });
  const s = summarizeLedger(ledger(db), afterHold);
  assert.equal(s.availablePaise, 0);
  assert.equal(s.grossPaise, 0);
});

test('refund after payout claws it back from the next payout, once', async () => {
  const db = seed();
  await postDeliverySettlement(db, 'o1');
  await recordVendorPayout(db, { vendorId: 'v1', reference: 'UTR1', now: afterHold });
  assert.deepEqual(await reverseOrderSettlements(db, 'o1', { now: afterHold }), { voided: 0, clawedBack: 1 });
  assert.deepEqual(await reverseOrderSettlements(db, 'o1', { now: afterHold }), { voided: 0, clawedBack: 0 });
  const s = summarizeLedger(ledger(db), afterHold);
  assert.equal(s.availablePaise, -66800);
  await assert.rejects(recordVendorPayout(db, { vendorId: 'v1', reference: 'UTR2', now: afterHold }), /owes more/);
});

test('recalculate refreshes unpaid entries after the real shipping charge is recorded', async () => {
  const db = seed({ shippingCostActual: undefined, shippingCost: 99 });
  await postDeliverySettlement(db, 'o1');
  assert.equal(ledger(db)[0].shippingSource, 'estimate');
  db.store.get('orders').get('o1').shippingCostActual = 150;
  assert.deepEqual(await postDeliverySettlement(db, 'o1', { recalculate: true }), { posted: 0, updated: 1 });
  const e = db.store.get('vendorLedger').get(settlementEntryId('o1', 'v1'));
  assert.equal(e.shippingSource, 'actual');
  assert.equal(e.shippingPaise, 6000); // 40% of ₹150
});

test('delivered → cancelled → delivered again reinstates the voided entry', async () => {
  const db = seed();
  await postDeliverySettlement(db, 'o1');
  await reverseOrderSettlements(db, 'o1');
  assert.equal(ledger(db)[0].status, 'reversed');
  assert.deepEqual(await postDeliverySettlement(db, 'o1'), { posted: 0, updated: 1 });
  assert.equal(ledger(db)[0].status, 'unsettled');
});
