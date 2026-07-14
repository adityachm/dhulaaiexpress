const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, X-Worker-Pin',
};

function role(request, env) {
  if (request.headers.get('X-Admin-Secret') === env.ADMIN_SECRET) return 'admin';
  if (request.headers.get('X-Worker-Pin') === env.WORKER_PIN) return 'worker';
  return null;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userRole = role(request, env);
  if (!userRole) return new Response('Unauthorized', { status: 401, headers: CORS });

  const id = params.id;

  if (request.method === 'PATCH') {
    const body = await request.json();

    if (body.deactivate) {
      if (userRole !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });
      await env.DB.prepare('UPDATE subscriptions SET is_active = 0 WHERE id = ?').bind(id).run();
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Update residence/parking for the member (customer + vehicle of this sub)
    if (body.details) {
      if (userRole !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });
      const sub = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first();
      if (!sub) return new Response('Not found', { status: 404, headers: CORS });
      const { building_name, flat_number, parking_number } = body.details;
      await env.DB.prepare('UPDATE customers SET building_name = ?, flat_number = ? WHERE id = ?')
        .bind(building_name ?? '', flat_number ?? '', sub.customer_id).run();
      if (sub.vehicle_id) {
        await env.DB.prepare('UPDATE vehicles SET parking_number = ? WHERE id = ?')
          .bind(parking_number ?? '', sub.vehicle_id).run();
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Generate (or reuse) the shareable details-form token
    if (body.make_info_token) {
      if (userRole !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });
      const sub = await env.DB.prepare('SELECT info_token FROM subscriptions WHERE id = ?').bind(id).first();
      if (!sub) return new Response('Not found', { status: 404, headers: CORS });
      let token = sub.info_token;
      if (!token) {
        token = crypto.randomUUID().replace(/-/g, '');
        await env.DB.prepare('UPDATE subscriptions SET info_token = ? WHERE id = ?').bind(token, id).run();
      }
      return new Response(JSON.stringify({ token }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (body.paid !== undefined) {
      if (userRole !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });
      if (body.paid) {
        await env.DB.prepare("UPDATE subscriptions SET is_paid = 1, paid_at = datetime('now') WHERE id = ?").bind(id).run();
      } else {
        await env.DB.prepare('UPDATE subscriptions SET is_paid = 0, paid_at = NULL WHERE id = ?').bind(id).run();
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response('Nothing to update', { status: 400, headers: CORS });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
