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

// Strip financial fields for worker responses
function stripFinancials(job) {
  const { price, amount_paid, payment_mode, ...safe } = job;
  return safe;
}

function buildCheckpoints(templates, washType, addons, pickupDrop) {
  const checkpoints = [];
  const washKey = washType; // top | normal | foam
  const washTpl = templates.find(t => t.service_key === washKey);
  if (washTpl) {
    checkpoints.push({
      service_key: washKey,
      label: washKey === 'top' ? 'Top Wash' : washKey === 'normal' ? 'Normal Wash' : 'Foam Wash',
      steps: JSON.parse(washTpl.steps).map(label => ({ label, done: false, done_at: null })),
    });
  }
  for (const addon of addons) {
    const key = addon.name.toLowerCase().includes('interior') ? 'interior' : 'rubbing';
    const tpl = templates.find(t => t.service_key === key);
    if (tpl) {
      checkpoints.push({
        service_key: key,
        label: addon.name,
        steps: JSON.parse(tpl.steps).map(label => ({ label, done: false, done_at: null })),
      });
    }
  }
  if (pickupDrop) {
    const tpl = templates.find(t => t.service_key === 'pickup_drop');
    if (tpl) {
      checkpoints.push({
        service_key: 'pickup_drop',
        label: 'Pickup & Drop',
        steps: JSON.parse(tpl.steps).map(label => ({ label, done: false, done_at: null })),
      });
    }
  }
  return checkpoints;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userRole = role(request, env);
  if (!userRole) return new Response('Unauthorized', { status: 401, headers: CORS });

  const url = new URL(request.url);

  if (request.method === 'GET') {
    let query = 'SELECT j.*, c.name as customer_name, c.phone as customer_phone, v.reg_number, v.make_model, v.color FROM jobs j JOIN customers c ON j.customer_id = c.id JOIN vehicles v ON j.vehicle_id = v.id';
    const conditions = [];
    const params = [];

    const date = url.searchParams.get('date');
    const status = url.searchParams.get('status');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    if (date) { conditions.push("date(j.created_at) = date(?)"); params.push(date); }
    if (status) { conditions.push("j.status = ?"); params.push(status); }
    if (from) { conditions.push("date(j.created_at) >= date(?)"); params.push(from); }
    if (to) { conditions.push("date(j.created_at) <= date(?)"); params.push(to); }

    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY j.created_at DESC';

    const stmt = env.DB.prepare(query);
    const { results } = params.length ? await stmt.bind(...params).all() : await stmt.all();

    const jobs = userRole === 'worker' ? results.map(stripFinancials) : results;
    return new Response(JSON.stringify(jobs), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const {
      phone, name,
      reg_number, make_model, color, car_type,
      wash_type, is_monthly, frequency,
      addons = [], pickup_drop = false, pickup_address = '',
      notes = '', assigned_worker = '',
      addon_prices = {},
    } = body;

    if (!phone || !name || !reg_number || !car_type) {
      return new Response('Missing required fields', { status: 400, headers: CORS });
    }

    // Upsert customer
    let customer = await env.DB.prepare('SELECT * FROM customers WHERE phone = ?').bind(phone.trim()).first();
    if (!customer) {
      const { meta } = await env.DB.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').bind(name.trim(), phone.trim()).run();
      customer = { id: meta.last_row_id, name: name.trim(), phone: phone.trim() };
    }

    // Upsert vehicle (by reg_number for this customer)
    let vehicle = await env.DB.prepare('SELECT * FROM vehicles WHERE customer_id = ? AND reg_number = ?').bind(customer.id, reg_number.trim().toUpperCase()).first();
    if (!vehicle) {
      const { meta } = await env.DB.prepare(
        'INSERT INTO vehicles (customer_id, reg_number, make_model, color, car_type) VALUES (?, ?, ?, ?, ?)'
      ).bind(customer.id, reg_number.trim().toUpperCase(), make_model || '', color || '', car_type).run();
      vehicle = { id: meta.last_row_id };
    }

    // Resolve price
    let price = 0;
    let sub_id = null;
    let payment_mode = body.payment_mode || 'cash';

    if (payment_mode === 'sub') {
      // Find active subscription and decrement
      const sub = await env.DB.prepare(
        'SELECT * FROM subscriptions WHERE customer_id = ? AND is_active = 1 AND date(end_date) >= date(\'now\') AND washes_used < washes_total LIMIT 1'
      ).bind(customer.id).first();
      if (!sub) return new Response('No active subscription with washes remaining', { status: 400, headers: CORS });
      sub_id = sub.id;
      price = 0; // subscription covers base wash
      await env.DB.prepare('UPDATE subscriptions SET washes_used = washes_used + 1 WHERE id = ?').bind(sub.id).run();
    } else if (is_monthly) {
      const row = await env.DB.prepare('SELECT price FROM monthly_pricing WHERE car_type = ? AND frequency = ? AND wash_type = ?')
        .bind(car_type, Number(frequency), wash_type).first();
      price = row ? row.price : 0;
    } else {
      const row = await env.DB.prepare('SELECT price FROM wash_pricing WHERE car_type = ? AND wash_type = ?')
        .bind(car_type, wash_type).first();
      price = row ? row.price : 0;
    }

    // Add addon prices
    const addonDetails = [];
    for (const addon of addons) {
      const ap = addon_prices[addon.id] || addon.base_price;
      price += Number(ap);
      addonDetails.push({ id: addon.id, name: addon.name, price: Number(ap) });
    }
    if (pickup_drop) price += 0; // pickup/drop is flagged but price added separately if needed

    // Build services summary
    const washLabel = wash_type === 'top' ? 'Top Wash' : wash_type === 'normal' ? 'Normal Wash' : 'Foam Wash';
    let summary = is_monthly ? `Monthly (${frequency}×/mo) ${washLabel}` : washLabel;
    if (addonDetails.length) summary += ' + ' + addonDetails.map(a => a.name).join(' + ');
    if (pickup_drop) summary += ' + Pickup & Drop';

    // Snapshot checkpoints from templates
    const { results: templates } = await env.DB.prepare('SELECT * FROM checkpoint_templates').all();
    const checkpoints = buildCheckpoints(templates, wash_type, addonDetails, pickup_drop);

    const { meta } = await env.DB.prepare(`
      INSERT INTO jobs (customer_id, vehicle_id, car_type, wash_type, addons, is_monthly, pickup_drop, pickup_address,
        services_summary, price, payment_mode, assigned_worker, notes, subscription_id, checkpoints, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')
    `).bind(
      customer.id, vehicle.id, car_type, wash_type || '',
      JSON.stringify(addonDetails), is_monthly ? 1 : 0,
      pickup_drop ? 1 : 0, pickup_address,
      summary, price, payment_mode,
      assigned_worker, notes,
      sub_id,
      JSON.stringify(checkpoints),
    ).run();

    return new Response(JSON.stringify({ id: meta.last_row_id, customer_id: customer.id }), {
      status: 201,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
