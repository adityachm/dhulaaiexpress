import { sendStatus, setAuthHeaders, loadSettings } from './whatsapp.js';

// ── State ──────────────────────────────────────────────────────────────
let PIN = '';
let pricing = null;
let activeSub = null;
let boardJobs = [];

// ── Auth helpers ───────────────────────────────────────────────────────
function api(path, opts = {}) {
  return fetch(path, { ...opts, headers: { 'X-Worker-Pin': PIN, ...(opts.headers || {}) } });
}

// ── Session helpers ────────────────────────────────────────────────────
const SESSION_KEY = 'dhulaai_worker_session';
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 hours

function saveSession(pin) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ pin, expiresAt: Date.now() + SESSION_TTL }));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.pin && s.expiresAt > Date.now()) return s.pin;
  } catch {}
  return null;
}

// ── Boot ───────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pin = document.getElementById('login-pin').value.trim();
  const err = document.getElementById('login-err');
  err.textContent = '';
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Checking…';

  const r = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: pin }),
  });
  const { role } = await r.json().catch(() => ({}));
  if (role === 'worker' || role === 'admin') {
    PIN = pin;
    saveSession(pin);
    enterDashboard();
  } else {
    err.textContent = 'Wrong PIN. Try again.';
    btn.disabled = false; btn.textContent = 'Enter';
  }
});

async function enterDashboard() {
  setAuthHeaders({ 'X-Worker-Pin': PIN });
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  await init();
}

async function init() {
  await Promise.all([loadPricing(), loadBoard(), loadSettings()]);
  // Auto-refresh board every 60 seconds
  setInterval(() => {
    const activeTab = document.querySelector('.nav-tabs button.active')?.dataset?.tab;
    if (activeTab === 'board') loadBoard();
  }, 60000);
}

function logout() {
  clearSession();
  PIN = '';
  location.reload();
}

// Auto-restore session on load
(async () => {
  const saved = restoreSession();
  if (saved) {
    PIN = saved;
    await enterDashboard();
  }
})();

// ── Tab switching ──────────────────────────────────────────────────────
window.switchTab = function(tab, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  btn.classList.add('active');
  if (tab === 'board') loadBoard();
};

// ── Pricing ────────────────────────────────────────────────────────────
async function loadPricing() {
  const r = await api('/api/pricing');
  if (!r.ok) return;
  pricing = await r.json();

  // Populate car type select
  const sel = document.getElementById('f-car-type');
  pricing.car_types.forEach(ct => {
    const o = document.createElement('option');
    o.value = ct; o.textContent = ct;
    sel.appendChild(o);
  });
  sel.addEventListener('change', updatePrice);

  // Populate add-ons (price auto-fills from car type selection)
  const list = document.getElementById('addons-list');
  list.innerHTML = '';
  pricing.addons.forEach(addon => {
    const row = document.createElement('div');
    row.className = 'addon-row';
    row.innerHTML = `
      <input type="checkbox" id="addon-${addon.id}" value="${addon.id}" onchange="updatePrice()">
      <label class="addon-name" for="addon-${addon.id}">${addon.name}</label>
      <span id="addon-price-label-${addon.id}" style="color:var(--gold);font-size:13px;font-weight:600;margin-left:auto;">—</span>
    `;
    list.appendChild(row);
  });

  updatePrice();
}

// ── Price calculation ──────────────────────────────────────────────────
window.updatePrice = function() {
  if (!pricing) return;
  const carType = document.getElementById('f-car-type').value;
  const mode = document.querySelector('input[name="svc-mode"]:checked')?.value || 'onetime';
  let total = 0;

  if (mode === 'onetime' && carType) {
    const wt = document.getElementById('f-wash-type').value;
    total = pricing.wash[carType]?.[wt] || 0;
  } else if (mode === 'monthly' && carType) {
    const freq = document.getElementById('f-frequency').value;
    const wt = document.getElementById('f-monthly-wash').value;
    total = pricing.monthly[carType]?.[Number(freq)]?.[wt] || 0;
  } else if (mode === 'sub') {
    total = 0; // covered by subscription
  }

  // Add-ons — price from car-type matrix
  pricing.addons.forEach(addon => {
    const addonPrice = (pricing.addon_pricing?.[addon.id]?.[carType]) ?? addon.base_price;
    const label = document.getElementById(`addon-price-label-${addon.id}`);
    if (label) label.textContent = carType ? `₹${addonPrice.toLocaleString('en-IN')}` : '—';
    const cb = document.getElementById(`addon-${addon.id}`);
    if (cb && cb.checked) total += addonPrice;
  });

  document.getElementById('price-display').textContent = `₹${total.toLocaleString('en-IN')}`;
};

