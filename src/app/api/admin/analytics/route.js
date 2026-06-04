import { NextResponse } from 'next/server';
import { getDB } from '@/lib/firebase';
import { requireAdmin } from '@/lib/adminCollection';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

    const db = getDB();
    const usersSnap = await db.collection('users').get();
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const now = Date.now();
    const thirtyMin = 30 * 60 * 1000;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // Active users (seen in last 30 min)
    const activeUsers = users.filter((u) => u.lastLoginAt && now - new Date(u.lastLoginAt).getTime() < thirtyMin);

    // Today sessions
    const todaySessions = users.filter((u) => u.lastLoginAt && new Date(u.lastLoginAt) >= todayStart);

    // Total sessions this week
    const weekSessions = users.filter((u) => u.lastLoginAt && new Date(u.lastLoginAt) >= weekStart);

    // Avg session duration (minutes)
    const usersWithSessions = users.filter((u) => u.sessionCount > 0 && u.totalSessionSeconds > 0);
    const avgSessionMin = usersWithSessions.length
      ? Math.round(usersWithSessions.reduce((s, u) => s + (u.totalSessionSeconds / u.sessionCount), 0) / usersWithSessions.length / 60 * 10) / 10
      : 0;

    // Category interests — aggregate across all users
    const catTotals = {};
    for (const u of users) {
      if (u.categoryInterests && typeof u.categoryInterests === 'object') {
        for (const [cat, count] of Object.entries(u.categoryInterests)) {
          catTotals[cat] = (catTotals[cat] || 0) + count;
        }
      }
    }
    const topCategories = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, views]) => ({ name, views }));

    // Recent page views — aggregate last 5 per user, count paths
    const pageCounts = {};
    for (const u of users) {
      if (Array.isArray(u.recentPages)) {
        for (const p of u.recentPages) {
          pageCounts[p.path] = (pageCounts[p.path] || 0) + 1;
        }
      }
    }
    const topPages = Object.entries(pageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, views]) => ({ path, views }));

    // Cart abandonment: users who have a savedCart with items
    const cartAbandoned = users.filter((u) => Array.isArray(u.savedCart) && u.savedCart.length > 0);

    // New customers this week
    const newThisWeek = users.filter((u) => u.createdAt && new Date(u.createdAt) >= weekStart);

    // Most viewed products
    const productCounts = {};
    for (const u of users) {
      if (u.lastSeenProduct?.id) {
        const key = u.lastSeenProduct.id;
        if (!productCounts[key]) productCounts[key] = { ...u.lastSeenProduct, views: 0 };
        productCounts[key].views++;
      }
    }
    const topProducts = Object.values(productCounts)
      .sort((a, b) => b.views - a.views)
      .slice(0, 6);

    return NextResponse.json({
      success: true,
      data: {
        activeNow: activeUsers.length,
        todaySessions: todaySessions.length,
        weekSessions: weekSessions.length,
        totalUsers: users.length,
        avgSessionMin,
        cartAbandoned: cartAbandoned.length,
        newThisWeek: newThisWeek.length,
        topCategories,
        topPages,
        topProducts,
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
