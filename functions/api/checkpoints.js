const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM checkpoint_templates ORDER BY service_key').all();
    return new Response(JSON.stringify(results), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PUT') {
    if (role(request, env) !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });
    const { service_key, steps } = await request.json();
    if (!service_key || !Array.isArray(steps)) return new Response('Bad request', { status: 400, headers: CORS });
    await env.DB.prepare('INSERT OR REPLACE INTO checkpoint_templates (service_key, steps, updated_at) VALUES (?, ?, datetime(\'now\'))')
      .bind(service_key, JSON.stringify(steps)).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
