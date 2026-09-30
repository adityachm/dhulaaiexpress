import { getCarTypes, saveCarTypes } from '../_lib/car-types.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, X-Worker-Pin',
};

const WASH_TYPES = ['top', 'normal', 'foam'];
const DEFAULT_ADDON_STEPS = ['Service started', 'Service completed', 'Final inspection'];
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

    const [carTypes, washRows, monthlyRows, addonRows, addonPricingRows] = await Promise.all([
      getCarTypes(env),
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
      car_types: carTypes,
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
    const { type, car_type, wash_type, frequency, price } = body;
    const bad = msg => new Response(msg, { status: 400, headers: CORS });
    // Names are shown in the panels — keep to plain characters
    const SAFE_NAME = /^[A-Za-z0-9 ./&()+-]+$/;
    const ok = extra => new Response(JSON.stringify({ ok: true, ...extra }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    // ── Rows: car types (shared by one-time, monthly and add-on tables) ──
    if (type === 'add_car_type') {
      const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > 40) return bad('Enter a car type name (up to 40 characters)');
      if (!SAFE_NAME.test(name)) return bad('Use letters, numbers, spaces and . / & ( ) + - only');
      const list = await getCarTypes(env);
      if (list.some(ct => ct.toLowerCase() === name.toLowerCase())) return bad(`"${name}" already exists`);
      await saveCarTypes(env, [...list, name]);
      return ok({ car_type: name });
    }

    if (type === 'remove_car_type') {
      const list = await getCarTypes(env);
      if (!list.includes(car_type)) return bad('Unknown car type');
      if (list.length === 1) return bad('At least one car type is required');
      // Refuse while real records depend on it — their prices would vanish
      const [veh, sub] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS n FROM vehicles WHERE car_type = ?').bind(car_type).first(),
        env.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE car_type = ? AND is_active = 1').bind(car_type).first(),
      ]);
      if (veh.n || sub.n) {
        return bad(`Can't remove "${car_type}" — ${veh.n} vehicle(s) and ${sub.n} active membership(s) use it`);
      }
      await saveCarTypes(env, list.filter(ct => ct !== car_type));
      await env.DB.batch([
        env.DB.prepare('DELETE FROM wash_pricing WHERE car_type = ?').bind(car_type),
        env.DB.prepare('DELETE FROM monthly_pricing WHERE car_type = ?').bind(car_type),
        env.DB.prepare('DELETE FROM addon_pricing WHERE car_type = ?').bind(car_type),
      ]);
      return ok();
    }

    // ── Rows: add-on services ──
    if (type === 'add_addon') {
      const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > 60) return bad('Enter an add-on name (up to 60 characters)');
      if (!SAFE_NAME.test(name)) return bad('Use letters, numbers, spaces and . / & ( ) + - only');
      const dup = await env.DB.prepare('SELECT id FROM addon_services WHERE lower(name) = lower(?) AND is_active = 1').bind(name).first();
      if (dup) return bad(`"${name}" already exists`);
      const { meta } = await env.DB.prepare('INSERT INTO addon_services (name, base_price) VALUES (?, 0)').bind(name).run();
      // Give it its own editable checklist (shows under Checkpoint Templates)
      await env.DB.prepare('INSERT OR IGNORE INTO checkpoint_templates (service_key, steps) VALUES (?, ?)')
        .bind(`addon_${meta.last_row_id}`, JSON.stringify(DEFAULT_ADDON_STEPS)).run();
      return ok({ addon_id: meta.last_row_id });
    }

    if (type === 'remove_addon') {
      // Soft-delete so past jobs that used it keep their history
      await env.DB.prepare('UPDATE addon_services SET is_active = 0 WHERE id = ?').bind(Number(body.addon_id)).run();
      return ok();
    }

    // ── Cells ──
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
