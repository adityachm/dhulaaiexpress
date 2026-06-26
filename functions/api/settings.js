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
    const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
    const obj = {};
    results.forEach(r => { obj[r.key] = r.value; });
    return new Response(JSON.stringify(obj), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PUT') {
    if (role(request, env) !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });
    const { key, value } = await request.json();
    if (!key || value === undefined) return new Response('Bad request', { status: 400, headers: CORS });
    await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