window.onServiceModeChange = function() {
  const mode = document.querySelector('input[name="svc-mode"]:checked')?.value;
  document.getElementById('onetime-block').classList.toggle('hidden', mode !== 'onetime');
  document.getElementById('monthly-block').classList.toggle('hidden', mode !== 'monthly');
  // Payment mode
  const paySelect = document.getElementById('f-payment');
  if (mode === 'sub') {
    paySelect.value = 'sub'; paySelect.disabled = true;
  } else {
    paySelect.disabled = false;
    if (paySelect.value === 'sub') paySelect.value = 'cash';
  }
  updatePrice();
};

window.togglePickup = function() {
  document.getElementById('pickup-block').classList.toggle('hidden', !document.getElementById('f-pickup').checked);
};

// ── Phone autofill ─────────────────────────────────────────────────────
document.getElementById('f-phone').addEventListener('blur', async function() {
  const phone = this.value.trim();
  if (phone.length < 10) return;
  const r = await api(`/api/customers?phone=${encodeURIComponent(phone)}`);
  if (!r.ok) return;
  const data = await r.json();
  if (!data) { activeSub = null; hideSub(); return; }

  document.getElementById('f-name').value = data.customer.name;

  // Show all vehicles as selectable pills; auto-select if only one
  if (data.vehicles && data.vehicles.length) {
    if (data.vehicles.length === 1) {
      fillVehicle(data.vehicles[0]);
    } else {
      renderVehiclePills(data.vehicles);
    }
  }

  // Show subscription status
  activeSub = data.active_subscription;
  if (activeSub) {
    const remaining = activeSub.washes_total - activeSub.washes_used;
    document.getElementById('sub-info').textContent =
      `${activeSub.plan_label} — ${remaining} wash${remaining !== 1 ? 'es' : ''} left (expires ${activeSub.end_date})`;
    document.getElementById('sub-banner').classList.remove('hidden');
  } else {
    hideSub();
  }
});

function hideSub() {
  document.getElementById('sub-banner').classList.add('hidden');
}

function fillVehicle(v) {
  document.getElementById('f-reg').value   = v.reg_number;
  document.getElementById('f-model').value = v.make_model;
  document.getElementById('f-color').value = v.color;
  document.getElementById('f-car-type').value = v.car_type;
  clearVehiclePills();
  updatePrice();
}

function renderVehiclePills(vehicles) {
  let el = document.getElementById('vehicle-pills');
  if (!el) {
    el = document.createElement('div');
    el.id = 'vehicle-pills';
    el.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;';
    document.getElementById('f-reg').closest('.form-row').before(el);
  }
  el.innerHTML = `<div style="font-size:12px;color:var(--text2);width:100%;margin-bottom:4px;">Select vehicle:</div>` +
    vehicles.map((v, i) => `
      <button type="button" onclick="selectVehiclePill(${i})"
        style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer;text-align:left;">
        <div style="font-weight:600;">${v.reg_number}</div>
        <div style="font-size:11px;color:var(--text2);">${[v.make_model, v.color].filter(Boolean).join(' ') || v.car_type}</div>
      </button>
    `).join('');
  el._vehicles = vehicles;
}

function clearVehiclePills() {
  const el = document.getElementById('vehicle-pills');
  if (el) el.remove();
}

window.selectVehiclePill = function(idx) {
  const el = document.getElementById('vehicle-pills');
  if (el) fillVehicle(el._vehicles[idx]);
};

// ── Reg number lookup — fills car details if vehicle already in system ─
document.getElementById('f-reg').addEventListener('blur', async function() {
  const reg = this.value.trim().toUpperCase();
  if (!reg || reg.length < 4) return;
  // Don't overwrite if already filled by vehicle pill selection
  if (document.getElementById('f-model').value) return;
  const r = await api(`/api/customers?reg=${encodeURIComponent(reg)}`);
  if (!r.ok) return;
  const vehicle = await r.json();
  if (vehicle) {
    document.getElementById('f-model').value = vehicle.make_model || '';
    document.getElementById('f-color').value  = vehicle.color || '';
    document.getElementById('f-car-type').value = vehicle.car_type || '';
    updatePrice();
    // Show a subtle note if different owner
    if (vehicle.owner_name && !document.getElementById('f-name').value) {
      document.getElementById('f-name').value = vehicle.owner_name;
    }
  }
});

