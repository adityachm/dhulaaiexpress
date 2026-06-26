import { sendStatus, setAuthHeaders } from './whatsapp.js';

// ── State ──────────────────────────────────────────────────────────────
let SECRET = '';
let pricing = null;
let allJobs = [];
let allSubs = [];
let settings = {};
let subCustomerId = null;

// ── Auth helpers ───────────────────────────────────────────────────────
function api(path, opts = {}) {
  return fetch(path, { ...opts, headers: { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}
function apiRaw(path, opts = {}) {
  return fetch(path, { ...opts, headers: { 'X-Admin-Secret': SECRET, ...(opts.headers || {}) } });
}

// ── Boot ───────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = document.getElementById('login-pw').value.trim();
  const err = document.getElementById('login-err');
  const btn = e.target.querySelector('button');
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Checking…';

  const r = await fetch('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: pw }),
  });
  const { role } = await r.json().catch(() => ({}));
  if (role === 'admin') {
    SECRET = pw;
    setAuthHeaders({ 'X-Admin-Secret': SECRET });
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    await init();
  } else {
    err.textContent = 'Wrong password.';
    btn.disabled = false; btn.textContent = 'Login';
  }
});

async function init() {
  await Promise.all([loadDash(), loadPricing()]);
}

window.logout = function() { SECRET = ''; location.reload(); };

// ── Tab switching ──────────────────────────────────────────────────────
window.switchTab = function(tab, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  btn.classList.add('active');
  if (tab === 'dash')    loadDash();
  if (tab === 'summary') loadSummary('today', document.querySelector('.range-bar button'));
  if (tab === 'cars')    loadCars();
  if (tab === 'subs')    loadSubs();
  if (tab === 'manage')  loadManage();
};

// ── Dashboard ──────────────────────────────────────────────────────────
window.loadDash = async function() {
  const r = await api('/api/summary?range=today');
  if (!r.ok) return;
  const data = await r.json();
  document.getElementById('tile-today').textContent = data.live_now?.today_total ?? '—';
  document.getElementById('tile-revenue').textContent = `₹${(data.overview?.total_revenue || 0).toLocaleString('en-IN')}`;
  document.getElementById('tile-inprog').textContent = data.live_now?.in_progress ?? '—';
  document.getElementById('tile-ready').textContent = data.live_now?.ready_for_pickup ?? '—';

  // Load board jobs for today
  const jr = await api(`/api/jobs?date=${new Date().toISOString().split('T')[0]}`);
  if (!jr.ok) return;
  allJobs = await jr.json();
  renderAdminBoard();
};

function renderAdminBoard() {
  const cols = { received: [], in_progress: [], ready: [], delivered: [] };
  allJobs.forEach(j => { if (cols[j.status]) cols[j.status].push(j); });
  Object.entries(cols).forEach(([status, jobs]) => {
    const col = document.getElementById(`adm-col-${status}`);
    if (!col) return;
    if (!jobs.length) { col.innerHTML = '<div class="empty-state text-sm">No cars</div>'; return; }
    col.innerHTML = jobs.map(j => renderAdminCard(j)).join('');
  });
}

function renderAdminCard(job) {
  const checkpoints = JSON.parse(job.checkpoints || '[]');
  const total = checkpoints.reduce((s, c) => s + c.steps.length, 0);
  const done = checkpoints.reduce((s, c) => s + c.steps.filter(st => st.done).length, 0);
  return `
    <div class="job-card status-${job.status}">
      <div class="jc-reg">${job.reg_number} <span class="badge badge-${job.status}">${job.status.replace('_',' ')}</span></div>
      <div class="jc-owner">${job.customer_name} · ${job.customer_phone}</div>
      <div class="jc-svc">${job.services_summary}</div>
      <div class="jc-time">₹${(job.price||0).toLocaleString('en-IN')} · Steps ${done}/${total}</div>
      <div class="jc-actions">
        <button class="btn btn-ghost btn-sm" onclick="openJobModal(${job.id})">Detail</button>
        <button class="btn btn-wa btn-sm" onclick="adminSendWA(${job.id},'${job.status}')">📱 WA</button>
      </div>
    </div>
  `;
}

window.adminSendWA = async function(jobId, status) {
  const job = allJobs.find(j => j.id === jobId);
  const statusKey = status === 'in_progress' ? 'inprogress' : status;
  if (job) await sendStatus(job, statusKey);
};

