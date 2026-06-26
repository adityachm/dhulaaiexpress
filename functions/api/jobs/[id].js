const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, X-Worker-Pin',
};

const STATUS_ORDER = ['received', 'in_progress', 'ready', 'delivered'];

function role(request, env) {
  if (request.headers.get('X-Admin-Secret') === env.ADMIN_SECRET) return 'admin';
  if (request.headers.get('X-Worker-Pin') === env.WORKER_PIN) return 'worker';
  return null;
}

function stripFinancials(job) {
  const { price, amount_paid, payment_mode, ...safe } = job;
  return safe;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userRole = role(request, env);
  if (!userRole) return new Response('Unauthorized', { status: 401, headers: CORS });

  const id = params.id;

  if (request.method === 'GET') {
    const job = await env.DB.prepare(
      'SELECT j.*, c.name as customer_name, c.phone as customer_phone, v.reg_number, v.make_model, v.color FROM jobs j JOIN customers c ON j.customer_id = c.id JOIN vehicles v ON j.vehicle_id = v.id WHERE j.id = ?'
    ).bind(id).first();
    if (!job) return new Response('Not found', { status: 404, headers: CORS });
    return new Response(JSON.stringify(userRole === 'worker' ? stripFinancials(job) : job), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (request.method === 'PATCH') {
    const body = await request.json();
    const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
    if (!job) return new Response('Not found', { status: 404, headers: CORS });

    // Tick/untick a checkpoint step
    if (body.checkpoint !== undefined) {
      const { service_idx, step_idx, done } = body.checkpoint;
      const checkpoints = JSON.parse(job.checkpoints || '[]');
      if (checkpoints[service_idx] && checkpoints[service_idx].steps[step_idx] !== undefined) {
        checkpoints[service_idx].steps[step_idx].done = done;
        checkpoints[service_idx].steps[step_idx].done_at = done ? new Date().toISOString() : null;
      }
      await env.DB.prepare('UPDATE jobs SET checkpoints = ? WHERE id = ?')
        .bind(JSON.stringify(checkpoints), id).run();
      return new Response(JSON.stringify({ ok: true, checkpoints }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Status change
    if (body.status) {
      const newStatus = body.status;
      if (!STATUS_ORDER.includes(newStatus)) return new Response('Invalid status', { status: 400, headers: CORS });

      // Block moving to 'ready' if primary checklist incomplete
      if (newStatus === 'ready') {
        const checkpoints = JSON.parse(job.checkpoints || '[]');
        const primaryService = checkpoints.find(c => ['top', 'normal', 'foam'].includes(c.service_key));
        if (primaryService) {
          const allDone = primaryService.steps.every(s => s.done);
          if (!allDone) {
            return new Response(JSON.stringify({ error: 'Complete all wash steps before marking ready' }), {
              status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
            });
          }
        }
      }

      const stamps = {};
      if (newStatus === 'in_progress' && !job.started_at) stamps.started_at = new Date().toISOString();
      if (newStatus === 'ready' && !job.ready_at) stamps.ready_at = new Date().toISOString();
      if (newStatus === 'delivered' && !job.delivered_at) stamps.delivered_at = new Date().toISOString();

      let setClause = 'status = ?';
      const bindValues = [newStatus];
      if (stamps.started_at) { setClause += ', started_at = ?'; bindValues.push(stamps.started_at); }
      if (stamps.ready_at) { setClause += ', ready_at = ?'; bindValues.push(stamps.ready_at); }
      if (stamps.delivered_at) { setClause += ', delivered_at = ?'; bindValues.push(stamps.delivered_at); }
      bindValues.push(id);

      await env.DB.prepare(`UPDATE jobs SET ${setClause} WHERE id = ?`).bind(...bindValues).run();
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Price / payment update (admin only)
    if (body.price !== undefined || body.amount_paid !== undefined || body.payment_mode) {
      if (userRole !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });
      const sets = [];
      const vals = [];
      if (body.price !== undefined) { sets.push('price = ?'); vals.push(Number(body.price)); }
      if (body.amount_paid !== undefined) { sets.push('amount_paid = ?'); vals.push(Number(body.amount_paid)); }
      if (body.payment_mode) { sets.push('payment_mode = ?'); vals.push(body.payment_mode); }
      vals.push(id);
      await env.DB.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response('Nothing to update', { status: 400, headers: CORS });
  }

  if (request.method === 'DELETE') {
    if (userRole !== 'admin') return new Response('Unauthorized', { status: 401, headers: CORS });
    await env.DB.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
