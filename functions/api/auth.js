const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, X-Worker-Pin',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const { secret } = await request.json().catch(() => ({}));
  if (!secret) return new Response(JSON.stringify({ role: null }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  let role = null;
  if (secret === env.ADMIN_SECRET) role = 'admin';
  else if (secret === env.WORKER_PIN) role = 'worker';

  return new Response(JSON.stringify({ role }), {
    status: role ? 200 : 401,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
