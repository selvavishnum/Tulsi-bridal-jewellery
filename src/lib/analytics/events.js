/* ─────────────────────────────────────────────
   Visitor analytics — the event contract between the browser tracker
   (src/lib/analytics/tracker.js) and POST /api/analytics/track.

   A request is a small batch: { tab, n, cart?, events: [...] }. Each event
   is validated on its own and invalid ones are dropped, so an old cached
   tracker or a malformed field never loses the rest of the batch.

   Pure module (zod only).
   ───────────────────────────────────────────── */
import { z } from 'zod';

export const EVENT_TYPES = Object.freeze([
  'page_view', 'heartbeat',
  'product_view', 'product_engagement',
  'tryon_open', 'tryon_mode', 'tryon_tone',
  'add_to_cart', 'remove_from_cart', 'checkout_start', 'purchase',
]);
export const TRYON_MODES = Object.freeze(['ai', 'live']);
export const TONE_IDS = Object.freeze(['fair', 'wheatish', 'dusky', 'bronze']);

export const MAX_EVENTS = 30;
export const MAX_BODY_BYTES = 16 * 1024;
/* Heartbeats come every 15s; anything above 30s of "active" time per beat
   is a stale tab or a crafted value. */
export const MAX_ACTIVE_PER_BEAT = 30;

const str = (max) => z.string().max(max);
const int = (min, max) => z.number().int().min(min).max(max);

const UtmSchema = z.object({
  source: str(100).optional(), medium: str(100).optional(), campaign: str(100).optional(),
  content: str(100).optional(), term: str(100).optional(),
}).strip();

export const EventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  seq: int(0, 10_000_000),
  path: str(300).optional(),
  referrer: str(500).optional(),
  utm: UtmSchema.optional(),
  clickIds: z.object({ gclid: z.boolean().optional(), fbclid: z.boolean().optional() }).strip().optional(),
  productId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  qty: int(1, 99).optional(),
  active: z.number().min(0).max(3600).optional(),
  dwell: int(0, 14_400).optional(),
  scroll: int(0, 100).optional(),
  carousel: int(0, 1000).optional(),
  zoom: int(0, 1000).optional(),
  mode: z.enum(TRYON_MODES).optional(),
  tone: z.enum(TONE_IDS).optional(),
  orderNumber: z.string().regex(/^TBJ\d{10,24}$/).optional(),
}).strip();

const CartItemSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  name: z.string().max(120).optional(),
  qty: int(1, 99),
  price: z.number().min(0).max(10_000_000),
}).strip();

const BatchShape = z.object({
  /* tab = one page load (random); n = that tab's batch counter. A retried
     batch is re-sent with the same (tab, n), so the server can drop it
     whatever order beacons arrive in. */
  tab: z.string().regex(/^[a-z0-9]{4,16}$/),
  n: int(0, 1_000_000),
  cart: z.object({ items: z.array(CartItemSchema).max(30) }).strip().optional(),
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS),
}).strip();

/**
 * @returns {{ batch: { tab, n, cart, events } } | { error: string }}
 */
export function parseBatch(input) {
  const shape = BatchShape.safeParse(input);
  if (!shape.success) return { error: 'invalid batch' };
  const events = [];
  for (const raw of shape.data.events) {
    const r = EventSchema.safeParse(raw);
    if (r.success) events.push(r.data);
  }
  if (!events.length) return { error: 'no valid events' };
  const cart = shape.data.cart
    ? { items: shape.data.cart.items.map((i) => ({ ...i, name: (i.name || '').replace(/[<>]/g, '').slice(0, 120) })) }
    : null;
  return { batch: { tab: shape.data.tab, n: shape.data.n, cart, events } };
}

/** Cart snapshot → { items (pieces), value (₹) }. */
export function cartTotals(cart) {
  if (!cart) return null;
  let items = 0; let value = 0;
  for (const i of cart.items) { items += i.qty; value += i.qty * i.price; }
  return { items, value: Math.round(value * 100) / 100 };
}
