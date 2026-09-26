/* ─────────────────────────────────────────────
   Shiprocket API client — one Tulsi account, many pickup warehouses.
   Docs: https://apiv2.shiprocket.in/v1/external/
   Env: SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD, SHIPROCKET_PICKUP_LOCATION
        (Tulsi's own pickup nickname), SHIPROCKET_PICKUP_PINCODE.

   Every call goes through request(): bearer token from the token manager
   (cached in Firestore, refreshed before its 10-day expiry and on any 401),
   and Shiprocket's many error shapes turned into one ShiprocketError with
   a message a vendor can act on.
   ───────────────────────────────────────────── */
import { createTokenManager } from '@/lib/shiprocketToken';

const BASE = 'https://apiv2.shiprocket.in/v1/external';

export class ShiprocketError extends Error {
  constructor(message, { status = 400, details = null } = {}) {
    super(message);
    this.name = 'ShiprocketError';
    this.status = status;
    this.details = details;
  }
}

export function isConfigured() {
  return !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);
}

/* Shiprocket reports problems as message, errors{field:[...]}, or
   status_code + message. Flatten, then say it in plain words for the
   common cases (unserviceable pincode, pickup not verified, wallet). */
export function explainShiprocketError(data, fallback = 'Shiprocket request failed') {
  const fields = data?.errors && typeof data.errors === 'object'
    ? Object.values(data.errors).flat().filter((m) => typeof m === 'string')
    : [];
  const raw = [data?.message, ...fields].filter(Boolean).join(' — ') || fallback;
  const t = raw.toLowerCase();
  if (/not serviceable|no courier|unserviceable|serviceability/.test(t)) return `No courier delivers this route right now (${raw}). Check the pincode, or ship with your own courier.`;
  if (/pin ?code|postcode/.test(t)) return `Pincode problem: ${raw}`;
  if (/pickup/.test(t) && /verif/.test(t)) return 'This pickup address is waiting for phone verification in Shiprocket. Tulsi must verify it before parcels can be booked from it.';
  if (/pickup location|pickup_location/.test(t)) return `Pickup address problem: ${raw}`;
  if (/wallet|balance|recharge/.test(t)) return 'Tulsi’s Shiprocket wallet balance is too low to book this courier. Tulsi needs to recharge it.';
  return raw;
}

/* ── Token management ── */
async function login() {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) throw new ShiprocketError('Shiprocket isn’t set up (SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD missing).', { status: 503 });
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.token) throw new ShiprocketError(`Shiprocket login failed: ${data.message || res.status}`, { status: 502 });
  return data.token;
}

/* Firestore-backed cache, loaded lazily so this module has no hard
   dependency on the database for callers that never make a request. */
const tokenStore = {
  async read() {
    const { getDB } = await import('@/lib/firebase');
    const snap = await getDB().collection('integrations').doc('shiprocket').get();
    return snap.exists ? snap.data() : null;
  },
  async write(value) {
    const { getDB } = await import('@/lib/firebase');
    await getDB().collection('integrations').doc('shiprocket').set(value);
  },
};

const tokens = createTokenManager({ login, store: tokenStore });

/**
 * Authenticated JSON request. Retries once with a fresh token on 401.
 * @returns parsed JSON
 * @throws ShiprocketError on a non-2xx answer
 */
export async function request(path, { method = 'GET', body } = {}) {
  const send = async (token) => fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  let res = await send(await tokens.get());
  if (res.status === 401) res = await send(await tokens.renew());
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.status_code >= 400) {
    throw new ShiprocketError(explainShiprocketError(data, `Shiprocket error ${res.status}`), { status: res.status >= 500 ? 502 : 400, details: data });
  }
  return data;
}

/* ── Pickup locations (one per vendor warehouse) ── */

/**
 * Registers a warehouse as a pickup location on Tulsi's account.
 * Shiprocket can't edit a pickup address through the API, so a changed
 * address is registered under a new nickname (see pickupNickname()).
 * New pickup addresses may need phone verification in the Shiprocket panel.
 */
export async function addPickupLocation({ nickname, name, email, phone, address, address2 = '', city, state, pincode, country = 'India' }) {
  const data = await request('/settings/company/addpickup', {
    method: 'POST',
    body: {
      pickup_location: nickname,
      name, email, phone,
      address, address_2: address2,
      city, state, country,
      pin_code: pincode,
    },
  });
  if (data?.success === false) throw new ShiprocketError(explainShiprocketError(data, 'Could not add the pickup address'), { details: data });
  const a = data?.address || {};
  return {
    nickname: a.pickup_code || a.pickup_location || nickname,
    pickupId: data?.pickup_id ?? a.id ?? null,
    phoneVerified: a.phone_verified === undefined ? null : Number(a.phone_verified) === 1,
  };
}

/* ── Orders & shipments ── */

/**
 * Creates one Shiprocket order for one parcel (a whole order, or one
 * vendor's part of a split order).
 * @param {object} p  { subOrderId, order, items, pickupLocation, subTotal, cod }
 */
