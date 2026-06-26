const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, X-Worker-Pin',
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

  if (request.headers.get('X-Admin-Secret') !== env.ADMIN_SECRET) {
    return new Response('Unauthorized', { status: 401, headers: CORS });
  }

  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'today';
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let dateFilter;
  if (range === 'today') {
    dateFilter = "date(j.created_at) = date('now')";
  } else if (range === 'week') {
    dateFilter = "date(j.created_at) >= date('now', '-6 days')";
  } else if (range === 'month') {
    dateFilter = "date(j.created_at) >= date('now', 'start of month')";
  } else if (range === 'custom' && from && to) {
    dateFilter = `date(j.created_at) BETWEEN date('${from}') AND date('${to}')`;
  } else {
    dateFilter = "date(j.created_at) = date('now')";
  }

  const [overview, byWashType, byPaymentMode, byStatus, topCustomers, subStats] = await Promise.all([
    // Overall counts and revenue
    env.DB.prepare(`
      SELECT COUNT(*) as total_jobs, COALESCE(SUM(price), 0) as total_revenue,
             COALESCE(SUM(amount_paid), 0) as total_collected
      FROM jobs j WHERE ${dateFilter}
    `).first(),

    // Revenue + count by wash_type
    env.DB.prepare(`
      SELECT wash_type, COUNT(*) as count, COALESCE(SUM(price), 0) as revenue
      FROM jobs j WHERE ${dateFilter} GROUP BY wash_type
    `).all(),

    // Revenue + count by payment_mode
    env.DB.prepare(`
      SELECT payment_mode, COUNT(*) as count, COALESCE(SUM(price), 0) as revenue
      FROM jobs j WHERE ${dateFilter} GROUP BY payment_mode
    `).all(),

    // Count by status
    env.DB.prepare(`
      SELECT status, COUNT(*) as count FROM jobs j WHERE ${dateFilter} GROUP BY status
    `).all(),

    // Top 5 repeat customers in period
    env.DB.prepare(`
      SELECT c.name, c.phone, COUNT(j.id) as visits, COALESCE(SUM(j.price), 0) as spent
      FROM jobs j JOIN customers c ON j.customer_id = c.id
      WHERE ${dateFilter} GROUP BY j.customer_id ORDER BY visits DESC LIMIT 5
    `).all(),

    // Subscription summary
    env.DB.prepare(`
      SELECT
        COUNT(CASE WHEN is_active = 1 AND date(end_date) >= date('now') THEN 1 END) as active_count,
        COUNT(CASE WHEN is_active = 1 AND date(end_date) BETWEEN date('now') AND date('now', '+7 days') THEN 1 END) as expiring_soon,
        COALESCE(SUM(CASE WHEN is_active = 1 THEN price ELSE 0 END), 0) as active_revenue
      FROM subscriptions
    `).first(),
  ]);

  // Also fetch today's live counts regardless of range (for dashboard tiles)
  const liveNow = await env.DB.prepare(`
    SELECT
      COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
      COUNT(CASE WHEN status = 'ready' THEN 1 END) as ready_for_pickup,
      COUNT(CASE WHEN date(created_at) = date('now') THEN 1 END) as today_total
    FROM jobs
  `).first();

  return new Response(JSON.stringify({
    range,
    overview,
    by_wash_type: byWashType.results,
    by_payment_mode: byPaymentMode.results,
    by_status: byStatus.results,
    top_customers: topCustomers.results,
    subscriptions: subStats,
    live_now: liveNow,
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
