const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, X-Worker-Pin',
};

const CAR_TYPES = ['Hatchback', 'Sedan', 'Compact SUV', 'Mid SUV', 'Large SUV', 'Luxury Car'];
const WASH_TYPES = ['top', 'normal', 'foam'];
const FREQUENCIES = [1, 2, 4];

function role(request, env) {
  if (request.headers.get('X-Admin-Secret') === env.ADMIN_SECRET) return 'admin';
  if (request.headers.get('X-Worker-Pin') === env.WORKER_PIN) return 'worker';
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (request.method === 'GET') {
    if (!role(request, env)) return new Response('Unauthorized', { status: 401, headers: CORS });

    const [washRows, monthlyRows, addonRows, addonPricingRows] = await Promise.all([
      env.DB.prepare('SELECT car_type, wash_type, price FROM wash_pricing').all(),
      env.DB.prepare('SELECT car_type, frequency, wash_type, price FROM monthly_pricing').all(),
      env.DB.prepare('SELECT id, name, base_price FROM addon_services WHERE is_active = 1').all(),
      env.DB.prepare('SELECT addon_id, car_type, price FROM addon_pricing').all(),
    ]);

    // Build nested lookup objects for easy frontend use
    const wash = {};
    for (const r of washRows.results) {
      if (!wash[r.car_type]) wash[r.car_type] = {};
      wash[r.car_type][r.wash_type] = r.price;
    }
    const monthly = {};
    for (const r of monthlyRows.results) {
      if (!monthly[r.car_type]) monthly[r.car_type] = {};
      if (!monthly[r.car_type][r.frequency]) monthly[r.car_type][r.frequency] = {};
      monthly[r.car_type][r.frequency][r.wash_type] = r.price;
    }
    const addonPricing = {};
    for (const r of addonPricingRows.results) {
      if (!addonPricing[r.addon_id]) addonPricing[r.addon_id] = {};
      addonPricing[r.addon_id][r.car_type] = r.price;
    }

    return new Response(JSON.stringify({
      car_types: CAR_TYPES,
      wash_types: WASH_TYPES,
      frequencies: FREQUENCIES,
      wash,
      monthly,
      addons: addonRows.results,
      addon_pricing: addonPricing,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PUT') {
    if (role(request, env) !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });

    const body = await request.json();
    const { type, car_type, wash_type, frequency, price, addon_id, base_price } = body;

    if (type === 'wash') {
      await env.DB.prepare('INSERT OR REPLACE INTO wash_pricing (car_type, wash_type, price) VALUES (?, ?, ?)')
        .bind(car_type, wash_type, Number(price)).run();
    } else if (type === 'monthly') {
      await env.DB.prepare('INSERT OR REPLACE INTO monthly_pricing (car_type, frequency, wash_type, price) VALUES (?, ?, ?, ?)')
        .bind(car_type, Number(frequency), wash_type, Number(price)).run();
    } else if (type === 'addon_pricing') {
      const { addon_id: aid, car_type: ct, price: p } = body;
      await env.DB.prepare('INSERT OR REPLACE INTO addon_pricing (addon_id, car_type, price) VALUES (?, ?, ?)')
        .bind(Number(aid), ct, Number(p)).run();
    } else {
      return new Response('Unknown type', { status: 400, headers: CORS });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