export async function createAdhocOrder({ subOrderId, order, items, pickupLocation, subTotal, cod }) {
  const addr = order.shippingAddress || {};
  const phone = String(addr.phone || '').replace(/\D/g, '').slice(-10);
  const data = await request('/orders/create/adhoc', {
    method: 'POST',
    body: {
      order_id: subOrderId,
      order_date: new Date(order.createdAt || Date.now()).toISOString().slice(0, 19).replace('T', ' '),
      pickup_location: pickupLocation,
      comment: 'Tulsi Bridal Jewellery',
      billing_customer_name: addr.name || addr.fullName || 'Customer',
      billing_last_name: '',
      billing_address: addr.street || addr.address || '',
      billing_address_2: addr.landmark || '',
      billing_city: addr.city || '',
      billing_pincode: addr.pincode || '',
      billing_state: addr.state || '',
      billing_country: 'India',
      billing_email: order.guestEmail || addr.email || '',
      billing_phone: phone,
      shipping_is_billing: true,
      order_items: items.map((i) => ({
        name: i.name,
        sku: i.sku || i.product,
        units: i.quantity,
        selling_price: i.price || 0,
        discount: 0, tax: 0, hsn: '',
      })),
      payment_method: cod ? 'COD' : 'Prepaid',
      shipping_charges: 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: 0,
      /* What the courier collects on COD — this parcel's share of the total. */
      sub_total: subTotal,
      length: 10, breadth: 10, height: 5, weight: 0.5,
    },
  });
  if (!data?.order_id || !data?.shipment_id) throw new ShiprocketError(explainShiprocketError(data, 'Shiprocket did not create the order'), { details: data });
  return { srOrderId: data.order_id, shipmentId: data.shipment_id };
}

/* Assigns a courier + AWB (auto-picks the courier when none is given).
   Doesn't throw when no AWB is issued — the reason comes back as awbError
   so the caller can keep the shipment and retry later. */
export async function assignAwb(shipmentId, courierId = null) {
  let assigned;
  try {
    assigned = await request('/courier/assign/awb', { method: 'POST', body: { shipment_id: shipmentId, courier_id: courierId || null } });
  } catch (e) {
    return { awb: null, courierName: null, courierId: null, awbError: e.message };
  }
  const data = assigned?.response?.data || {};
  return {
    awb: data.awb_code || null,
    courierName: data.courier_name || null,
    courierId: data.courier_company_id || courierId || null,
    awbError: data.awb_code ? null : explainShiprocketError({ message: assigned?.message || data.awb_assign_error }, 'Courier / AWB could not be assigned'),
  };
}

/* Asks the courier to collect the parcel from its pickup address. */
export async function requestPickup(shipmentId) {
  return request('/courier/generate/pickup', { method: 'POST', body: { shipment_id: [shipmentId] } });
}

/** Shiprocket's printable label (PDF URL) for these shipments. */
export async function generateLabel(shipmentIds) {
  const data = await request('/courier/generate/label', { method: 'POST', body: { shipment_id: shipmentIds } });
  if (!data?.label_url) throw new ShiprocketError(explainShiprocketError(data, 'Label not ready yet — the courier must be assigned first.'), { details: data });
  return data.label_url;
}

/* ── Tracking ── */
export async function trackShiprocketAWB(awb) {
  const data = await request(`/courier/track/awb/${encodeURIComponent(awb)}`);
  const td = data?.tracking_data;
  if (!td) return { success: false, message: 'No tracking data yet' };
  return {
    success: true,
    awb,
    status: td.shipment_track?.[0]?.current_status || td.shipment_status,
    etd: td.etd || null,
    trackUrl: td.track_url || null,
    activities: (td.shipment_track_activities || []).map((a) => ({
      date: a.date, activity: a.activity, location: a.location, status: a['sr-status-label'] || a.status,
    })),
  };
}

/* ── Serviceability & freight ── */
async function serviceability({ pickupPincode, pincode, cod, weight = 0.5 }) {
  const data = await request(`/courier/serviceability/?pickup_postcode=${encodeURIComponent(pickupPincode)}&delivery_postcode=${encodeURIComponent(pincode)}&cod=${cod ? 1 : 0}&weight=${weight}`);
  return data?.data?.available_courier_companies || [];
}

export async function getAvailableCouriers(pincode, cod = false, pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE) {
  if (!pickupPincode) throw new ShiprocketError('SHIPROCKET_PICKUP_PINCODE not configured', { status: 503 });
  return serviceability({ pickupPincode, pincode, cod });
}

/* The freight Shiprocket quotes for this parcel with the chosen courier,
   from its own pickup pincode — deducted from vendor earnings. Null when
   it can't be determined (an admin can enter it by hand). */
export async function getFreightQuote({ pincode, cod = false, courierId, weight = 0.5, pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE }) {
  if (!pickupPincode || !pincode || !courierId) return null;
  const list = await serviceability({ pickupPincode, pincode, cod, weight });
  const rate = Number(list.find((c) => String(c.courier_company_id) === String(courierId))?.rate);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

export async function cancelShiprocketOrder(shiprocketOrderId) {
  return request('/orders/cancel', { method: 'POST', body: { ids: [shiprocketOrderId] } });
}
