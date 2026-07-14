// Public, token-scoped endpoint for the member details form.
// The token (shared with the member over WhatsApp) is the only credential;
// it exposes and accepts nothing beyond building/flat/parking.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function findByToken(env, token) {
  if (!token || token.length < 20) return null;
  return env.DB.prepare(`
    SELECT s.id, s.customer_id, s.vehicle_id,
           c.name, c.building_name, c.flat_number,
           v.reg_number, v.make_model, v.parking_number
    FROM subscriptions s
    JOIN customers c ON s.customer_id = c.id
    LEFT JOIN vehicles v ON s.vehicle_id = v.id
    WHERE s.info_token = ? AND s.is_active = 1
  `).bind(token).first();
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').trim();
  const row = await findByToken(env, token);
  if (!row) return new Response('Link is invalid or has expired', { status: 404, headers: CORS });

  if (request.method === 'GET') {
    return new Response(JSON.stringify({
      name: row.name,
      reg_number: row.reg_number,
      make_model: row.make_model,
      building_name: row.building_name,
      flat_number: row.flat_number,
      parking_number: row.parking_number,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PUT') {
    const body = await request.json();
    const clean = v => String(v ?? '').trim().slice(0, 80);
    await env.DB.prepare('UPDATE customers SET building_name = ?, flat_number = ? WHERE id = ?')
      .bind(clean(body.building_name), clean(body.flat_number), row.customer_id).run();
    if (row.vehicle_id) {
      await env.DB.prepare('UPDATE vehicles SET parking_number = ? WHERE id = ?')
        .bind(clean(body.parking_number), row.vehicle_id).run();
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
