// WhatsApp click-to-send helper
// Replace this module's send() with a Meta Cloud API call when ready

let _settings = null;

export async function loadSettings() {
  if (_settings) return _settings;
  try {
    const r = await fetch('/api/settings', { headers: getAuthHeaders() });
    if (r.ok) _settings = await r.json();
  } catch {}
  return _settings || {};
}

export function getAuthHeaders() {
  // Populated by worker.js or admin.js before use
  return window.__authHeaders || {};
}

export function setAuthHeaders(headers) {
  window.__authHeaders = headers;
}

export function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

export async function sendStatus(job, statusKey) {
  const settings = await loadSettings();
  const tplKey = `tpl_${statusKey}`;
  const tpl = settings[tplKey] || '';
  if (!tpl) { alert('No WhatsApp template set for this status.'); return; }

  const carLabel = [job.make_model, job.color].filter(Boolean).join(' ') || job.car_type;
  const phone = (job.customer_phone || '').replace(/\D/g, '');
  const countryPhone = phone.startsWith('91') ? phone : `91${phone}`;
  const statusUrl = `${location.origin}/status?phone=${encodeURIComponent(job.customer_phone || '')}`;

  const vars = {
    name: job.customer_name || '',
    car: carLabel,
    reg: job.reg_number || '',
    amount: job.price ? `₹${job.price.toLocaleString('en-IN')}` : '',
    status_url: statusUrl,
  };

  const message = fillTemplate(tpl, vars);
  openWa(countryPhone, message);
}

// Generic membership WhatsApp message from a settings template.
// Vars available: {name} {plan} {reg} {expiry} {price} + any extras passed in.
export async function sendMemberMessage(sub, tplKey, extraVars = {}) {
  const settings = await loadSettings();
  const tpl = settings[tplKey] || '';
  if (!tpl) { alert(`No WhatsApp template set (${tplKey}). Add it in Manage → WhatsApp Templates.`); return; }

  const phone = (sub.customer_phone || '').replace(/\D/g, '');
  const countryPhone = phone.startsWith('91') ? phone : `91${phone}`;

  const vars = {
    name: sub.customer_name || '',
    plan: sub.plan_label || '',
    reg: sub.reg_number || '',
    expiry: sub.end_date || '',
    price: sub.price ? `₹${sub.price.toLocaleString('en-IN')}` : '',
    ...extraVars,
  };

  openWa(countryPhone, fillTemplate(tpl, vars));
}

export function sendExpiryNudge(sub) { return sendMemberMessage(sub, 'tpl_expiring'); }

// Copy the filled template to the clipboard instead of opening WhatsApp —
// workaround for desktop apps that mangle emoji in wa.me links.
export async function copyMemberMessage(sub, tplKey, extraVars = {}) {
  const settings = await loadSettings();
  const tpl = settings[tplKey] || '';
  if (!tpl) { alert(`No WhatsApp template set (${tplKey}). Add it in Manage → WhatsApp Templates.`); return false; }
  const vars = {
    name: sub.customer_name || '',
    plan: sub.plan_label || '',
    reg: sub.reg_number || '',
    expiry: sub.end_date || '',
    price: sub.price ? `₹${sub.price.toLocaleString('en-IN')}` : '',
    ...extraVars,
  };
  await navigator.clipboard.writeText(fillTemplate(tpl, vars));
  return true;
}

// Open as a proper anchor click to avoid popup blockers.
// On desktop we compose inside WhatsApp Web (web.whatsapp.com) instead of
// wa.me — wa.me hands off to the desktop app via the whatsapp:// protocol,
// which on some Windows versions decodes the text as ANSI and turns emoji
// and line breaks into "?".
function openWa(countryPhone, message) {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const text = encodeURIComponent(message);
  const url = isMobile
    ? `https://wa.me/${countryPhone}?text=${text}`
    : `https://web.whatsapp.com/send?phone=${countryPhone}&text=${text}`;
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}