// Autofill clears vehicle pills when phone changes
document.getElementById('f-phone').addEventListener('input', function() {
  clearVehiclePills();
});

// ── Form submit ────────────────────────────────────────────────────────
document.getElementById('car-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('form-err');
  err.textContent = '';

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Creating…';

  const mode = document.querySelector('input[name="svc-mode"]:checked')?.value || 'onetime';
  const carType = document.getElementById('f-car-type').value;
  // Monthly packages have one flat price (always stored as 'foam' in DB)
  const washType = mode === 'monthly' ? 'foam' : document.getElementById('f-wash-type').value;

  // Collect add-ons
  const addons = [];
  const addon_prices = {};
  if (pricing) {
    pricing.addons.forEach(addon => {
      const cb = document.getElementById(`addon-${addon.id}`);
      if (cb && cb.checked) {
        const p = (pricing.addon_pricing?.[addon.id]?.[carType]) ?? addon.base_price;
        addons.push({ id: addon.id, name: addon.name, base_price: p });
        addon_prices[addon.id] = p;
      }
    });
  }

  const body = {
    phone: document.getElementById('f-phone').value.trim(),
    name: document.getElementById('f-name').value.trim(),
    reg_number: document.getElementById('f-reg').value.trim(),
    make_model: document.getElementById('f-model').value.trim(),
    color: document.getElementById('f-color').value.trim(),
    car_type: carType,
    wash_type: washType,
    is_monthly: mode === 'monthly',
    frequency: mode === 'monthly' ? Number(document.getElementById('f-frequency').value) : null,
    payment_mode: mode === 'sub' ? 'sub' : document.getElementById('f-payment').value,
    pickup_drop: document.getElementById('f-pickup').checked,
    pickup_address: document.getElementById('f-address')?.value.trim() || '',
    notes: document.getElementById('f-notes').value.trim(),
    addons,
    addon_prices,
  };

  if (!body.phone || !body.name || !body.reg_number || !body.car_type) {
    err.textContent = 'Phone, name, reg number and car type are required.';
    btn.disabled = false; btn.textContent = 'Create Job'; return;
  }

  // Build WhatsApp status link BEFORE the fetch so it opens in the same user gesture
  // (window.open after await is blocked by browsers)
  const digits = body.phone.replace(/\D/g, '');
  const e164 = digits.startsWith('91') ? digits : `91${digits}`;
  const statusUrl = `${location.origin}/status?phone=${encodeURIComponent(body.phone)}`;
  const vehicleDesc = [body.make_model, body.color].filter(Boolean).join(' ') || body.car_type;
  const firstName = body.name.split(' ')[0];
  const statusMsg = `Hi ${firstName}! Your ${vehicleDesc} (${body.reg_number.toUpperCase()}) has been checked in at Dhulaai Express 🚗\n\nTrack your car's wash status live here:\n${statusUrl}\n\nThank you for choosing us! 😊`;
  const waWindow = window.open(`https://wa.me/${e164}?text=${encodeURIComponent(statusMsg)}`, '_blank', 'noopener');

  const r = await api('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (r.ok) {
    e.target.reset();
    clearVehiclePills();
    hideSub(); activeSub = null;
    document.getElementById('price-display').textContent = '₹0';
    switchTab('board', document.querySelector('[data-tab="board"]'));
  } else {
    if (waWindow) waWindow.close(); // close WhatsApp tab if job creation failed
    const msg = await r.text();
    err.textContent = msg || 'Failed to create job. Please try again.';
  }

  btn.disabled = false; btn.textContent = 'Create Job';
});

// ── Job Board ──────────────────────────────────────────────────────────
window.loadBoard = async function() {
  const today = new Date().toISOString().split('T')[0];
  const r = await api(`/api/jobs?date=${today}`);
  if (!r.ok) return;
  boardJobs = await r.json();
  renderBoard();
};

function renderBoard() {
  const cols = { received: [], in_progress: [], ready: [], delivered: [] };
  boardJobs.forEach(j => { if (cols[j.status]) cols[j.status].push(j); });

  Object.entries(cols).forEach(([status, jobs]) => {
    const col = document.getElementById(`col-${status}`);
    if (!col) return;
    if (!jobs.length) { col.innerHTML = '<div class="empty-state text-sm">No cars</div>'; return; }
    col.innerHTML = jobs.map(j => status === 'delivered' ? renderDeliveredCard(j) : renderJobCard(j)).join('');
  });
}

