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
  const url = `https://wa.me/${countryPhone}?text=${encodeURIComponent(message)}`;

  // Open as a proper anchor click to avoid popup blockers
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}
