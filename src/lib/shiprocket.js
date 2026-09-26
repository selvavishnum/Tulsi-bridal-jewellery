/* Shiprocket API integration
   Docs: https://apiv2.shiprocket.in/v1/external/
   Requires: SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD in .env.local
*/

const BASE = 'https://apiv2.shiprocket.in/v1/external';

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const email    = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) throw new Error('Shiprocket credentials not configured');

  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(data.message || 'Shiprocket login failed');

  _token = data.token;
  _tokenExpiry = Date.now() + 9 * 24 * 60 * 60 * 1000; // 9 days
  return _token;
}

async function srFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  return res.json();
}

/* ── Create a Shiprocket order + shipment ── */
/* `pickupLocation` — the pickup nickname in Shiprocket (Settings → Pickup
   Addresses). Defaults to Tulsi's own; a vendor who ships their own
   orders has theirs registered there and saved on their vendor record. */
export async function createShiprocketOrder(order, courier_id = null, { pickupLocation } = {}) {
  const addr = order.shippingAddress || {};
  const phone = (addr.phone || '').replace(/\D/g, '').slice(-10);

  const payload = {
    order_id:           order.orderNumber,
    order_date:         new Date(order.createdAt).toISOString().slice(0, 19),
    /* Must exactly match the pickup address "nickname" set in Shiprocket
       (Settings → Pickup Addresses) — not whether it's marked PRIMARY there. */
    pickup_location:    pickupLocation || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
    channel_id:         '',
    comment:            'Tulsi Bridal Jewellery',
    billing_customer_name:  addr.name || addr.fullName || 'Customer', // older orders only stored fullName
    billing_last_name:      '',
    billing_address:        addr.street || addr.address || '',
    billing_address_2:      '',
    billing_city:           addr.city || '',
    billing_pincode:        addr.pincode || '',
    billing_state:          addr.state || '',
    billing_country:        'India',
    billing_email:          order.guestEmail || addr.email || '',
    billing_phone:          phone,
    shipping_is_billing:    true,
    order_items: (order.items || []).map((item) => ({
      name:          item.name,
      sku:           item.sku || item.product || `SKU-${Date.now()}`,
      units:         item.quantity,
      selling_price: item.price || 0,
      discount:      0,
      tax:           0,
      hsn:           '',
    })),
    payment_method:     order.payment?.method === 'cod' ? 'COD' : 'Prepaid',
    shipping_charges:   order.shippingCost || 0,
    giftwrap_charges:   0,
    transaction_charges: 0,
    total_discount:     order.discount || 0,
    sub_total:          order.total || 0,
    length:             10,
    breadth:            10,
    height:             5,
    weight:             0.5,
  };

  const created = await srFetch('/orders/create/adhoc', { method: 'POST', body: JSON.stringify(payload) });
  if (!created.order_id) {
    /* Shiprocket puts the actually-useful reason (e.g. "pickup_location
       invalid") inside errors{}, not the generic top-level message. */
    const fieldErrors = created.errors
      ? Object.values(created.errors).flat().join(' ')
      : '';
    const message = [created.message, fieldErrors].filter(Boolean).join(' — ') || 'Failed to create Shiprocket order';
    return { success: false, message, data: created };
  }

  const awb = await assignAwb(created.shipment_id, courier_id);
  return {
    success:       true,
    orderId:       created.order_id,
    shipmentId:    created.shipment_id,
    ...awb,
    data:          { created, assigned: awb.raw },
  };
}

/* Assigns a courier + AWB to an existing Shiprocket shipment (auto-picks the
   courier when none is given). Also used to retry after a failed assignment
   without creating a duplicate Shiprocket order. */
export async function assignAwb(shipmentId, courier_id = null) {
  const assigned = await srFetch('/courier/assign/awb', {
    method: 'POST',
    body: JSON.stringify({ shipment_id: shipmentId, courier_id: courier_id || null }),
  });
  const data = assigned.response?.data || {};
  return {
    awb:          data.awb_code || null,
    courierName:  data.courier_name || null,
    courierId:    data.courier_company_id || courier_id || null,
    /* Shiprocket reports why no AWB was issued (no serviceable courier,
       low wallet balance, …) in message/status fields rather than failing. */
    awbError:     data.awb_code ? null : (assigned.message || data.awb_assign_error || 'Courier / AWB could not be assigned'),
    raw:          assigned,
  };
}

/* The freight Shiprocket quotes for this parcel with the chosen courier —
   the platform's actual shipping cost, deducted from vendor earnings. Returns
   null when it can't be determined; the admin can then enter it by hand. */
export async function getFreightQuote({ pincode, cod = false, courierId, weight = 0.5 }) {
  const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE;
  if (!pickupPincode || !pincode || !courierId) return null;
  const data = await srFetch(
    `/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${encodeURIComponent(pincode)}&cod=${cod ? 1 : 0}&weight=${weight}`,
  );
  const match = (data?.data?.available_courier_companies || [])
    .find((c) => String(c.courier_company_id) === String(courierId));
  const rate = Number(match?.rate);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

/* ── Track by AWB number ── */
export async function trackShiprocketAWB(awb) {
  const data = await srFetch(`/courier/track/awb/${awb}`);
  if (!data.tracking_data) return { success: false, message: 'No tracking data', data };

  const td = data.tracking_data;
  const shipmentStatus = td.shipment_status;
  const activities = (td.shipment_track_activities || []).map((a) => ({
    date:     a.date,
    activity: a.activity,
    location: a.location,
    status:   a['sr-status-label'] || a.status,
  }));

  return {
    success:  true,
    awb,
    status:   shipmentStatus,
    etd:      td.etd,
    activities,
  };
}

/* ── Get available couriers for a pincode ── */
export async function getAvailableCouriers(pincode, cod = false) {
  const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE;
  if (!pickupPincode) throw new Error('SHIPROCKET_PICKUP_PINCODE not configured');
  const data = await srFetch(
    `/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${pincode}&cod=${cod ? 1 : 0}&weight=0.5`,
  );
  return data?.data?.available_courier_companies || [];
}

/* ── Cancel Shiprocket order ── */
export async function cancelShiprocketOrder(shiprocketOrderId) {
  return srFetch('/orders/cancel', {
    method: 'POST',
    body: JSON.stringify({ ids: [shiprocketOrderId] }),
  });
}

export function isConfigured() {
  return !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);
}
