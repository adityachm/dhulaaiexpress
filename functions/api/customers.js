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

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!role(request, env)) return new Response('Unauthorized', { status: 401, headers: CORS });

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const phone = url.searchParams.get('phone');
    const reg   = url.searchParams.get('reg');

    // Vehicle lookup by reg number — returns vehicle + its registered owner name
    if (reg) {
      const vehicle = await env.DB.prepare(
        'SELECT v.*, c.name as owner_name FROM vehicles v JOIN customers c ON v.customer_id = c.id WHERE v.reg_number = ? LIMIT 1'
      ).bind(reg.trim().toUpperCase()).first();
      return new Response(JSON.stringify(vehicle || null), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (phone) {
      // Autofill lookup — return customer + ALL their vehicles + active subscription
      const customer = await env.DB.prepare('SELECT * FROM customers WHERE phone = ?').bind(phone).first();
      if (!customer) return new Response(JSON.stringify(null), { headers: { ...CORS, 'Content-Type': 'application/json' } });

      const [vehicles, activeSubs] = await Promise.all([
        env.DB.prepare('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY created_at DESC').bind(customer.id).all(),
        env.DB.prepare(
          'SELECT s.*, v.reg_number FROM subscriptions s LEFT JOIN vehicles v ON s.vehicle_id = v.id WHERE s.customer_id = ? AND s.is_active = 1 AND date(s.end_date) >= date(\'now\') ORDER BY s.created_at DESC'
        ).bind(customer.id).all(),
      ]);

      return new Response(JSON.stringify({
        customer,
        vehicles: vehicles.results,
        active_subscriptions: activeSubs.results,
        active_subscription: activeSubs.results[0] || null, // legacy shape
      }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Full list (admin use)
    const { results } = await env.DB.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
    return new Response(JSON.stringify(results), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    const { name, phone } = await request.json();
    if (!name || !phone) return new Response('Missing name or phone', { status: 400, headers: CORS });

    const { meta } = await env.DB.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)')
      .bind(name.trim(), phone.trim()).run();
    return new Response(JSON.stringify({ id: meta.last_row_id }), { status: 201, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
