import { NextResponse } from 'next/server';
import { getDB, snapshotToArr } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';
import { startOfMonth, endOfMonth } from 'date-fns';

export async function GET(request) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'overview';
    const from = searchParams.get('from') || null;
    const to   = searchParams.get('to')   || null;

    const db = getDB();

    function inRange(dateStr) {
      if (!dateStr) return true;
      if (from && dateStr < from) return false;
      if (to   && dateStr > to + 'T23:59:59') return false;
      return true;
    }

    // ── OVERVIEW ──────────────────────────────────────────────
    if (type === 'overview') {
      const now = new Date();
      const monthStart = startOfMonth(now).toISOString();
      const monthEnd   = endOfMonth(now).toISOString();

      const ordersSnap   = await db.collection('orders').orderBy('createdAt', 'desc').get();
      const allOrders    = snapshotToArr(ordersSnap);
      const paidOrders   = allOrders.filter((o) => o.payment?.status === 'paid');
      const monthOrders  = allOrders.filter((o) => o.createdAt >= monthStart && o.createdAt <= monthEnd);
      const monthPaid    = paidOrders.filter((o) => o.createdAt >= monthStart && o.createdAt <= monthEnd);
      const totalRevenue = paidOrders.reduce((s, o) => s + (o.total || 0), 0);
      const monthRevenue = monthPaid.reduce((s, o) => s + (o.total || 0), 0);

      const rentalsSnap  = await db.collection('rentals').orderBy('createdAt', 'desc').get();
      const allRentals   = snapshotToArr(rentalsSnap);
      const monthRentals = allRentals.filter((r) => r.createdAt >= monthStart && r.createdAt <= monthEnd);

      const [productsSnap, usersSnap] = await Promise.all([
        db.collection('products').get(),
        db.collection('users').get(),
      ]);
      const totalProducts  = snapshotToArr(productsSnap).filter((p) => p.isActive !== false).length;
      const totalCustomers = snapshotToArr(usersSnap).filter((u) => u.role === 'customer').length;

      const salesMap = {};
      for (const order of paidOrders) {
        for (const item of (order.items || [])) {
          if (!salesMap[item.product]) salesMap[item.product] = { name: item.name, totalSold: 0, revenue: 0 };
          salesMap[item.product].totalSold += item.quantity || 0;
          salesMap[item.product].revenue   += (item.price || 0) * (item.quantity || 0);
        }
      }
      const topProducts = Object.entries(salesMap)
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.totalSold - a.totalSold)
        .slice(0, 5);

      const monthlyMap = {};
      for (const order of allOrders) {
        const d   = new Date(order.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyMap[key]) monthlyMap[key] = { month: key, orders: 0, revenue: 0 };
        monthlyMap[key].orders  += 1;
        monthlyMap[key].revenue += order.total || 0;
      }
      const monthlyData = Object.values(monthlyMap)
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-6);

      return NextResponse.json({
        success: true,
        data: {
          overview: {
            totalOrders: allOrders.length, monthOrders: monthOrders.length,
            totalRevenue, monthRevenue,
            totalRentals: allRentals.length, monthRentals: monthRentals.length,
            totalProducts, totalCustomers,
          },
          topProducts, monthlyData,
        },
      });
    }

    // ── SALES BY PRODUCT ──────────────────────────────────────
    if (type === 'sales-by-product') {
      const ordersSnap = await db.collection('orders').get();
      const orders = snapshotToArr(ordersSnap).filter((o) => inRange(o.createdAt));
      const salesMap = {};
      for (const order of orders) {
        for (const item of (order.items || [])) {
          const key = item.product || item.name;
          if (!salesMap[key]) salesMap[key] = { product: item.name, unitsSold: 0, revenue: 0, orderCount: 0 };
          salesMap[key].unitsSold  += item.quantity || 0;
          salesMap[key].revenue    += (item.price || 0) * (item.quantity || 0);
          salesMap[key].orderCount += 1;
        }
      }
      const rows = Object.values(salesMap).sort((a, b) => b.revenue - a.revenue);
      const totals = { unitsSold: rows.reduce((s, r) => s + r.unitsSold, 0), revenue: rows.reduce((s, r) => s + r.revenue, 0) };
      return NextResponse.json({ success: true, data: { rows, totals } });
    }

    // ── SALES BY CATEGORY ─────────────────────────────────────
    if (type === 'sales-by-category') {
      const [ordersSnap, productsSnap] = await Promise.all([
        db.collection('orders').get(),
        db.collection('products').get(),
      ]);
      const orders   = snapshotToArr(ordersSnap).filter((o) => inRange(o.createdAt));
      const prodMap  = {};
      snapshotToArr(productsSnap).forEach((p) => { prodMap[p.id] = p; });
      const catMap = {};
      for (const order of orders) {
        for (const item of (order.items || [])) {
          const cat = prodMap[item.product]?.category || 'Other';
          if (!catMap[cat]) catMap[cat] = { category: cat, unitsSold: 0, revenue: 0, orderIds: new Set() };
          catMap[cat].unitsSold += item.quantity || 0;
          catMap[cat].revenue   += (item.price || 0) * (item.quantity || 0);
          catMap[cat].orderIds.add(order.id);
        }
      }
      const rows = Object.values(catMap)
        .map((c) => ({ category: c.category, unitsSold: c.unitsSold, revenue: c.revenue, orders: c.orderIds.size }))
        .sort((a, b) => b.revenue - a.revenue);
      return NextResponse.json({ success: true, data: { rows } });
    }

    // ── SALES BY ORDER ────────────────────────────────────────
    if (type === 'sales-by-order') {
      const ordersSnap = await db.collection('orders').orderBy('createdAt', 'desc').get();
      const orders = snapshotToArr(ordersSnap).filter((o) => inRange(o.createdAt));
      const rows = orders.map((o) => ({
        orderNumber:   o.orderNumber || o.id,
        date:          o.createdAt,
        customer:      o.shippingAddress?.name || o.shippingAddress?.fullName || '—',
        phone:         o.shippingAddress?.phone || '—',
        city:          o.shippingAddress?.city || '—',
        items:         (o.items || []).length,
        subtotal:      o.subtotal || 0,
        discount:      o.discount || 0,
        shipping:      o.shippingCost || 0,
        total:         o.total || 0,
        payment:       o.payment?.method === 'cod' ? 'COD' : 'Online',
        paymentStatus: o.payment?.status || 'pending',
        orderStatus:   o.status || '—',
      }));
      const totals = {
        orders: rows.length,
        revenue: rows.reduce((s, r) => s + r.total, 0),
        discount: rows.reduce((s, r) => s + r.discount, 0),
      };
      return NextResponse.json({ success: true, data: { rows, totals } });
    }

    // ── TOP SELLING PRODUCTS ──────────────────────────────────
    if (type === 'top-products') {
      const ordersSnap = await db.collection('orders').get();
      const orders = snapshotToArr(ordersSnap).filter((o) => inRange(o.createdAt));
      const salesMap = {};
      for (const order of orders) {
        for (const item of (order.items || [])) {
          const key = item.product || item.name;
          if (!salesMap[key]) salesMap[key] = { product: item.name, unitsSold: 0, revenue: 0 };
          salesMap[key].unitsSold += item.quantity || 0;
          salesMap[key].revenue   += (item.price || 0) * (item.quantity || 0);
        }
      }
      const rows = Object.values(salesMap).sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 20);
      return NextResponse.json({ success: true, data: { rows } });
    }

    // ── TOP PURCHASING CUSTOMERS ──────────────────────────────
    if (type === 'top-customers') {
      const [ordersSnap, usersSnap] = await Promise.all([
        db.collection('orders').get(),
        db.collection('users').get(),
      ]);
      const orders = snapshotToArr(ordersSnap).filter((o) => inRange(o.createdAt));
      const users  = {};
      snapshotToArr(usersSnap).forEach((u) => { users[u.id] = u; });
      const custMap = {};
      for (const order of orders) {
        const uid = order.userId || order.guestEmail || 'guest-' + (order.shippingAddress?.phone || '');
        if (!custMap[uid]) {
          const u = users[uid];
          custMap[uid] = {
            customer:   u?.name || order.shippingAddress?.name || 'Guest',
            email:      u?.email || order.guestEmail || '—',
            phone:      u?.phone || order.shippingAddress?.phone || '—',
            orders:     0,
            totalSpent: 0,
            lastOrder:  null,
          };
        }
        custMap[uid].orders     += 1;
        custMap[uid].totalSpent += order.total || 0;
        if (!custMap[uid].lastOrder || order.createdAt > custMap[uid].lastOrder) {
          custMap[uid].lastOrder = order.createdAt;
        }
      }
      const rows = Object.values(custMap).sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 20);
      return NextResponse.json({ success: true, data: { rows } });
    }

    // ── GST SALES REPORT ──────────────────────────────────────
    if (type === 'gst-sales') {
      const ordersSnap = await db.collection('orders').orderBy('createdAt', 'desc').get();
      const orders = snapshotToArr(ordersSnap).filter((o) => inRange(o.createdAt));
      const GST = 0.03; // 3% for fashion jewellery (CGST 1.5% + SGST 1.5%)
      const rows = orders.map((o) => {
        const taxable = Math.round(((o.total || 0) / (1 + GST)) * 100) / 100;
        const gstAmt  = Math.round(((o.total || 0) - taxable) * 100) / 100;
        return {
          invoiceNo:     o.orderNumber || o.id,
          date:          o.createdAt,
          customer:      o.shippingAddress?.name || o.shippingAddress?.fullName || '—',
          state:         o.shippingAddress?.state || '—',
          taxableAmount: taxable,
          cgst:          Math.round((gstAmt / 2) * 100) / 100,
          sgst:          Math.round((gstAmt / 2) * 100) / 100,
          gstTotal:      gstAmt,
          grandTotal:    o.total || 0,
          payment:       o.payment?.method === 'cod' ? 'COD' : 'Online',
          status:        o.status,
        };
      });
      const totals = {
        taxableAmount: Math.round(rows.reduce((s, r) => s + r.taxableAmount, 0) * 100) / 100,
        cgst:          Math.round(rows.reduce((s, r) => s + r.cgst, 0) * 100) / 100,
        sgst:          Math.round(rows.reduce((s, r) => s + r.sgst, 0) * 100) / 100,
        gstTotal:      Math.round(rows.reduce((s, r) => s + r.gstTotal, 0) * 100) / 100,
        grandTotal:    Math.round(rows.reduce((s, r) => s + r.grandTotal, 0) * 100) / 100,
      };
      return NextResponse.json({ success: true, data: { rows, totals } });
    }

    // ── RENTAL REPORT ─────────────────────────────────────────
    if (type === 'rentals') {
      const rentalsSnap = await db.collection('rentals').orderBy('createdAt', 'desc').get();
      const rentals = snapshotToArr(rentalsSnap).filter((r) => inRange(r.createdAt));
      const rows = rentals.map((r) => ({
        bookingId:    r.bookingId || r.id,
        product:      r.productName || r.name || '—',
        customer:     r.customerName || r.name || r.shippingAddress?.name || '—',
        phone:        r.phone || r.shippingAddress?.phone || '—',
        startDate:    r.startDate || r.rentalStart || '—',
        endDate:      r.endDate || r.rentalEnd || '—',
        rentalDays:   r.rentalDays || '—',
        rentalAmount: r.rentalAmount || r.price || 0,
        deposit:      r.deposit || r.securityDeposit || 0,
        total:        r.total || (r.rentalAmount || 0) + (r.deposit || 0),
        status:       r.status || '—',
      }));
      const totals = {
        count:        rows.length,
        rentalRevenue: rows.reduce((s, r) => s + r.rentalAmount, 0),
        deposits:     rows.reduce((s, r) => s + r.deposit, 0),
        total:        rows.reduce((s, r) => s + r.total, 0),
      };
      return NextResponse.json({ success: true, data: { rows, totals } });
    }

    // ── SALES & REVENUE SUMMARY ───────────────────────────────
    if (type === 'sales-summary') {
      const [ordersSnap, rentalsSnap] = await Promise.all([
        db.collection('orders').get(),
        db.collection('rentals').get(),
      ]);
      const orders  = snapshotToArr(ordersSnap);
      const rentals = snapshotToArr(rentalsSnap);
      const monthlyMap = {};
      for (const o of orders) {
        const d   = new Date(o.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyMap[key]) monthlyMap[key] = { month: key, orders: 0, orderRevenue: 0, rentals: 0, rentalRevenue: 0, discount: 0 };
        monthlyMap[key].orders       += 1;
        monthlyMap[key].orderRevenue += o.total || 0;
        monthlyMap[key].discount     += o.discount || 0;
      }
      for (const r of rentals) {
        const d   = new Date(r.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyMap[key]) monthlyMap[key] = { month: key, orders: 0, orderRevenue: 0, rentals: 0, rentalRevenue: 0, discount: 0 };
        monthlyMap[key].rentals       += 1;
        monthlyMap[key].rentalRevenue += r.total || r.rentalAmount || 0;
      }
      const rows = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));
      return NextResponse.json({ success: true, data: { rows } });
    }

    // ── PRODUCT PRICE LIST ────────────────────────────────────
    if (type === 'price-list') {
      const productsSnap = await db.collection('products').get();
      const products = snapshotToArr(productsSnap);
      const rows = products
        .filter((p) => p.isActive !== false)
        .map((p) => ({
          name:      p.name || '—',
          category:  p.category || '—',
          sku:       p.sku || '—',
          mrp:       p.price || 0,
          selling:   p.discountPrice || p.price || 0,
          discountPct: p.price && p.discountPrice ? Math.round(((p.price - p.discountPrice) / p.price) * 100) : 0,
          stock:     p.stock ?? '—',
          rental:    p.availableForRental ? 'Yes' : 'No',
          rentalRate: p.rentalPricePerDay || 0,
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      return NextResponse.json({ success: true, data: { rows } });
    }

    // ── COUPON USAGE REPORT ───────────────────────────────────
    if (type === 'coupons') {
      const [couponsSnap, ordersSnap] = await Promise.all([
        db.collection('coupons').get(),
        db.collection('orders').get(),
      ]);
      const coupons = snapshotToArr(couponsSnap);
      const orders  = snapshotToArr(ordersSnap).filter((o) => inRange(o.createdAt) && o.couponCode);
      const usage = {};
      for (const o of orders) {
        const code = (o.couponCode || '').toUpperCase();
        if (!usage[code]) usage[code] = { usedCount: 0, totalDiscount: 0, totalRevenue: 0 };
        usage[code].usedCount     += 1;
        usage[code].totalDiscount += o.discount || 0;
        usage[code].totalRevenue  += o.total || 0;
      }
      const rows = coupons.map((c) => ({
        code:          c.code,
        type:          c.type || '—',
        value:         c.value || 0,
        minOrder:      c.minOrderAmount || 0,
        usedCount:     usage[c.code]?.usedCount || 0,
        totalDiscount: usage[c.code]?.totalDiscount || 0,
        totalRevenue:  usage[c.code]?.totalRevenue || 0,
        status:        c.isActive ? 'Active' : 'Inactive',
        expiresAt:     c.expiresAt || '—',
      })).sort((a, b) => b.usedCount - a.usedCount);
      return NextResponse.json({ success: true, data: { rows } });
    }

    // ── LOYALTY POINTS REPORT ─────────────────────────────────
    if (type === 'loyalty') {
      const usersSnap = await db.collection('users').get();
      const users = snapshotToArr(usersSnap).filter((u) => u.role === 'customer');
      const rows = users
        .map((u) => ({
          customer:      u.name || '—',
          email:         u.email || '—',
          phone:         u.phone || '—',
          loyaltyPoints: u.loyaltyPoints || 0,
          redeemableValue: Math.floor((u.loyaltyPoints || 0) / 50) * 50,
          totalOrders:   u.totalOrders || 0,
          totalSpent:    u.totalSpent || 0,
          referralCode:  u.referralCode || '—',
          joinedAt:      u.createdAt || '—',
        }))
        .sort((a, b) => b.loyaltyPoints - a.loyaltyPoints);
      const totals = {
        customers:   rows.length,
        totalPoints: rows.reduce((s, r) => s + r.loyaltyPoints, 0),
        totalSpent:  rows.reduce((s, r) => s + r.totalSpent, 0),
      };
      return NextResponse.json({ success: true, data: { rows, totals } });
    }

    return NextResponse.json({ success: false, message: 'Unknown report type' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
