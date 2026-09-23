/* Settlement math and data-exposure tests for src/lib/settlement.js.
   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocate, computeVendorSettlements, summarizeLedger,
  toVendorOrderView, toCustomerOrder, validateVendorPricing, marginFor, PLATFORM_VENDOR_ID,
} from '../src/lib/settlement.js';

test('allocate splits exactly, never losing or inventing a paisa', () => {
  assert.deepEqual(allocate(10000, [1, 1, 1]), [3334, 3333, 3333]);
  assert.equal(allocate(9901, [250000, 125000, 73]).reduce((a, b) => a + b, 0), 9901);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
  assert.deepEqual(allocate(100, [0, 0]), [50, 50]);
});

test('single vendor order: payout = collected − supply − shipping − fee', () => {
  const [s] = computeVendorSettlements({
    items: [{ product: 'p1', name: 'Jhumka', price: 1500, quantity: 2, vendorId: 'v1', supplyCost: 900 }],
    shippingCost: 99,
    shippingCostActual: 72,
    vendorFees: { v1: 500 }, // 5%
  });
  assert.equal(s.itemsPaise, 300000);
  assert.equal(s.grossPaise, 309900);          // ₹3,000 items + ₹99 shipping the customer paid
  assert.equal(s.supplyCostPaise, 180000);     // ₹900 × 2 retained by the platform
  assert.equal(s.shippingPaise, 7200);         // actual courier charge
  assert.equal(s.platformFeePaise, 15000);     // 5% of ₹3,000
  assert.equal(s.netPaise, 309900 - 180000 - 7200 - 15000);
  assert.equal(s.shippingSource, 'actual');
});

test('the platform’s own items produce no settlement entry', () => {
  const out = computeVendorSettlements({
    items: [
      { product: 'p1', price: 5000, quantity: 1 }, // no vendorId → platform
      { product: 'p2', price: 5000, quantity: 1, vendorId: PLATFORM_VENDOR_ID },
    ],
    shippingCost: 0,
  });
  assert.deepEqual(out, []);
});

test('mixed parcel: shipping is split by item value and reconciles to the rupee', () => {
  const out = computeVendorSettlements({
    items: [
      { product: 'a', price: 3000, quantity: 1, vendorId: 'v1', supplyCost: 2000 },
      { product: 'b', price: 1000, quantity: 1, vendorId: 'v2', supplyCost: 600 },
      { product: 'c', price: 1000, quantity: 1 }, // platform's own
    ],
    shippingCost: 0,
    shippingCostActual: 100.01,
    vendorFees: { v1: 0, v2: 1000 },
  });
  const v1 = out.find((e) => e.vendorId === 'v1');
  const v2 = out.find((e) => e.vendorId === 'v2');
  assert.equal(v1.shippingPaise, 6001); // 60% of 10001 paise, rounded by largest remainder
  assert.equal(v2.shippingPaise, 2000); // 20%
  assert.equal(v2.platformFeePaise, 10000); // 10% of ₹1,000
  assert.equal(out.length, 2);
});

test('no recorded courier charge falls back to the customer-paid fee, flagged as an estimate', () => {
  const [s] = computeVendorSettlements({
    items: [{ product: 'a', price: 500, quantity: 1, vendorId: 'v1', supplyCost: 300 }],
    shippingCost: 99,
  });
  assert.equal(s.shippingSource, 'estimate');
  assert.equal(s.shippingPaise, 9900);
});

test('a loss-making order yields a negative payout rather than being hidden', () => {
  const [s] = computeVendorSettlements({
    items: [{ product: 'a', price: 400, quantity: 1, vendorId: 'v1', supplyCost: 380 }],
    shippingCost: 0,
    shippingCostActual: 85,
  });
  assert.equal(s.netPaise, 40000 - 38000 - 8500);
  assert.ok(s.netPaise < 0);
});

test('ledger summary: held, available, settled and reversed entries', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const base = { grossPaise: 10000, supplyCostPaise: 6000, shippingPaise: 500, platformFeePaise: 500, netPaise: 3000 };
  const s = summarizeLedger([
    { ...base, status: 'settled', availableAt: '2026-09-01T00:00:00Z' },
    { ...base, status: 'unsettled', availableAt: '2026-09-20T00:00:00Z' },               // past the window
    { ...base, status: 'unsettled', availableAt: '2026-10-05T00:00:00Z', shippingSource: 'estimate' }, // still in window
    { ...base, status: 'reversed', availableAt: '2026-09-20T00:00:00Z' },                // refunded before payout
    { grossPaise: -10000, supplyCostPaise: -6000, shippingPaise: -500, platformFeePaise: -500, netPaise: -3000,
      status: 'unsettled', availableAt: '2026-09-25T00:00:00Z', type: 'reversal' },     // clawback after payout
  ], now);
  assert.equal(s.paidOutPaise, 3000);
  assert.equal(s.availablePaise, 3000 - 3000);
  assert.equal(s.pendingPaise, 3000);
  assert.equal(s.grossPaise, 20000);
  assert.equal(s.estimatedShippingCount, 1);
});

const mixedOrder = {
  id: 'o1', orderNumber: 'TBJ1', status: 'shipped', total: 9999,
  trackingNumber: 'AWB123', courierName: 'Delhivery', shiprocketOrderId: 55,
  payment: { method: 'razorpay', status: 'paid', razorpayPaymentId: 'pay_x' },
  shippingAddress: { name: 'Priya Raman', phone: '9876543210', email: 'priya@example.com', street: '12 Temple St', city: 'Madurai', state: 'TN', pincode: '625001' },
  guestEmail: 'priya@example.com',
  items: [
    { product: 'a', name: 'Jhumka', price: 1500, quantity: 1, vendorId: 'v1', supplyCost: 900 },
    { product: 'b', name: 'Bangle', price: 2500, quantity: 1, vendorId: 'v2', supplyCost: 1800 },
  ],
  vendorIds: ['v1', 'v2'], vendorFees: { v1: 500, v2: 500 }, shippingCostActual: 80,
};

test('a vendor sees only their own lines and no customer contact details', () => {
  const view = toVendorOrderView(mixedOrder, 'v1');
  assert.deepEqual(view.items.map((i) => i.name), ['Jhumka']);
  assert.equal(view.itemsTotal, 1500);
  assert.equal(view.customer.firstName, 'Priya');
  const json = JSON.stringify(view);
  for (const leak of ['9876543210', 'priya@example.com', '12 Temple St', 'Bangle', '1800', '9999', 'pay_x']) {
    assert.ok(!json.includes(leak), `vendor view leaked ${leak}`);
  }
  assert.equal(view.trackingUrl, 'https://shiprocket.co/tracking/AWB123');
  assert.equal(toVendorOrderView(mixedOrder, 'v3'), null);
});

test('customers never see supply cost or vendor settlement fields', () => {
  const c = toCustomerOrder(mixedOrder);
  const json = JSON.stringify(c);
  assert.ok(!json.includes('supplyCost'));
  assert.ok(!json.includes('vendorFees'));
  assert.ok(!json.includes('shippingCostActual'));
  assert.equal(c.items.length, 2);
  assert.equal(mixedOrder.items[0].supplyCost, 900, 'must not mutate the stored order');
});

test('vendor products must carry a margin (₹ or %) and the price must cover margin + vendor shipping', () => {
  assert.equal(validateVendorPricing({ price: 1000 }), null);
  assert.equal(validateVendorPricing({ vendorId: PLATFORM_VENDOR_ID, price: 1000 }), null);
  assert.match(validateVendorPricing({ vendorId: 'v1', price: 1000 }), /margin/);
  assert.match(validateVendorPricing({ vendorId: 'v1', price: 1000, discountPrice: 700, supplyCost: 800 }), /doesn't cover the margin/);
  assert.equal(validateVendorPricing({ vendorId: 'v1', price: 1000, supplyCost: 800 }), null);
  // percentage margin
  assert.match(validateVendorPricing({ vendorId: 'v1', price: 1000, marginMode: 'percent', marginPercent: 0 }), /percentage/);
  assert.match(validateVendorPricing({ vendorId: 'v1', price: 1000, marginMode: 'percent', marginPercent: 100 }), /percentage/);
  assert.equal(validateVendorPricing({ vendorId: 'v1', price: 1000, marginMode: 'percent', marginPercent: 20 }), null);
  // vendor shipping must fit in what's left
  assert.equal(validateVendorPricing({ vendorId: 'v1', price: 1000, supplyCost: 800, vendorShipping: 200 }), null);
  assert.match(validateVendorPricing({ vendorId: 'v1', price: 1000, supplyCost: 800, vendorShipping: 201 }), /vendor shipping/);
  assert.match(validateVendorPricing({ vendorId: 'v1', price: 1000, supplyCost: 800, vendorShipping: -1 }), /shipping/);
});

test('marginFor: fixed ₹ or % of the selling price', () => {
  assert.equal(marginFor({ supplyCost: 400, price: 2000 }), 400);
  assert.equal(marginFor({ marginMode: 'percent', marginPercent: 20, price: 2000 }), 400);
  assert.equal(marginFor({ marginMode: 'percent', marginPercent: 20, price: 2000, discountPrice: 1500 }), 300, 'follows the offer price');
  assert.equal(marginFor({ marginMode: 'percent', marginPercent: 12.5, price: 999 }), 124.88);
});

test('vendor-set shipping: vendor pays their per-piece charge; the customer shipping fee stays with Tulsi', () => {
  // The user's example: ₹2,000 piece, 20% margin (₹400), vendor shipping ₹100, courier actually ₹80
  const [s] = computeVendorSettlements({
    shippingCost: 99, shippingCostActual: 80,
    items: [{ product: 'p', price: 2000, quantity: 1, vendorId: 'v1', supplyCost: 400, vendorShipping: 100 }],
  });
  assert.equal(s.shippingSource, 'vendor_set');
  assert.equal(s.customerShippingPaise, 0);
  assert.equal(s.shippingPaise, 10000);
  assert.equal(s.netPaise, 150000); // 2000 − 400 − 100 = ₹1,500

  // per piece: two pieces pay shipping twice
  const [two] = computeVendorSettlements({ items: [{ product: 'p', price: 2000, quantity: 2, vendorId: 'v1', supplyCost: 400, vendorShipping: 100 }] });
  assert.equal(two.netPaise, 300000);

  // older orders without the snapshot keep the courier split
  const [old] = computeVendorSettlements({ shippingCost: 0, shippingCostActual: 80, items: [{ product: 'p', price: 2000, quantity: 1, vendorId: 'v1', supplyCost: 400 }] });
  assert.equal(old.shippingSource, 'actual');
  assert.equal(old.netPaise, 152000);
});