// ── Summary ────────────────────────────────────────────────────────────
window.loadSummary = async function(range, btn) {
  document.querySelectorAll('.range-bar button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('custom-range').style.display = 'none';
  await fetchAndRenderSummary(`/api/summary?range=${range}`);
};

window.showCustomRange = function() {
  const el = document.getElementById('custom-range');
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
};

window.loadCustomSummary = async function() {
  const from = document.getElementById('range-from').value;
  const to = document.getElementById('range-to').value;
  if (!from || !to) return;
  await fetchAndRenderSummary(`/api/summary?range=custom&from=${from}&to=${to}`);
};

async function fetchAndRenderSummary(url) {
  document.getElementById('summary-content').innerHTML = '<div class="empty-state">Loading…</div>';
  const r = await api(url);
  if (!r.ok) return;
  const d = await r.json();
  renderSummary(d);
}

function renderSummary(d) {
  const ov = d.overview || {};
  const maxRev = Math.max(1, ...d.by_wash_type.map(r => r.revenue));
  const washRows = d.by_wash_type.map(r => `
    <div class="bar-row">
      <span style="width:100px;font-size:13px;">${washLabel(r.wash_type)} (${r.count})</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.revenue/maxRev*100)}%"></div></div>
      <span style="font-size:13px;color:var(--gold);">₹${r.revenue.toLocaleString('en-IN')}</span>
    </div>`).join('');

  const payRows = d.by_payment_mode.map(r => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <span>${r.payment_mode.toUpperCase()}</span><span>${r.count} jobs</span><span class="text-gold">₹${r.revenue.toLocaleString('en-IN')}</span>
    </div>`).join('');

  const topRows = d.top_customers.map(c => `
    <tr><td>${c.name}</td><td>${c.phone}</td><td>${c.visits}</td><td class="text-gold">₹${c.spent.toLocaleString('en-IN')}</td></tr>`).join('');

  document.getElementById('summary-content').innerHTML = `
    <div class="tiles" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px;">
      <div class="tile gold"><div class="tile-val">${ov.total_jobs||0}</div><div class="tile-lbl">Total Cars</div></div>
      <div class="tile green"><div class="tile-val">₹${(ov.total_revenue||0).toLocaleString('en-IN')}</div><div class="tile-lbl">Total Revenue</div></div>
      <div class="tile blue"><div class="tile-val">₹${(ov.total_collected||0).toLocaleString('en-IN')}</div><div class="tile-lbl">Collected</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div class="card">
        <h4 style="margin-bottom:12px;font-size:13px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">By Wash Type</h4>
        ${washRows || '<div class="empty-state">No data</div>'}
      </div>
      <div class="card">
        <h4 style="margin-bottom:12px;font-size:13px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">By Payment Mode</h4>
        ${payRows || '<div class="empty-state">No data</div>'}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div class="card">
        <h4 style="margin-bottom:12px;font-size:13px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Top Customers</h4>
        <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Visits</th><th>Spent</th></tr></thead>
        <tbody>${topRows || '<tr><td colspan="4" class="empty-state">No data</td></tr>'}</tbody></table></div>
      </div>
      <div class="card">
        <h4 style="margin-bottom:12px;font-size:13px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Subscriptions</h4>
        <div style="font-size:14px;">
          <div style="padding:8px 0;border-bottom:1px solid var(--border);">Active: <b class="text-green">${d.subscriptions?.active_count||0}</b></div>
          <div style="padding:8px 0;border-bottom:1px solid var(--border);">Expiring in 7 days: <b class="text-orange">${d.subscriptions?.expiring_soon||0}</b></div>
          <div style="padding:8px 0;">Active value: <b class="text-gold">₹${(d.subscriptions?.active_revenue||0).toLocaleString('en-IN')}</b></div>
        </div>
      </div>
    </div>
  `;
}

function washLabel(t) { return t==='top'?'Top Wash':t==='normal'?'Normal Wash':t==='foam'?'Foam Wash':t; }

// ── Cars ───────────────────────────────────────────────────────────────
async function loadCars() {
  const r = await api('/api/jobs');
  if (!r.ok) return;
  allJobs = await r.json();
  renderCarsTable(allJobs);
}

function renderCarsTable(jobs) {
  const tbody = document.getElementById('cars-body');
  const empty = document.getElementById('cars-empty');
  if (!jobs.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  tbody.innerHTML = jobs.map(j => `
    <tr>
      <td><b>${j.reg_number}</b></td>
      <td>${j.customer_name}</td>
      <td>${j.customer_phone}</td>
      <td>${j.car_type}</td>
      <td style="max-width:160px;font-size:12px;">${j.services_summary}</td>
      <td class="text-gold">₹${(j.price||0).toLocaleString('en-IN')}</td>
      <td><span class="badge badge-${j.status}">${j.status.replace('_',' ')}</span></td>
      <td style="font-size:12px;color:var(--text2);">${j.created_at?.split('T')[0]||''}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openJobModal(${j.id})">View</button>
      </td>
    </tr>
  `).join('');
}

window.filterCars = function() {
  const q = document.getElementById('car-search').value.toLowerCase();
  const filtered = allJobs.filter(j =>
    j.reg_number?.toLowerCase().includes(q) ||
    j.customer_phone?.includes(q) ||
    j.customer_name?.toLowerCase().includes(q)
  );
  renderCarsTable(filtered);
};

// ── Job detail modal ───────────────────────────────────────────────────
window.openJobModal = async function(jobId) {
  const r = await api(`/api/jobs/${jobId}`);
  if (!r.ok) return;
  const job = await r.json();
  const checkpoints = JSON.parse(job.checkpoints || '[]');

  const cpHtml = checkpoints.map(cp => `
    <div style="margin-bottom:10px;">
      <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:4px;">${cp.label}</div>
      ${cp.steps.map(s => `<div style="font-size:13px;padding:2px 0;${s.done?'color:var(--text3);text-decoration:line-through;':''}">
        ${s.done ? '✅' : '⬜'} ${s.label}
      </div>`).join('')}
    </div>
  `).join('');

  document.getElementById('job-modal-title').textContent = `${job.reg_number} — ${job.customer_name}`;
  document.getElementById('job-modal-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;margin-bottom:16px;">
      <div><span class="text-muted">Phone: </span>${job.customer_phone}</div>
      <div><span class="text-muted">Car: </span>${job.make_model} ${job.color} (${job.car_type})</div>
      <div><span class="text-muted">Service: </span>${job.services_summary}</div>
      <div><span class="text-muted">Status: </span><span class="badge badge-${job.status}">${job.status.replace('_',' ')}</span></div>
      <div><span class="text-muted">Price: </span><b class="text-gold">₹${(job.price||0).toLocaleString('en-IN')}</b></div>
      <div><span class="text-muted">Paid: </span>₹${(job.amount_paid||0).toLocaleString('en-IN')} (${job.payment_mode})</div>
      <div><span class="text-muted">Created: </span>${job.created_at?.split('T')[0]||''}</div>
      <div><span class="text-muted">Notes: </span>${job.notes||'—'}</div>
    </div>
    <div class="divider"></div>
    <h4 style="font-size:13px;margin-bottom:10px;color:var(--text2);">Checkpoints</h4>
    ${cpHtml}
    <div class="divider"></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <label style="font-size:13px;color:var(--text2);">Mark payment:</label>
      <input type="number" id="pay-amount" value="${job.amount_paid||0}" style="width:90px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;">
      <select id="pay-mode" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;">
        <option value="cash" ${job.payment_mode==='cash'?'selected':''}>Cash</option>
        <option value="upi" ${job.payment_mode==='upi'?'selected':''}>UPI</option>
        <option value="sub" ${job.payment_mode==='sub'?'selected':''}>Sub</option>
      </select>
      <button class="btn btn-ghost btn-sm" onclick="savePayment(${job.id})">Save</button>
    </div>
  `;

  document.getElementById('job-delete-btn').onclick = () => deleteJob(job.id);
  document.getElementById('job-modal').classList.add('open');
};

window.closeJobModal = function() { document.getElementById('job-modal').classList.remove('open'); };

window.savePayment = async function(jobId) {
  const amount = Number(document.getElementById('pay-amount').value);
  const mode = document.getElementById('pay-mode').value;
  await api(`/api/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify({ amount_paid: amount, payment_mode: mode }),
  });
  closeJobModal();
  loadCars();
};

window.deleteJob = async function(jobId) {
  if (!confirm('Delete this job permanently?')) return;
  await api(`/api/jobs/${jobId}`, { method: 'DELETE' });
  closeJobModal();
  loadCars();
};

// ── Subscriptions ──────────────────────────────────────────────────────
async function loadSubs() {
  const [activeR, expiringR] = await Promise.all([
    api('/api/subscriptions'),
    api('/api/subscriptions?expiring_soon=1'),
  ]);
  allSubs = await activeR.json();
  const expiring = expiringR.ok ? await expiringR.json() : [];
  renderSubs(allSubs, expiring);
}

function renderSubs(subs, expiring) {
  const tbody = document.getElementById('subs-body');
  const empty = document.getElementById('subs-empty');
  const exBanner = document.getElementById('subs-expiring');

  if (expiring.length) {
    document.getElementById('subs-expiring-list').textContent = expiring.map(s => `${s.customer_name} (${s.plan_label})`).join(', ');
    exBanner.classList.remove('hidden');
  } else {
    exBanner.classList.add('hidden');
  }

  if (!subs.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  tbody.innerHTML = subs.map(s => {
    const remaining = s.washes_total - s.washes_used;
    const pct = Math.round(s.washes_used / s.washes_total * 100);
    const nearExpiry = new Date(s.end_date) <= new Date(Date.now() + 7*86400000);
    return `
      <tr>
        <td>${s.customer_name}</td>
        <td>${s.customer_phone}</td>
        <td>${s.plan_label}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="bar-track" style="width:60px;"><div class="bar-fill" style="width:${pct}%;background:var(--blue);"></div></div>
            <span style="font-size:12px;">${s.washes_used}/${s.washes_total}</span>
          </div>
        </td>
        <td class="${nearExpiry ? 'text-orange' : ''}">${s.end_date}</td>
        <td class="text-gold">₹${s.price.toLocaleString('en-IN')}</td>
        <td>
          <button class="btn btn-red btn-sm" onclick="deactivateSub(${s.id})">Deactivate</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.deactivateSub = async function(id) {
  if (!confirm('Deactivate this subscription?')) return;
  await api(`/api/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify({ deactivate: true }) });
  loadSubs();
};

// New subscription modal
window.openNewSubModal = function() {
  subCustomerId = null;
  document.getElementById('sub-phone').value = '';
  document.getElementById('sub-customer-info').classList.add('hidden');
  document.getElementById('sub-modal-err').textContent = '';
  updateSubPrice();
  document.getElementById('sub-modal').classList.add('open');
};

window.closeSubModal = function() { document.getElementById('sub-modal').classList.remove('open'); };

window.subPhoneLookup = async function() {
  const phone = document.getElementById('sub-phone').value.trim();
  if (phone.length < 10) return;
  const r = await api(`/api/customers?phone=${encodeURIComponent(phone)}`);
  if (!r.ok) return;
  const data = await r.json();
  const info = document.getElementById('sub-customer-info');
  if (data) {
    subCustomerId = data.customer.id;
    info.textContent = `Found: ${data.customer.name}`;
    info.classList.remove('hidden');
    if (data.vehicles?.[0]) {
      const ctSel = document.getElementById('sub-car-type');
      if (ctSel) ctSel.value = data.vehicles[0].car_type;
    }
  } else {
    subCustomerId = null;
    info.textContent = 'Customer not found — they must be registered via the worker panel first.';
    info.classList.remove('hidden');
  }
  updateSubPrice();
};

window.updateSubPrice = function() {
  if (!pricing) return;
  const ct = document.getElementById('sub-car-type')?.value;
  const wt = document.getElementById('sub-wash-type')?.value;
  const fr = Number(document.getElementById('sub-frequency')?.value);
  const price = ct && wt && fr ? (pricing.monthly?.[ct]?.[fr]?.[wt] || 0) : 0;
  document.getElementById('sub-price-display').textContent = `₹${price.toLocaleString('en-IN')}`;
};

window.createSubscription = async function() {
  const err = document.getElementById('sub-modal-err');
  if (!subCustomerId) { err.textContent = 'Look up customer phone first.'; return; }
  const body = {
    customer_id: subCustomerId,
    car_type: document.getElementById('sub-car-type').value,
    wash_type: document.getElementById('sub-wash-type').value,
    frequency: Number(document.getElementById('sub-frequency').value),
  };
  const r = await api('/api/subscriptions', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) {
    closeSubModal();
    loadSubs();
  } else {
    err.textContent = await r.text();
  }
};

// ── Manage ─────────────────────────────────────────────────────────────
async function loadPricing() {
  const r = await apiRaw('/api/pricing', { headers: { 'X-Admin-Secret': SECRET } });
  if (!r.ok) return;
  pricing = await r.json();

  // Populate sub modal car type select
  const ctSel = document.getElementById('sub-car-type');
  if (ctSel && !ctSel.options.length) {
    pricing.car_types.forEach(ct => {
      const o = document.createElement('option');
      o.value = ct; o.textContent = ct;
      ctSel.appendChild(o);
    });
    ['sub-car-type','sub-wash-type','sub-frequency'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', updateSubPrice);
    });
  }
}

async function loadManage() {
  const [settingsR, checkpointsR, pricingR] = await Promise.all([
    api('/api/settings'),
    apiRaw('/api/checkpoints', { headers: { 'X-Admin-Secret': SECRET } }),
    apiRaw('/api/pricing', { headers: { 'X-Admin-Secret': SECRET } }),
  ]);
  settings = settingsR.ok ? await settingsR.json() : {};
  const checkpoints = checkpointsR.ok ? await checkpointsR.json() : [];
  if (pricingR.ok) pricing = await pricingR.json();

  renderWashPrices();
  renderMonthlyPrices();
  renderAddonPrices();
  renderSettingsForm();
  renderCheckpointTemplates(checkpoints);
  renderWaTemplates();
}

function renderWashPrices() {
  if (!pricing) return;
  const wts = ['top', 'normal', 'foam'];
  const headers = ['Car Type', 'Top Wash', 'Normal Wash', 'Foam Wash'];
  let html = `<div class="tbl-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  pricing.car_types.forEach(ct => {
    html += `<tr><td>${ct}</td>`;
    wts.forEach(wt => {
      const price = pricing.wash?.[ct]?.[wt] ?? '';
      html += `<td><input type="number" value="${price}" style="width:70px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;"
        onchange="savePriceCell(this,'wash','${ct}','${wt}')"></td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  document.getElementById('wash-price-table').innerHTML = html;
}

function renderMonthlyPrices() {
  if (!pricing) return;
  const wts = ['normal', 'foam'];
  const freqs = [1, 2, 4];
  let html = '<div style="font-size:12px;">';
  freqs.forEach(fr => {
    html += `<div style="margin-bottom:10px;"><b style="color:var(--text2);">${fr}×/month</b><div class="tbl-wrap"><table><thead><tr><th>Car Type</th><th>Normal</th><th>Foam</th></tr></thead><tbody>`;
    pricing.car_types.forEach(ct => {
      html += `<tr><td style="font-size:12px;">${ct}</td>`;
      wts.forEach(wt => {
        const price = pricing.monthly?.[ct]?.[fr]?.[wt] ?? '';
        html += `<td><input type="number" value="${price}" style="width:70px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;"
          onchange="savePriceCell(this,'monthly','${ct}','${wt}',${fr})"></td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
  });
  html += '</div>';
  document.getElementById('monthly-price-table').innerHTML = html;
}

function renderAddonPrices() {
  if (!pricing) return;
  const html = pricing.addons.map(a => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:14px;">
      <span style="flex:1;">${a.name}</span>
      ₹<input type="number" value="${a.base_price}" style="width:80px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;"
        onchange="saveAddonPrice(this,${a.id})">
    </div>
  `).join('');
  document.getElementById('addon-price-table').innerHTML = html;
}

window.savePriceCell = async function(input, type, carType, washType, frequency) {
  const body = { type, car_type: carType, wash_type: washType, price: Number(input.value) };
  if (frequency) body.frequency = frequency;
  await api('/api/pricing', { method: 'PUT', body: JSON.stringify(body) });
};

window.saveAddonPrice = async function(input, addonId) {
  await api('/api/pricing', { method: 'PUT', body: JSON.stringify({ type: 'addon', addon_id: addonId, base_price: Number(input.value) }) });
};

function renderSettingsForm() {
  const keys = ['shop_name', 'shop_phone'];
  const labels = { shop_name: 'Shop Name', shop_phone: 'WhatsApp Number (with country code, no +)' };
  document.getElementById('settings-form').innerHTML = keys.map(k => `
    <div class="form-group">
      <label>${labels[k] || k}</label>
      <input type="text" id="setting-${k}" value="${settings[k] || ''}"
        onchange="saveSetting('${k}', this.value)">
    </div>
  `).join('');
}

window.saveSetting = async function(key, value) {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ key, value }) });
};

function renderCheckpointTemplates(templates) {
  const serviceLabels = { top: 'Top Wash', normal: 'Normal Wash', foam: 'Foam Wash', interior: 'Interior Cleaning', rubbing: 'Full Rubbing', pickup_drop: 'Pickup & Drop' };
  const container = document.getElementById('checkpoint-templates');
  container.innerHTML = '';

  templates.forEach((t, ti) => {
    const steps = JSON.parse(t.steps);
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '16px';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:13px;font-weight:600;color:var(--text2);margin-bottom:8px;';
    label.textContent = serviceLabels[t.service_key] || t.service_key;
    wrap.appendChild(label);

    const list = document.createElement('div');
    list.id = `cpt-${t.service_key}`;
    wrap.appendChild(list);

    steps.forEach(s => addCptRow(list, t.service_key, s));

    // + Add Step button
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-sm mt8';
    addBtn.textContent = '+ Add Step';
    addBtn.style.marginRight = '8px';
    addBtn.onclick = () => { addCptRow(list, t.service_key, ''); renumberCptRows(list); };
    wrap.appendChild(addBtn);

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary btn-sm mt8';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = () => saveCptTemplate(t.service_key);
    wrap.appendChild(saveBtn);

    container.appendChild(wrap);
    if (ti < templates.length - 1) {
      const hr = document.createElement('hr');
      hr.className = 'divider';
      container.appendChild(hr);
    }
  });
}

function addCptRow(list, serviceKey, value) {
  const row = document.createElement('div');
  row.draggable = true;
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;cursor:default;border-radius:6px;transition:background .1s;';

  // Drag handle
  const handle = document.createElement('span');
  handle.textContent = '⠿';
  handle.title = 'Drag to reorder';
  handle.style.cssText = 'color:var(--text3);font-size:16px;cursor:grab;flex-shrink:0;padding:0 2px;user-select:none;';
  row.appendChild(handle);

  // Step number
  const num = document.createElement('span');
  num.className = 'cpt-num';
  num.style.cssText = 'color:var(--text3);font-size:12px;width:20px;flex-shrink:0;';
  row.appendChild(num);

  // Input
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.dataset.key = serviceKey;
  input.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:13px;';
  input.placeholder = 'Step description…';
  row.appendChild(input);

  // Delete button
  const del = document.createElement('button');
  del.textContent = '✕';
  del.title = 'Remove step';
  del.style.cssText = 'background:none;border:none;color:var(--red);cursor:pointer;font-size:15px;padding:0 4px;flex-shrink:0;';
  del.onclick = () => { row.remove(); renumberCptRows(list); };
  row.appendChild(del);

  // ── Drag-and-drop ────────────────────────────────────────────────
  row.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'move';
    row.style.opacity = '0.4';
    list._dragging = row;
  });
  row.addEventListener('dragend', () => {
    row.style.opacity = '';
    list._dragging = null;
    list.querySelectorAll('[data-drop-indicator]').forEach(el => el.removeAttribute('data-drop-indicator'));
    renumberCptRows(list);
  });
  row.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = list._dragging;
    if (!dragging || dragging === row) return;
    const box = row.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    if (after) row.after(dragging); else row.before(dragging);
  });

  list.appendChild(row);
  renumberCptRows(list);
  return row;
}

function renumberCptRows(list) {
  list.querySelectorAll('.cpt-num').forEach((el, i) => { el.textContent = `${i + 1}.`; });
}

window.saveCptTemplate = async function(serviceKey) {
  const inputs = document.querySelectorAll(`#cpt-${serviceKey} [data-key="${serviceKey}"]`);
  const steps = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
  if (!steps.length) { alert('Add at least one step.'); return; }
  const r = await apiRaw('/api/checkpoints', {
    method: 'PUT',
    headers: { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_key: serviceKey, steps }),
  });
  if (r.ok) alert(`✓ "${serviceKey}" steps saved!`);
  else alert('Failed to save. Try again.');
};

function renderWaTemplates() {
  const keys = ['tpl_received', 'tpl_inprogress', 'tpl_ready', 'tpl_delivered'];
  const labels = {
    tpl_received: 'Car Received',
    tpl_inprogress: 'In Progress',
    tpl_ready: 'Ready for Pickup',
    tpl_delivered: 'Delivered',
  };
  document.getElementById('wa-templates').innerHTML = keys.map(k => `
    <div class="form-group">
      <label>${labels[k]}</label>
      <textarea rows="2" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px;font-size:13px;width:100%;resize:vertical;"
        onchange="saveSetting('${k}', this.value)">${settings[k] || ''}</textarea>
    </div>
  `).join('');
}
