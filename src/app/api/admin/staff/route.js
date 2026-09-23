import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import { PLATFORM_VENDOR_ID } from '@/lib/data/scopedDb';
import { ASSIGNABLE_STAFF_ROLES, normalizeStaffRole } from '@/lib/access';

/* Outside vendors' logins live in this collection too, but are managed from
   the Vendors page — the platform staff screen neither lists nor edits them. */
const isVendorLogin = (s) => !!s.vendorId && s.vendorId !== PLATFORM_VENDOR_ID;

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const db = getDB();
    const snap = await db.collection('staff').get();
    const data = snapshotToArr(snap)
      .filter((s) => !isVendorLogin(s))
      /* role = the tier this record actually grants today (a pre-4-tier role
         like "OrderManager" shows as its mapped tier, or null if it maps to
         none); legacyRole keeps the stored value visible until migration 004. */
      .map(({ password, ...rest }) => {
        let role = normalizeStaffRole(rest.role);
        /* Mirror resolveAccess: a SUPER_ADMIN not granted through this page
           grants nothing, so don't display it as if it did. */
        if (role === 'SUPER_ADMIN' && !rest.roleGrantedBy) role = null;
        return { ...rest, role, ...(rest.role && role !== rest.role && { legacyRole: rest.role }) };
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return NextResponse.json({ success: true, data });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}

export async function POST(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    const { name, email: rawEmail, password, role, phone, status } = await request.json();
    /* Sign-in looks staff up by lowercased email, so store it that way —
       an address saved as typed ("Priya@…") could never log in. */
    const email = String(rawEmail || '').trim().toLowerCase();

    if (!ASSIGNABLE_STAFF_ROLES.includes(role)) {
      return NextResponse.json({ success: false, message: `Role must be one of: ${ASSIGNABLE_STAFF_ROLES.join(', ')}` }, { status: 400 });
    }
    if (!name || !email || !password) {
      return NextResponse.json({ success: false, message: 'Name, email and password are required' }, { status: 400 });
    }

    const db = getDB();

    // Check for duplicate email
    const existing = await db.collection('staff').where('email', '==', email).limit(1).get();
    if (!existing.empty) {
      return NextResponse.json({ success: false, message: 'A staff member with this email already exists' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const ref = db.collection('staff').doc();
    /* roleGrantedBy is what makes a staff-record SUPER_ADMIN count (see
       resolveAccess) — only this SUPER_ADMIN-only route writes it. */
    const doc = { name, email, password: hashedPassword, role, roleGrantedBy: session.user.email || 'unknown', roleGrantedAt: now, phone: phone || '', status: status || 'Active', createdAt: now, updatedAt: now };
    await ref.set(doc);

    const { password: _p, ...safeDoc } = doc;
    return NextResponse.json({ success: true, data: { id: ref.id, ...safeDoc } }, { status: 201 });
  } catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }); }
}
