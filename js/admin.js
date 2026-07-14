import { sendStatus, sendExpiryNudge, sendMemberMessage, setAuthHeaders } from './whatsapp.js';

// ── State ──────────────────────────────────────────────────────────────
let SECRET = '';
let pricing = null;
let allJobs = [];
let allSubs = [];
let settings = {};
let subCustomerId = null;
let subVehicles = [];
let memberFilter = 'active';
let expiringSubs = [];

// ── Auth helpers ───────────────────────────────────────────────────────
function api(path, opts = {}) {
  return fetch(path, { ...opts, headers: { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}
function apiRaw(path, opts = {}) {
  return fetch(path, { ...opts, headers: { 'X-Admin-Secret': SECRET, ...(opts.headers || {}) } });
}

// ── Session helpers ────────────────────────────────────────────────────
const SESSION_KEY = 'dhulaai_admin_session';
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 hours

function saveSession(secret) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ secret, expiresAt: Date.now() + SESSION_TTL }));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.secret && s.expiresAt > Date.now()) return s.secret;
  } catch {}
  return null;
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
    saveSession(pw);
    enterDashboard();
  } else {
    err.textContent = 'Wrong password.';
    btn.disabled = false; btn.textContent = 'Login';
  }
});

async function enterDashboard() {
  setAuthHeaders({ 'X-Admin-Secret': SECRET });
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  await init();
}

async function init() {
  await Promise.all([loadDash(), loadPricing(), loadCars(), loadSubs()]);
  // Auto-refresh every 60 seconds
  setInterval(() => {
    const activeTab = document.querySelector('.nav-tabs button.active')?.dataset?.tab;
    if (activeTab === 'dash')  loadDash();
    if (activeTab === 'cars')  loadCars();
    if (activeTab === 'subs')  loadSubs();
  }, 60000);
}

window.logout = function() { clearSession(); SECRET = ''; location.reload(); };

// Auto-restore session on load
(async () => {
  const saved = restoreSession();
  if (saved) {
    SECRET = saved;
    await enterDashboard();
  }
})();

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
      <div class="jc-time" style="display:flex;align-items:center;gap:8px;">
        <span style="color:var(--text2);font-size:12px;">Steps ${done}/${total}</span>
        <span style="margin-left:auto;display:flex;align-items:center;gap:4px;">
          ₹<input type="number" value="${job.price||0}"
            style="width:72px;background:var(--bg3);border:1px solid var(--border);color:var(--gold);border-radius:6px;padding:3px 6px;font-size:13px;font-weight:600;"
            onchange="quickEditPrice(${job.id},this.value)" onclick="event.stopPropagation()">
        </span>
      </div>
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

