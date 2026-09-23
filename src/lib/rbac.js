/* ─────────────────────────────────────────────
   Role-based access control for the multi-vendor admin.

   Roles
     super_admin   Platform operator. Only ever granted by ADMIN_EMAILS
                   (an env var outside anyone's reach from the app), never
                   by a database field an admin UI can write.
     vendor_admin  Owner of one vendor: full control of that vendor only.
     vendor_staff  Member of one vendor, permissions from their staff role.

   The actor is resolved from the database on every request instead of
   trusted from the 30-day session JWT, so deactivating a staff member
   takes effect on their next request rather than when their token
   expires. Pure module (db passed in) so it runs under `node --test`.
   ───────────────────────────────────────────── */

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  VENDOR_ADMIN: 'vendor_admin',
  VENDOR_STAFF: 'vendor_staff',
});

export const PERMISSIONS = Object.freeze([
  'catalog:read', 'catalog:write',
  'inventory:read', 'inventory:write', 'warehouses:write',
  'orders:read', 'orders:fulfil',
  'finance:read',
  'reports:read',
  'staff:manage',
]);

const VENDOR_ADMIN_PERMISSIONS = new Set(PERMISSIONS);

/* Existing staff roles (src/app/admin/staff/page.js) mapped onto
   permissions. An unrecognised role gets nothing — deny by default. */
const STAFF_ROLE_PERMISSIONS = {
  ProductManager:   ['catalog:read', 'catalog:write', 'inventory:read'],
  InventoryManager: ['catalog:read', 'inventory:read', 'inventory:write', 'warehouses:write'],
  OrderManager:     ['orders:read', 'orders:fulfil', 'inventory:read', 'catalog:read'],
  BusinessManager:  ['catalog:read', 'inventory:read', 'orders:read', 'finance:read', 'reports:read'],
  SalesStaff:       ['catalog:read', 'orders:read'],
};

/* A staff record's "SuperAdmin" role means super-admin OF THAT VENDOR —
   it must not escalate to platform-wide access across all vendors. */
const VENDOR_ADMIN_STAFF_ROLES = new Set(['SuperAdmin', 'VendorAdmin']);

export function can(actor, permission) {
  if (!actor) return false;
  if (actor.role === ROLES.SUPER_ADMIN) return true;
  return actor.permissions?.has(permission) === true;
}

/**
 * @param {{ user?: { email?: string } } | null} session  NextAuth session
 * @param {FirebaseFirestore.Firestore} db
 * @param {string[]} adminEmails  lowercase, from ADMIN_EMAILS
 * @returns {Promise<null | { role: string, email: string, vendorId?: string, staffId?: string, permissions: Set<string> }>}
 */
export async function resolveActor(session, db, adminEmails) {
  const email = session?.user?.email;
  if (!email) return null;

  if (adminEmails.includes(email.toLowerCase())) {
    return { role: ROLES.SUPER_ADMIN, email, permissions: new Set(PERMISSIONS) };
  }

  const snap = await db.collection('staff').where('email', '==', email).limit(5).get();
  const active = snap.docs.filter((d) => d.data().status === 'Active');

  /* Zero → not staff. More than one → the same person is active at two
     vendors; guessing which one this request is for would be a leak, so
     refuse until a vendor switcher exists. */
  if (active.length !== 1) return null;

  const staff = active[0].data();
  /* No fallback to the platform vendor: a staff record missing vendorId
     (a bug, or a pre-migration record) must fail closed, not be silently
     granted access to Tulsi's own store. */
  if (!staff.vendorId) return null;

  const isVendorAdmin = VENDOR_ADMIN_STAFF_ROLES.has(staff.role);
  return {
    role: isVendorAdmin ? ROLES.VENDOR_ADMIN : ROLES.VENDOR_STAFF,
    email,
    vendorId: staff.vendorId,
    staffId: active[0].id,
    permissions: isVendorAdmin
      ? new Set(VENDOR_ADMIN_PERMISSIONS)
      : new Set(STAFF_ROLE_PERMISSIONS[staff.role] || []),
  };
}
