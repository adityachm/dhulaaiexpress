const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, X-Worker-Pin',
};

function role(request, env) {
  if (request.headers.get('X-Admin-Secret') === env.ADMIN_SECRET) return 'admin';
  if (request.headers.get('X-Worker-Pin') === env.WORKER_PIN) return 'worker';
  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
  if (!role(request, env)) return new Response('Unauthorized', { status: 401, headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const body = await request.json().catch(() => ({}));

  // ── Send OTP — generate code, return wa.me link for manual send ───────
  if (action === 'send') {
    const { phone } = body;
    if (!phone) return json({ error: 'Phone required' }, 400);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Clean up rows expired more than 24 hours ago (fire-and-forget)
    env.DB.prepare("DELETE FROM otps WHERE datetime(expires_at) < datetime('now', '-24 hours')").run().catch(() => {});

    await env.DB.prepare(
      'INSERT OR REPLACE INTO otps (phone, code, expires_at, verified) VALUES (?, ?, ?, 0)'
    ).bind(phone.trim(), code, expiresAt).run();

    const digits = phone.replace(/\D/g, '');
    const e164 = digits.startsWith('91') ? digits : `91${digits}`;
    const message = `${code} is your OTP for Dhulaai Express vehicle check-in. Please share this code with our staff. Valid for 5 minutes.`;
    const waUrl = `https://wa.me/${e164}?text=${encodeURIComponent(message)}`;

    return json({ code, waUrl });
  }

  // ── Verify OTP ────────────────────────────────────────────────────────
  if (action === 'verify') {
    const { phone, code } = body;
    if (!phone || !code) return json({ valid: false, error: 'Phone and code required' }, 400);

    const row = await env.DB.prepare(
      `SELECT * FROM otps WHERE phone = ? AND code = ? AND verified = 0
       AND datetime(expires_at) > datetime('now')`
    ).bind(phone.trim(), code.trim()).first();

    if (row) {
      await env.DB.prepare('UPDATE otps SET verified = 1 WHERE phone = ?').bind(phone.trim()).run();
      // Permanently mark the customer's phone as verified so they skip OTP on future visits
      await env.DB.prepare('UPDATE customers SET phone_verified = 1 WHERE phone = ?').bind(phone.trim()).run();
      return json({ valid: true });
    }
    return json({ valid: false, error: 'Invalid or expired OTP' });
  }

  return json({ error: 'Unknown action — use ?action=send or ?action=verify' }, 400);
}
