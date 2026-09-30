import { getCarTypes } from '../../_lib/car-types.js';

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

    // Admin edit: everything on the membership row — member, vehicle, and plan
    if (body.details) {
      if (userRole !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });
      const sub = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first();
      if (!sub) return new Response('Not found', { status: 404, headers: CORS });
      const d = body.details;
      const bad = msg => new Response(msg, { status: 400, headers: CORS });

      // Validate everything before writing anything, so a rejected edit
      // never leaves the record half-updated
      const name = d.name !== undefined ? String(d.name).trim() : undefined;
      const phone = d.phone !== undefined ? String(d.phone).replace(/\D/g, '') : undefined;
      if (name !== undefined && !name) return bad('Name cannot be empty');
      if (phone !== undefined) {
        if (phone.length < 10) return bad('Enter a valid phone number');
        const clash = await env.DB.prepare('SELECT id FROM customers WHERE phone = ? AND id != ?').bind(phone, sub.customer_id).first();
        if (clash) return bad(`Phone ${phone} already belongs to another customer`);
      }
      const reg = d.reg_number !== undefined ? String(d.reg_number).trim().toUpperCase() : undefined;
      if (reg !== undefined) {
        if (!sub.vehicle_id) return bad('This legacy membership has no vehicle to edit');
        if (!reg) return bad('Reg number cannot be empty');
        const clash = await env.DB.prepare('SELECT id FROM vehicles WHERE reg_number = ? AND id != ?').bind(reg, sub.vehicle_id).first();
        if (clash) return bad(`Vehicle ${reg} is already registered`);
      }
      if (d.car_type !== undefined && !(await getCarTypes(env)).includes(d.car_type)) return bad('Invalid car type');
      const freq = d.frequency !== undefined ? Number(d.frequency) : sub.frequency;
      if (![1, 2, 4].includes(freq)) return bad('Invalid membership type');
      const used = d.washes_used !== undefined ? Number(d.washes_used) : undefined;
      if (used !== undefined && (!Number.isInteger(used) || used < 0 || used > freq)) {
        return bad(`Washes used must be between 0 and ${freq}`);
      }
      const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (d.price !== undefined && (!Number.isFinite(Number(d.price)) || Number(d.price) < 0)) return bad('Invalid price');
      if (d.end_date !== undefined && !isDate(d.end_date)) return bad('Invalid expiry date');
      if (d.start_date && !isDate(d.start_date)) return bad('Invalid start date');
      if (d.paid_at && !isDate(d.paid_at)) return bad('Invalid paid date');
      const startDate = d.start_date || sub.start_date;
      const endDate = d.end_date ?? sub.end_date;
      if (endDate < startDate.slice(0, 10)) return bad('Expiry date cannot be before the start date');

      // Member (customer row)
      await env.DB.prepare(`UPDATE customers SET
          name = COALESCE(?, name), phone = COALESCE(?, phone),
          building_name = ?, flat_number = ?
        WHERE id = ?`)
        .bind(name ?? null, phone ?? null, d.building_name ?? '', d.flat_number ?? '', sub.customer_id).run();

      // Vehicle row
      if (sub.vehicle_id) {
        await env.DB.prepare(`UPDATE vehicles SET
            reg_number = COALESCE(?, reg_number), make_model = COALESCE(?, make_model),
            color = COALESCE(?, color), car_type = COALESCE(?, car_type), parking_number = ?
          WHERE id = ?`)
          .bind(reg ?? null, d.make_model ?? null, d.color ?? null, d.car_type ?? null,
                d.parking_number ?? '', sub.vehicle_id).run();
      }

      const sets = [], params = [];
      const carType = d.car_type ?? sub.car_type;
      if (d.frequency !== undefined || d.car_type !== undefined) {
        const TIER_NAMES = { 1: 'Essential Care', 2: 'Signature Care', 4: 'Elite Care' };
        sets.push('frequency = ?', 'washes_total = ?', 'car_type = ?', 'plan_label = ?');
        params.push(freq, freq, carType, `${TIER_NAMES[freq]} — ${freq}× wash/month — ${carType}`);
      }
      if (used !== undefined) { sets.push('washes_used = ?'); params.push(used); }
      if (d.price !== undefined) { sets.push('price = ?'); params.push(Number(d.price)); }
      if (d.end_date !== undefined) {
        sets.push('end_date = ?'); params.push(d.end_date);
        // Keep active status in sync with the expiry: a future date revives an
        // expired membership, a past date expires an active one.
        sets.push('is_active = ?');
        params.push(d.end_date >= new Date().toISOString().split('T')[0] ? 1 : 0);
      }
      if (d.start_date !== undefined) { sets.push('start_date = ?'); params.push(startDate); }
      if (d.paid_at !== undefined) {
        // A paid date implies paid; clearing it marks the membership unpaid
        if (d.paid_at) {
          sets.push('paid_at = ?', 'is_paid = 1'); params.push(d.paid_at);
        } else {
          sets.push('paid_at = NULL', 'is_paid = 0');
        }
      }
      if (sets.length) {
        await env.DB.prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
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
