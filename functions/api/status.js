// Public endpoint — no auth required. Returns only safe job info (no financials).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

  const url = new URL(request.url);
  const phone = url.searchParams.get('phone')?.trim();
  const reg   = url.searchParams.get('reg')?.trim().toUpperCase();

  if (!phone && !reg) {
    return new Response(JSON.stringify({ error: 'Provide phone or reg number' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let job;
  if (phone) {
    job = await env.DB.prepare(`
      SELECT j.id, j.status, j.car_type, j.services_summary, j.checkpoints,
             j.created_at, j.started_at, j.ready_at, j.delivered_at,
             v.reg_number, v.make_model, v.color,
             substr(c.name, 1, instr(c.name || ' ', ' ') - 1) as first_name
      FROM jobs j
      JOIN customers c ON j.customer_id = c.id
      JOIN vehicles  v ON j.vehicle_id  = v.id
      WHERE c.phone = ?
      ORDER BY j.created_at DESC LIMIT 1
    `).bind(phone).first();
  } else {
    job = await env.DB.prepare(`
      SELECT j.id, j.status, j.car_type, j.services_summary, j.checkpoints,
             j.created_at, j.started_at, j.ready_at, j.delivered_at,
             v.reg_number, v.make_model, v.color,
             substr(c.name, 1, instr(c.name || ' ', ' ') - 1) as first_name
      FROM jobs j
      JOIN customers c ON j.customer_id = c.id
      JOIN vehicles  v ON j.vehicle_id  = v.id
      WHERE v.reg_number = ?
      ORDER BY j.created_at DESC LIMIT 1
    `).bind(reg).first();
  }

  if (!job) {
    return new Response(JSON.stringify({ found: false }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ found: true, job }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