window.quickEditPrice = async function(jobId, newPrice) {
  await api(`/api/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify({ price: Number(newPrice) }),
  });
  const job = allJobs.find(j => j.id === jobId);
  if (job) job.price = Number(newPrice);
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
        <h4 style="margin-bottom:12px;font-size:13px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Memberships</h4>
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
      <div><span class="text-muted">Created: </span>${job.created_at?.split('T')[0]||''}</div>
      <div><span class="text-muted">Notes: </span>${job.notes||'—'}</div>
    </div>
    <div class="divider"></div>
    <h4 style="font-size:13px;margin-bottom:10px;color:var(--text2);">Checkpoints</h4>
    ${cpHtml}
    <div class="divider"></div>
    <!-- Price edit + payment -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;">
      <div style="font-size:13px;color:var(--text2);margin-bottom:10px;font-weight:600;">Billing</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
        <label style="font-size:13px;color:var(--text2);min-width:80px;">Job Price:</label>
        <span style="font-size:12px;color:var(--text2);">Auto: ₹${(job.price||0).toLocaleString('en-IN')}</span>
        <span style="color:var(--text2);">→</span>
        ₹<input type="number" id="edit-price" value="${job.price||0}"
          style="width:90px;background:var(--bg);border:1px solid var(--gold);color:var(--gold);border-radius:6px;padding:4px 8px;font-weight:600;"
          oninput="updateDiscountLabel(${job.price||0})">
        <span id="discount-label" style="font-size:12px;color:var(--green);"></span>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label style="font-size:13px;color:var(--text2);min-width:80px;">Amount Paid:</label>
        <input type="number" id="pay-amount" value="${job.amount_paid||0}" style="width:90px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;">
        <select id="pay-mode" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;">
          <option value="cash" ${job.payment_mode==='cash'?'selected':''}>Cash</option>
          <option value="upi" ${job.payment_mode==='upi'?'selected':''}>UPI</option>
          <option value="sub" ${job.payment_mode==='sub'?'selected':''}>Sub</option>
        </select>
        <button class="btn btn-gold btn-sm" onclick="savePayment(${job.id})">Save</button>
      </div>
    </div>
  `;

  document.getElementById('job-delete-btn').onclick = () => deleteJob(job.id);
  document.getElementById('job-modal').classList.add('open');
};

window.closeJobModal = function() { document.getElementById('job-modal').classList.remove('open'); };

window.updateDiscountLabel = function(originalPrice) {
  const edited = Number(document.getElementById('edit-price').value);
  const el = document.getElementById('discount-label');
  if (!el) return;
  if (edited < originalPrice) {
    const disc = originalPrice - edited;
    el.textContent = `− ₹${disc.toLocaleString('en-IN')} discount`;
    el.style.color = 'var(--green)';
  } else if (edited > originalPrice) {
    const extra = edited - originalPrice;
    el.textContent = `+ ₹${extra.toLocaleString('en-IN')} added`;
    el.style.color = 'var(--orange)';
  } else {
    el.textContent = '';
  }
};

window.savePayment = async function(jobId) {
  const price  = Number(document.getElementById('edit-price').value);
  const amount = Number(document.getElementById('pay-amount').value);
  const mode   = document.getElementById('pay-mode').value;
  await api(`/api/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify({ price, amount_paid: amount, payment_mode: mode }),
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

// ── Membership ─────────────────────────────────────────────────────────
async function loadSubs() {
  const [allR, expiringR] = await Promise.all([
    api('/api/subscriptions?status=all'),
    api('/api/subscriptions?expiring_soon=1'),
  ]);
  allSubs = await allR.json();
  expiringSubs = expiringR.ok ? await expiringR.json() : [];
  renderMembers();
}

function memberStatus(s) {
  if (!s.is_active) return 'expired';
  return s.end_date >= new Date().toISOString().split('T')[0] ? 'active' : 'expired';
}

window.setMemberFilter = function(filter, btn) {
  memberFilter = filter;
  ['active', 'expired', 'all'].forEach(f => {
    const b = document.getElementById(`member-filter-${f}`);
    if (b) b.className = `btn btn-sm ${f === filter ? 'btn-gold' : 'btn-ghost'}`;
  });
  renderMembers();
};

window.renderMembers = function() {
  const tbody = document.getElementById('subs-body');
  const empty = document.getElementById('subs-empty');
  const exBanner = document.getElementById('subs-expiring');

  if (expiringSubs.length) {
    document.getElementById('subs-expiring-list').textContent =
      expiringSubs.map(s => `${s.customer_name}${s.reg_number ? ' · ' + s.reg_number : ''} (${s.plan_label})`).join(', ');
    exBanner.classList.remove('hidden');
  } else {
    exBanner.classList.add('hidden');
  }

  const q = (document.getElementById('member-search')?.value || '').trim().toLowerCase();
  const subs = allSubs.filter(s => {
    if (memberFilter !== 'all' && memberStatus(s) !== memberFilter) return false;
    if (!q) return true;
    return [s.customer_name, s.customer_phone, s.reg_number, s.make_model, s.building_name, s.flat_number, s.parking_number]
      .some(v => v && String(v).toLowerCase().includes(q));
  });

  if (!subs.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  tbody.innerHTML = subs.map(s => {
    const pct = Math.round(s.washes_used / s.washes_total * 100);
    const status = memberStatus(s);
    const nearExpiry = status === 'active' && new Date(s.end_date) <= new Date(Date.now() + 2*86400000);
    const residence = [s.building_name, s.flat_number].filter(Boolean).join(' · ');
    const member = `${s.customer_name}${residence ? `<div style="font-size:11px;color:var(--text2);">🏢 ${residence}</div>` : ''}`;
    const vehicleSub = [s.make_model, s.parking_number ? `P: ${s.parking_number}` : ''].filter(Boolean).join(' · ');
    const vehicle = s.reg_number
      ? `<b>${s.reg_number}</b>${vehicleSub ? `<div style="font-size:11px;color:var(--text2);">${vehicleSub}</div>` : ''}`
      : '<span class="text-muted">Any (legacy)</span>';
    const badge = status === 'active'
      ? '<span class="text-green" style="font-size:12px;font-weight:600;">● Active</span>'
      : '<span class="text-muted" style="font-size:12px;font-weight:600;">○ Expired</span>';
    const payment = s.is_paid
      ? `<span class="text-green" style="font-size:12px;font-weight:600;cursor:pointer;" title="Paid ${s.paid_at || ''} — click to mark unpaid" onclick="togglePaid(${s.id}, false)">✓ Paid</span>`
      : `<button class="btn btn-gold btn-sm" onclick="togglePaid(${s.id}, true)">Mark Paid</button>
         <button class="btn btn-wa btn-sm" title="Ask for payment on WhatsApp" onclick="nudgePayment(${s.id})">📱</button>`;
    return `
      <tr>
        <td>${member}</td>
        <td>${s.customer_phone}</td>
        <td>${vehicle}</td>
        <td>${s.plan_label}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="bar-track" style="width:60px;"><div class="bar-fill" style="width:${pct}%;background:var(--blue);"></div></div>
            <span style="font-size:12px;">${s.washes_used}/${s.washes_total}</span>
          </div>
        </td>
        <td class="${nearExpiry ? 'text-orange' : ''}">${s.end_date}</td>
        <td class="text-gold">₹${s.price.toLocaleString('en-IN')}</td>
        <td>${payment}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap;">
          ${nearExpiry ? `<button class="btn btn-wa btn-sm" onclick="nudgeMember(${s.id})">📱 Nudge</button>` : ''}
          <button class="btn btn-ghost btn-sm" title="Edit residence & parking" onclick="editMember(${s.id})">✎</button>
          <button class="btn btn-gold btn-sm" onclick="renewMembership(${s.id})">Renew</button>
          ${status === 'active' ? `<button class="btn btn-red btn-sm" onclick="deactivateSub(${s.id})">Deactivate</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
};

window.togglePaid = async function(id, paid) {
  const s = allSubs.find(x => x.id === id);
  if (!s) return;
  const msg = paid
    ? `Mark ₹${s.price.toLocaleString('en-IN')} as received from ${s.customer_name}?`
    : `Mark this membership as UNPAID again?`;
  if (!confirm(msg)) return;
  await api(`/api/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify({ paid }) });
  loadSubs();
};

window.nudgeMember = async function(id) {
  const s = allSubs.find(x => x.id === id);
  if (s) await sendExpiryNudge(s);
};

window.nudgePayment = async function(id) {
  const s = allSubs.find(x => x.id === id);
  if (s) await sendMemberMessage(s, 'tpl_payment');
};

// ── Member details (residence & parking) ───────────────────────────────
let editSubId = null;

window.editMember = function(id) {
  const s = allSubs.find(x => x.id === id);
  if (!s) return;
  editSubId = id;
  document.getElementById('med-info').textContent = `${s.customer_name} · ${s.customer_phone}${s.reg_number ? ' · ' + s.reg_number : ''}`;
  document.getElementById('med-err').textContent = '';
  document.getElementById('med-building').value = s.building_name || '';
  document.getElementById('med-flat').value = s.flat_number || '';
  document.getElementById('med-parking').value = s.parking_number || '';
  document.getElementById('member-edit-modal').classList.add('open');
};

window.closeMemberEditModal = function() { document.getElementById('member-edit-modal').classList.remove('open'); };

window.saveMemberDetails = async function() {
  const r = await api(`/api/subscriptions/${editSubId}`, { method: 'PATCH', body: JSON.stringify({ details: {
    building_name: document.getElementById('med-building').value.trim(),
    flat_number: document.getElementById('med-flat').value.trim(),
    parking_number: document.getElementById('med-parking').value.trim(),
  } }) });
  if (r.ok) { closeMemberEditModal(); loadSubs(); }
  else document.getElementById('med-err').textContent = await r.text();
};

window.requestMemberInfo = async function() {
  const s = allSubs.find(x => x.id === editSubId);
  if (!s) return;
  const r = await api(`/api/subscriptions/${editSubId}`, { method: 'PATCH', body: JSON.stringify({ make_info_token: true }) });
  if (!r.ok) { document.getElementById('med-err').textContent = await r.text(); return; }
  const { token } = await r.json();
  const info_url = `${location.origin}/details?token=${token}`;
  await sendMemberMessage(s, 'tpl_info', { info_url });
};

window.renewMembership = async function(id) {
  const s = allSubs.find(x => x.id === id);
  if (!s) return;
  if (!s.vehicle_id) {
    alert('This is a legacy membership without a vehicle. Use “+ Add Member” to create it against a specific car.');
    return;
  }
  const listPrice = pricing?.monthly?.[s.car_type]?.[s.frequency]?.[s.wash_type] ?? s.price;
  const entered = prompt(
    `Renew ${s.plan_label} for ${s.customer_name} (${s.reg_number}) — 30 days.\nPrice (₹/month, edit for a custom rate):`,
    listPrice
  );
  if (entered === null) return;
  const price = Number(entered);
  if (!Number.isFinite(price) || price < 0) { alert('Invalid price.'); return; }
  const r = await api('/api/subscriptions', { method: 'POST', body: JSON.stringify({
    customer_id: s.customer_id,
    vehicle_id: s.vehicle_id,
    car_type: s.car_type,
    wash_type: s.wash_type,
    frequency: s.frequency,
    price,
  }) });
  if (r.ok) loadSubs();
  else alert(await r.text());
};

window.deactivateSub = async function(id) {
  if (!confirm('Deactivate this membership?')) return;
  await api(`/api/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify({ deactivate: true }) });
  loadSubs();
};

// New membership modal
window.openNewSubModal = async function() {
  if (!pricing) await loadPricing(); // retry if the initial fetch failed
  populateSubCarTypes();
  subCustomerId = null;
  subVehicles = [];
  ['sub-phone', 'sub-name', 'sub-building', 'sub-flat', 'sub-parking', 'sub-veh-reg', 'sub-veh-model', 'sub-veh-color'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('sub-customer-info').classList.add('hidden');
  document.getElementById('sub-modal-err').textContent = '';
  renderSubVehicleOptions();
  updateSubPrice();
  document.getElementById('sub-modal').classList.add('open');
};

window.closeSubModal = function() { document.getElementById('sub-modal').classList.remove('open'); };

function renderSubVehicleOptions() {
  const sel = document.getElementById('sub-vehicle');
  if (!sel) return;
  sel.innerHTML = subVehicles.map(v =>
    `<option value="${v.id}">${v.reg_number}${v.make_model ? ' — ' + v.make_model : ''} (${v.car_type})</option>`
  ).join('') + '<option value="new">+ Add new vehicle…</option>';
  onSubVehicleChange();
}

window.onSubVehicleChange = function() {
  const val = document.getElementById('sub-vehicle')?.value;
  document.getElementById('sub-new-vehicle').classList.toggle('hidden', val !== 'new');
  const v = subVehicles.find(x => x.id === Number(val));
  if (v) {
    const ctSel = document.getElementById('sub-car-type');
    if (ctSel) ctSel.value = v.car_type;
    document.getElementById('sub-parking').value = v.parking_number || '';
  }
  updateSubPrice();
};

window.subPhoneLookup = async function() {
  const phone = document.getElementById('sub-phone').value.trim();
  if (phone.length < 10) return;
  const r = await api(`/api/customers?phone=${encodeURIComponent(phone)}`);
  if (!r.ok) return;
  const data = await r.json();
  const info = document.getElementById('sub-customer-info');
  if (data) {
    subCustomerId = data.customer.id;
    subVehicles = data.vehicles || [];
    document.getElementById('sub-name').value = data.customer.name;
    document.getElementById('sub-building').value = data.customer.building_name || '';
    document.getElementById('sub-flat').value = data.customer.flat_number || '';
    info.textContent = subVehicles.length
      ? `Found: ${data.customer.name}`
      : `Found: ${data.customer.name} — no vehicles on record; add the car details below.`;
    info.classList.remove('hidden');
  } else {
    subCustomerId = null;
    subVehicles = [];
    info.textContent = 'New customer — enter their name and vehicle details.';
    info.classList.remove('hidden');
  }
  renderSubVehicleOptions();
  updateSubPrice();
};

window.updateSubPrice = function() {
  if (!pricing) return;
  const ct = document.getElementById('sub-car-type')?.value;
  const fr = Number(document.getElementById('sub-plan')?.value);
  const price = ct && fr ? (pricing.monthly?.[ct]?.[fr]?.foam || 0) : 0;
  const input = document.getElementById('sub-price');
  if (input) input.value = price || '';
  const hint = document.getElementById('sub-price-hint');
  if (hint) hint.textContent = price ? `List price: ₹${price.toLocaleString('en-IN')}` : '';
};

window.createSubscription = async function() {
  const err = document.getElementById('sub-modal-err');
  const phone = document.getElementById('sub-phone').value.trim();
  const name = document.getElementById('sub-name').value.trim();
  if (phone.length < 10) { err.textContent = 'Enter the customer phone number.'; return; }

  const priceVal = document.getElementById('sub-price').value;
  if (priceVal === '' || Number(priceVal) < 0) { err.textContent = 'Enter a valid price.'; return; }

  // Vehicle: existing one, or new details entered inline
  const vehicleVal = document.getElementById('sub-vehicle').value;
  let vehicleFields = {};
  if (vehicleVal === 'new') {
    const reg = document.getElementById('sub-veh-reg').value.trim().toUpperCase();
    if (!reg) { err.textContent = 'Enter the vehicle reg number.'; return; }
    vehicleFields.vehicle = {
      reg_number: reg,
      make_model: document.getElementById('sub-veh-model').value.trim(),
      color: document.getElementById('sub-veh-color').value.trim(),
    };
  } else if (Number(vehicleVal)) {
    vehicleFields.vehicle_id = Number(vehicleVal);
  } else {
    err.textContent = 'Select or add the vehicle this membership is for.'; return;
  }

  // New customer — create them from phone + name
  if (!subCustomerId) {
    if (!name) { err.textContent = 'Enter the customer name.'; return; }
    const cr = await api('/api/customers', { method: 'POST', body: JSON.stringify({ name, phone }) });
    if (!cr.ok) { err.textContent = await cr.text(); return; }
    subCustomerId = (await cr.json()).id;
  }

  const body = {
    customer_id: subCustomerId,
    ...vehicleFields,
    car_type: document.getElementById('sub-car-type').value,
    wash_type: 'foam',
    frequency: Number(document.getElementById('sub-plan').value),
    price: Number(priceVal),
    building_name: document.getElementById('sub-building').value.trim(),
    flat_number: document.getElementById('sub-flat').value.trim(),
    parking_number: document.getElementById('sub-parking').value.trim(),
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
  populateSubCarTypes();
}

function populateSubCarTypes() {
  const ctSel = document.getElementById('sub-car-type');
  if (!ctSel || !pricing || ctSel.options.length) return;
  pricing.car_types.forEach(ct => {
    const o = document.createElement('option');
    o.value = ct; o.textContent = ct;
    ctSel.appendChild(o);
  });
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
    const tierName = { 1: 'Essential Care', 2: 'Signature Care', 4: 'Elite Care' }[fr] || '';
    html += `<div style="margin-bottom:10px;"><b style="color:var(--text2);">${tierName} (${fr}×/month)</b><div class="tbl-wrap"><table><thead><tr><th>Car Type</th><th>Normal</th><th>Foam</th></tr></thead><tbody>`;
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
  const carTypes = pricing.car_types;
  const html = pricing.addons.map(a => `
    <div style="margin-bottom:20px;">
      <div style="font-weight:600;font-size:14px;color:var(--gold);margin-bottom:8px;">${a.name}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;">
        ${carTypes.map(ct => {
          const p = pricing.addon_pricing?.[a.id]?.[ct] ?? a.base_price;
          return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 10px;">
            <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">${ct}</div>
            ₹<input type="number" value="${p}" style="width:70px;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);padding:2px 4px;font-size:14px;"
              onchange="saveAddonPriceCell(this,${a.id},'${ct}')">
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
  document.getElementById('addon-price-table').innerHTML = html;
}

window.savePriceCell = async function(input, type, carType, washType, frequency) {
  const body = { type, car_type: carType, wash_type: washType, price: Number(input.value) };
  if (frequency) body.frequency = frequency;
  await api('/api/pricing', { method: 'PUT', body: JSON.stringify(body) });
};

window.saveAddonPriceCell = async function(input, addonId, carType) {
  await api('/api/pricing', { method: 'PUT', body: JSON.stringify({ type: 'addon_pricing', addon_id: addonId, car_type: carType, price: Number(input.value) }) });
  if (pricing.addon_pricing?.[addonId]) pricing.addon_pricing[addonId][carType] = Number(input.value);
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
  const serviceLabels = { top: 'Top Wash', normal: 'Normal Wash', foam: 'Foam Wash', interior: 'Dry Cleaning', rubbing: 'Full Rubbing', pickup_drop: 'Pickup & Drop' };
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
  const keys = ['tpl_received', 'tpl_inprogress', 'tpl_ready', 'tpl_delivered', 'tpl_expiring', 'tpl_payment', 'tpl_info'];
  const labels = {
    tpl_received: 'Car Received',
    tpl_inprogress: 'In Progress',
    tpl_ready: 'Ready for Pickup',
    tpl_delivered: 'Delivered',
    tpl_expiring: 'Membership Expiring (vars: {name} {plan} {reg} {expiry} {price})',
    tpl_payment: 'Payment Reminder (vars: {name} {plan} {reg} {price})',
    tpl_info: 'Ask Member Details (vars: {name} {reg} {info_url})',
  };
  document.getElementById('wa-templates').innerHTML = keys.map(k => `
    <div class="form-group">
      <label>${labels[k]}</label>
      <textarea rows="2" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px;font-size:13px;width:100%;resize:vertical;"
        onchange="saveSetting('${k}', this.value)">${settings[k] || ''}</textarea>
    </div>
  `).join('');
}