function renderDeliveredCard(job) {
  return `
    <div class="job-card status-delivered" id="job-${job.id}" style="padding:12px 14px;">
      <div class="jc-reg" style="font-size:15px;">${job.reg_number}</div>
      <div class="jc-owner" style="font-size:12px;">${job.customer_name} · ${job.customer_phone}</div>
      <div class="jc-svc" style="font-size:12px;color:var(--text2);">${job.services_summary}</div>
    </div>
  `;
}

function renderJobCard(job) {
  const checkpoints = JSON.parse(job.checkpoints || '[]');
  const primaryCp = checkpoints.find(c => ['top', 'normal', 'foam'].includes(c.service_key));
  const totalSteps = checkpoints.reduce((s, c) => s + c.steps.length, 0);
  const doneSteps = checkpoints.reduce((s, c) => s + c.steps.filter(st => st.done).length, 0);

  const checkpointsHtml = checkpoints.map((cp, ci) => `
    <div class="checkpoint-section">
      <div class="checkpoint-service">
        ${cp.label}
        <span class="checkpoint-progress">${cp.steps.filter(s=>s.done).length}/${cp.steps.length}</span>
      </div>
      ${cp.steps.map((step, si) => `
        <div class="checkpoint-item ${step.done ? 'done' : ''}" onclick="toggleStep(${job.id},${ci},${si},${!step.done})">
          <input type="checkbox" ${step.done ? 'checked' : ''} onclick="event.stopPropagation();toggleStep(${job.id},${ci},${si},${!step.done})">
          <span>${step.label}</span>
        </div>
      `).join('')}
    </div>
  `).join('');

  const canMarkReady = primaryCp ? primaryCp.steps.every(s => s.done) : true;
  const timeAgo = formatTime(job.created_at);

  const actionsByStatus = {
    received: `
      <button class="btn btn-primary btn-sm" onclick="changeStatus(${job.id},'in_progress')">▶ Start</button>
    `,
    in_progress: `
      <button class="btn btn-gold btn-sm ${canMarkReady ? '' : 'disabled'}" onclick="changeStatus(${job.id},'ready')" ${canMarkReady ? '' : 'disabled title="Complete checklist first"'}>✓ Mark Ready</button>
    `,
    ready: `
      <button class="btn btn-green btn-sm" onclick="changeStatus(${job.id},'delivered')">🏁 Delivered</button>
      <button class="btn btn-wa btn-sm" onclick="sendWA(${job.id},'ready')">📱 Ready</button>
    `,
    delivered: `<button class="btn btn-wa btn-sm" onclick="sendWA(${job.id},'delivered')">📱 Delivered</button>`,
  };

  return `
    <div class="job-card status-${job.status}" id="job-${job.id}">
      <div class="jc-reg">${job.reg_number}</div>
      <div class="jc-owner">${job.customer_name} · ${job.customer_phone}</div>
      <div class="jc-svc">${job.services_summary}</div>
      <div class="jc-time">🕐 ${timeAgo} · Steps: ${doneSteps}/${totalSteps}</div>
      ${checkpointsHtml}
      <div class="jc-actions">
        ${actionsByStatus[job.status] || ''}
      </div>
    </div>
  `;
}

window.toggleStep = async function(jobId, serviceIdx, stepIdx, done) {
  const r = await api(`/api/jobs/${jobId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkpoint: { service_idx: serviceIdx, step_idx: stepIdx, done } }),
  });
  if (r.ok) {
    const { checkpoints } = await r.json();
    const job = boardJobs.find(j => j.id === jobId);
    if (job) { job.checkpoints = JSON.stringify(checkpoints); renderBoard(); }
  }
};

window.changeStatus = async function(jobId, status) {
  const r = await api(`/api/jobs/${jobId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (r.ok) {
    const job = boardJobs.find(j => j.id === jobId);
    if (job) { job.status = status; renderBoard(); }
  } else {
    const data = await r.json().catch(() => ({}));
    alert(data.error || 'Could not update status.');
  }
};

window.sendWA = async function(jobId, statusKey) {
  const job = boardJobs.find(j => j.id === jobId);
  if (job) await sendStatus(job, statusKey);
};

// ── Utilities ──────────────────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  return `${h}h ${diff % 60}m ago`;
}
