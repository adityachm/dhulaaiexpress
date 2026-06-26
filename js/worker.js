import { sendStatus, setAuthHeaders, loadSettings } from './whatsapp.js';

// ── State ──────────────────────────────────────────────────────────────
let PIN = '';
let pricing = null;
let activeSub = null;
let boardJobs = [];
let phoneVerified = false;

// ── Auth helpers ───────────────────────────────────────────────────────
function api(path, opts = {}) {
  return fetch(path, { ...opts, headers: { 'X-Worker-Pin': PIN, ...(opts.headers || {}) } });
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
    setAuthHeaders({ 'X-Worker-Pin': PIN });
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    await init();
  } else {
    err.textContent = 'Wrong PIN. Try again.';
    btn.disabled = false; btn.textContent = 'Enter';
  }
});

async function init() {
  await Promise.all([loadPricing(), loadBoard(), loadSettings()]);
}

function logout() {
  PIN = ''; location.reload();
}

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

  // Populate add-ons
  const list = document.getElementById('addons-list');
  list.innerHTML = '';
  pricing.addons.forEach(addon => {
    const row = document.createElement('div');
    row.className = 'addon-row';
    row.innerHTML = `
      <input type="checkbox" id="addon-${addon.id}" value="${addon.id}" onchange="updatePrice()">
      <label class="addon-name" for="addon-${addon.id}">${addon.name}</label>
      <span style="color:var(--text2);font-size:12px;">from ₹${addon.base_price.toLocaleString('en-IN')}</span>
      <input type="number" class="addon-price-input form-group input" id="addon-price-${addon.id}"
        value="${addon.base_price}" min="0" onchange="updatePrice()" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;">
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

  // Add-ons
  pricing.addons.forEach(addon => {
    const cb = document.getElementById(`addon-${addon.id}`);
    if (cb && cb.checked) {
      const priceInput = document.getElementById(`addon-price-${addon.id}`);
      total += Number(priceInput?.value || addon.base_price);
    }
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

  // Autofill latest vehicle
  if (data.vehicles && data.vehicles.length) {
    const v = data.vehicles[0];
    document.getElementById('f-reg').value = v.reg_number;
    document.getElementById('f-model').value = v.make_model;
    document.getElementById('f-color').value = v.color;
    document.getElementById('f-car-type').value = v.car_type;
    updatePrice();
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

// ── OTP ────────────────────────────────────────────────────────────────
window.sendOTP = async function() {
  const phone = document.getElementById('f-phone').value.trim();
  if (phone.length < 10) { alert('Enter a valid 10-digit phone number first.'); return; }

  const btn = document.getElementById('otp-send-btn');
  btn.disabled = true; btn.textContent = 'Generating…';

  const r = await api('/api/otp?action=send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const data = await r.json().catch(() => ({}));

  btn.disabled = false; btn.textContent = 'Resend OTP';

  if (data.waUrl) {
    // Set href on the link — worker taps it directly (window.open after await is blocked by browsers)
    document.getElementById('otp-wa-link').href = data.waUrl;
    document.getElementById('otp-block').classList.remove('hidden');
    document.getElementById('otp-status').textContent = '';
  } else {
    document.getElementById('otp-block').classList.remove('hidden');
    document.getElementById('otp-status').textContent = 'Failed to generate OTP. Try again.';
    document.getElementById('otp-status').style.color = 'var(--red)';
  }

  phoneVerified = false;
  document.getElementById('phone-verified-badge').classList.add('hidden');
};

window.verifyOTP = async function() {
  const phone = document.getElementById('f-phone').value.trim();
  const code  = document.getElementById('f-otp').value.trim();
  if (!code) { alert('Enter the OTP first.'); return; }

  const r = await api('/api/otp?action=verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  });
  const data = await r.json().catch(() => ({}));

  const statusEl = document.getElementById('otp-status');
  if (data.valid) {
    phoneVerified = true;
    statusEl.textContent = '✓ Phone number verified!';
    statusEl.style.color = 'var(--green)';
    document.getElementById('otp-block').classList.add('hidden');
    document.getElementById('phone-verified-badge').classList.remove('hidden');
  } else {
    phoneVerified = false;
    statusEl.textContent = '✗ ' + (data.error || 'Invalid OTP. Try again or resend.');
    statusEl.style.color = 'var(--red)';
  }
};

// Reset OTP state when phone number changes
document.getElementById('f-phone').addEventListener('input', function() {
  phoneVerified = false;
  document.getElementById('otp-block').classList.add('hidden');
  document.getElementById('phone-verified-badge').classList.add('hidden');
  document.getElementById('otp-send-btn').textContent = 'Send OTP';
});

// ── Form submit ────────────────────────────────────────────────────────
document.getElementById('car-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('form-err');
  err.textContent = '';

  if (!phoneVerified) {
    err.textContent = 'Please verify the customer\'s phone number with OTP before creating the job.';
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Creating…';

  const mode = document.querySelector('input[name="svc-mode"]:checked')?.value || 'onetime';
  const carType = document.getElementById('f-car-type').value;
  const washType = mode === 'monthly'
    ? document.getElementById('f-monthly-wash').value
    : document.getElementById('f-wash-type').value;

  // Collect add-ons
  const addons = [];
  const addon_prices = {};
  if (pricing) {
    pricing.addons.forEach(addon => {
      const cb = document.getElementById(`addon-${addon.id}`);
      if (cb && cb.checked) {
        const p = Number(document.getElementById(`addon-price-${addon.id}`)?.value || addon.base_price);
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

  const r = await api('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (r.ok) {
    const job = await r.json();

    // Show a tap-to-send WhatsApp button (window.open after await is blocked by browsers)
    if (job.statusWaUrl) {
      const waBtn = document.createElement('a');
      waBtn.href = job.statusWaUrl;
      waBtn.target = '_blank';
      waBtn.rel = 'noopener';
      waBtn.className = 'btn btn-green btn-full';
      waBtn.style.cssText = 'display:block;text-align:center;margin-bottom:12px;text-decoration:none;';
      waBtn.textContent = '📱 Tap to Send Status Link to Customer';
      err.parentNode.insertBefore(waBtn, err);
      setTimeout(() => waBtn.remove(), 30000);
    }

    e.target.reset();
    hideSub(); activeSub = null;
    phoneVerified = false;
    document.getElementById('price-display').textContent = '₹0';
    document.getElementById('phone-verified-badge').classList.add('hidden');
    document.getElementById('otp-block').classList.add('hidden');
    document.getElementById('otp-send-btn').textContent = 'Send OTP';
    switchTab('board', document.querySelector('[data-tab="board"]'));
  } else {
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

  const waButtons = {
    received:    `<button class="btn btn-wa btn-sm" onclick="sendWA(${job.id},'received')">📱 Received</button>`,
    in_progress: `<button class="btn btn-wa btn-sm" onclick="sendWA(${job.id},'inprogress')">📱 In Progress</button>`,
    ready:       `<button class="btn btn-wa btn-sm" onclick="sendWA(${job.id},'ready')">📱 Ready</button>`,
    delivered:   `<button class="btn btn-wa btn-sm" onclick="sendWA(${job.id},'delivered')">📱 Delivered</button>`,
  };

  const actionsByStatus = {
    received: `
      <button class="btn btn-primary btn-sm" onclick="changeStatus(${job.id},'in_progress')">▶ Start</button>
      ${waButtons.received}
    `,
    in_progress: `
      <button class="btn btn-gold btn-sm ${canMarkReady ? '' : 'disabled'}" onclick="changeStatus(${job.id},'ready')" ${canMarkReady ? '' : 'disabled title="Complete checklist first"'}>✓ Mark Ready</button>
      ${waButtons.in_progress}
    `,
    ready: `
      <button class="btn btn-green btn-sm" onclick="changeStatus(${job.id},'delivered')">🏁 Delivered</button>
      ${waButtons.ready}
    `,
    delivered: `${waButtons.delivered}`,
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
