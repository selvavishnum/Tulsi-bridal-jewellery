/* ─────────────────────────────────────────────
   Vendor-scoped data access — the tenant-isolation chokepoint.

   Every read and write in this app goes through the Firebase Admin SDK,
   which bypasses Firestore Security Rules entirely, so there is no
   database-engine-level row security to lean on: isolation has to be
   enforced here, in one place, and every vendor-owned query must go
   through it. Deliberately has no '@/…' imports and takes `db` as a
   parameter so the isolation tests can run it against an in-memory fake
   with plain `node --test`.

   Not-owned documents come back as null (→ 404), never 403, so a vendor
   can't probe whether another vendor's document IDs exist.
   ───────────────────────────────────────────── */

export const PLATFORM_VENDOR_ID = 'tulsi';

/* Collections in which every document belongs to exactly one vendor.
   Platform-level collections (users, settings, siteVisits, otp_codes,
   loyalty, …) are intentionally absent — asking this layer for one of
   them throws instead of silently returning an unfiltered query. */
export const VENDOR_SCOPED = new Set([
  'products',
  'warehouses',
  'stockLots',
  'purchaseOrders',
  'purchaseIndents',
  'suppliers',
  'accounting',
  'employees',
  'rentals',
  'staff',
  'vendorOrders',
  'vendorLedger',
]);

export class TenantIsolationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

/**
 * @param {{ role: 'super_admin'|'vendor_admin'|'vendor_staff', vendorId?: string, actingAsVendorId?: string }} actor
 * @param {FirebaseFirestore.Firestore} db
 */
export function scopedDb(actor, db) {
  if (!actor?.role) throw new TenantIsolationError('No actor');

  /* A super_admin sees every vendor unless explicitly acting as one (the
     "view as vendor" support mode). Everyone else is pinned to their own
     vendor and cannot widen it. */
  const platformView = actor.role === 'super_admin' && !actor.actingAsVendorId;
  const vendorId = actor.role === 'super_admin' ? actor.actingAsVendorId : actor.vendorId;
  if (!platformView && !vendorId) throw new TenantIsolationError('Actor has no vendor context');

  function assertScoped(col) {
    if (!VENDOR_SCOPED.has(col)) {
      throw new TenantIsolationError(`"${col}" is not a vendor-scoped collection`);
    }
  }

  function owns(data) {
    return platformView || (!!data && data.vendorId === vendorId);
  }

  /* vendorId is immutable through this layer — stripped from every update.
     That is also what makes the check-then-write in update()/remove() safe:
     the owner of a document can't change between the ownership check and
     the write, so there is no window for a TOCTOU swap. */
  function withoutVendorId(data) {
    const { vendorId: _ignored, ...rest } = data || {};
    return rest;
  }

  async function get(col, id) {
    assertScoped(col);
    const snap = await db.collection(col).doc(String(id)).get();
    if (!snap.exists || !owns(snap.data())) return null;
    return { id: snap.id, ...snap.data() };
  }

  return {
    vendorId: platformView ? null : vendorId,
    platformView,

    /** Base query for a collection, already filtered to this actor's vendor. Chain further .where/.orderBy on it. */
    query(col) {
      assertScoped(col);
      const ref = db.collection(col);
      return platformView ? ref : ref.where('vendorId', '==', vendorId);
    },

    /** Returns { id, ...data } or null if missing OR owned by another vendor. */
    get,

    async create(col, data) {
      assertScoped(col);
      let owner = vendorId;
      if (platformView) {
        owner = data?.vendorId;
        if (!owner) throw new TenantIsolationError(`Platform-view create in "${col}" must name a vendorId`);
      } else if (data?.vendorId && data.vendorId !== vendorId) {
        throw new TenantIsolationError('Cannot create a document for another vendor');
      }
      const now = new Date().toISOString();
      const ref = db.collection(col).doc();
      const doc = { ...withoutVendorId(data), vendorId: owner, createdAt: now, updatedAt: now };
      await ref.set(doc);
      return { id: ref.id, ...doc };
    },

    /** Returns the updated document, or null if missing / not owned. */
    async update(col, id, data) {
      const existing = await get(col, id);
      if (!existing) return null;
      const ref = db.collection(col).doc(String(id));
      await ref.update({ ...withoutVendorId(data), updatedAt: new Date().toISOString() });
      const snap = await ref.get();
      return { id: snap.id, ...snap.data() };
    },

    /** Returns true if deleted, false if missing / not owned. */
    async remove(col, id) {
      const existing = await get(col, id);
      if (!existing) return false;
      await db.collection(col).doc(String(id)).delete();
      return true;
    },

    /** For use inside a db.runTransaction after a tx.get(): throws unless this actor owns the document. */
    assertOwns(data) {
      if (!owns(data)) throw new TenantIsolationError('Document belongs to another vendor');
    },
  };
}
