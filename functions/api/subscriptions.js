const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, X-Worker-Pin',
};

function role(request, env) {
  if (request.headers.get('X-Admin-Secret') === env.ADMIN_SECRET) return 'admin';
  if (request.headers.get('X-Worker-Pin') === env.WORKER_PIN) return 'worker';
  return null;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userRole = role(request, env);
  if (!userRole) return new Response('Unauthorized', { status: 401, headers: CORS });

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const expiringSoon = url.searchParams.get('expiring_soon');
    const customerId = url.searchParams.get('customer_id');

    let query = `
      SELECT s.*, c.name as customer_name, c.phone as customer_phone
      FROM subscriptions s JOIN customers c ON s.customer_id = c.id
    `;
    const conditions = ['s.is_active = 1'];
    const params = [];

    if (customerId) { conditions.push('s.customer_id = ?'); params.push(customerId); }
    if (expiringSoon) {
      conditions.push("date(s.end_date) <= date('now', '+7 days') AND date(s.end_date) >= date('now')");
    }

    query += ' WHERE ' + conditions.join(' AND ') + ' ORDER BY s.end_date ASC';
    const stmt = env.DB.prepare(query);
    const { results } = params.length ? await stmt.bind(...params).all() : await stmt.all();
    return new Response(JSON.stringify(results), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    if (userRole !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });

    const { customer_id, car_type, wash_type, frequency } = await request.json();
    if (!customer_id || !car_type || !wash_type || !frequency) {
      return new Response('Missing required fields', { status: 400, headers: CORS });
    }

    const row = await env.DB.prepare('SELECT price FROM monthly_pricing WHERE car_type = ? AND frequency = ? AND wash_type = ?')
      .bind(car_type, Number(frequency), wash_type).first();
    if (!row) return new Response('Pricing not found', { status: 400, headers: CORS });

    const washLabel = wash_type === 'foam' ? 'Foam Wash' : 'Normal Wash';
    const plan_label = `${frequency}× ${washLabel}/month — ${car_type}`;
    const start_date = new Date().toISOString().split('T')[0];
    const end_date = addDays(start_date, 30);

    // Deactivate any existing active subscription for this customer
    await env.DB.prepare('UPDATE subscriptions SET is_active = 0 WHERE customer_id = ? AND is_active = 1')
      .bind(customer_id).run();

    const { meta } = await env.DB.prepare(`
      INSERT INTO subscriptions (customer_id, car_type, wash_type, frequency, plan_label, price, washes_total, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(customer_id, car_type, wash_type, Number(frequency), plan_label, row.price, Number(frequency), start_date, end_date).run();

    return new Response(JSON.stringify({ id: meta.last_row_id }), { status: 201, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
