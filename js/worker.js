import { setAuthHeaders, loadSettings, fillTemplate, waLink } from './whatsapp.js';

// Worker panel — designed for staff who read little English:
// one question per screen, pictures everywhere, big buttons, plain words.

// ── State ──────────────────────────────────────────────────────────────
let PIN = '';
let pricing = null;
let boardJobs = [];
let currentStatus = 'received';
let settings = {};   // WhatsApp templates, loaded once at start

// ── Vocabulary (plain words + pictures) ────────────────────────────────
const STATUS = {
  received:    { icon: '⏳', name: 'Waiting',    help: 'Cars that came in. Tap ▶ when you start washing.' },
  in_progress: { icon: '🧽', name: 'Washing',    help: 'Tick each step when done. Then tap ✅.' },
  ready:       { icon: '✅', name: 'Ready',      help: 'Clean cars. Tap 🏁 when the customer takes the car.' },
  delivered:   { icon: '🏁', name: 'Given back', help: 'Cars given back to customers today.' },
};

const WASHES = {
  top:    { icon: '💧', name: 'Top wash',    desc: 'Quick outside wash' },
  normal: { icon: '🧽', name: 'Normal wash', desc: 'Shampoo wash + glass inside & out' },
  foam:   { icon: '🫧', name: 'Foam wash',   desc: 'Best wash — thick foam + tyre shine' },
};

// Car sizes with example models, so staff can match by car name
const CAR_TYPE_INFO = {
  'Hatchback':   { icon: '🚗', eg: 'Swift, i20, Alto' },
  'Sedan':       { icon: '🚘', eg: 'City, Dzire, Verna' },
  'Compact SUV': { icon: '🚙', eg: 'Nexon, Brezza, Venue' },
  'Mid SUV':     { icon: '🚙', eg: 'Creta, Seltos, XUV300' },
  'Large SUV':   { icon: '🛻', eg: 'Fortuner, XUV700, Scorpio' },
  'Luxury Car':  { icon: '🏎️', eg: 'BMW, Audi, Mercedes' },
};
const carTypeInfo = ct => CAR_TYPE_INFO[ct] || { icon: '🚗', eg: '' };

const COLORS = [
  { name: 'White',  hex: '#f8fafc' }, { name: 'Silver', hex: '#c0c4cc' },
  { name: 'Grey',   hex: '#6b7280' }, { name: 'Black',  hex: '#111111' },
  { name: 'Red',    hex: '#dc2626' }, { name: 'Blue',   hex: '#2563eb' },
  { name: 'Brown',  hex: '#7c4a2d' }, { name: 'Other',  hex: 'conic-gradient(#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7,#f43f5e)' },
];
const colorHex = name => COLORS.find(c => c.name.toLowerCase() === String(name || '').trim().toLowerCase())?.hex;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupees = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const $ = id => document.getElementById(id);

// ── Auth ───────────────────────────────────────────────────────────────
function api(path, opts = {}) {
  return fetch(path, { ...opts, headers: { 'X-Worker-Pin': PIN, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

const SESSION_KEY = 'dhulaai_worker_session';
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 hours

function saveSession(pin) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ pin, expiresAt: Date.now() + SESSION_TTL })); } catch {}
}
function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.pin && s.expiresAt > Date.now()) return s.pin;
  } catch {}
  return null;
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pin = $('login-pin').value.trim();
  const err = $('login-err');
  const btn = e.target.querySelector('button');
  err.textContent = '';
  if (!pin) { err.textContent = 'Type your PIN first'; return; }
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: pin }) });
    const { role } = await r.json().catch(() => ({}));
    if (role === 'worker' || role === 'admin') {
      PIN = pin; saveSession(pin); await enterApp(); return;
    }
    err.textContent = 'Wrong PIN. Try again.';
    $('login-pin').value = '';
  } catch {
    err.textContent = 'No internet. Check connection and try again.';
  }
  btn.disabled = false; btn.textContent = 'Open ➜';
});

async function enterApp() {
  setAuthHeaders({ 'X-Worker-Pin': PIN });
  $('login-screen').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
  try { currentStatus = sessionStorage.getItem('wk_status') || 'received'; } catch {}
  await Promise.all([loadPricing(), loadBoard(), loadSettings().then(s => { settings = s || {}; })]);
  resetWizard();
  setInterval(() => { if ($('tab-board').classList.contains('active')) loadBoard(); }, 60000);
}

window.logout = function() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  location.reload();
};

(async () => {
  const saved = restoreSession();
  if (saved) { PIN = saved; await enterApp(); }
})();

// ── Tabs ───────────────────────────────────────────────────────────────
window.switchTab = function(tab) {
  document.querySelectorAll('.wk-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.wk-bottom button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $(`tab-${tab}`).classList.add('active');
  window.scrollTo(0, 0);
  if (tab === 'board') loadBoard();
};

window.goToBoard = function(status) {
  if (status) currentStatus = status;
  switchTab('board');
  resetWizard();
};

// ── Pricing ────────────────────────────────────────────────────────────
async function loadPricing() {
  const r = await api('/api/pricing');
  if (r.ok) pricing = await r.json();
}

// ══════════════════════════════════════════════════════════════════════
//  CARS TODAY (job board)
// ══════════════════════════════════════════════════════════════════════
window.loadBoard = async function(manual) {
  const today = new Date().toISOString().split('T')[0];
  try {
    const r = await api(`/api/jobs?date=${today}`);
    if (!r.ok) return;
    boardJobs = await r.json();
    renderBoard();
    if (manual) toast('List updated');
  } catch {
    if (manual) toast('No internet. Try again.');
  }
};

window.showStatus = function(status) {
  currentStatus = status;
  try { sessionStorage.setItem('wk_status', status); } catch {}
  renderBoard();
};

function renderBoard(flashId) {
  const counts = { received: 0, in_progress: 0, ready: 0, delivered: 0 };
  boardJobs.forEach(j => { if (counts[j.status] !== undefined) counts[j.status]++; });

  document.querySelectorAll('.wk-status-tabs button').forEach(b => {
    const s = b.dataset.status;
    b.classList.toggle('active', s === currentStatus);
    const cnt = $(`cnt-${s}`);
    cnt.textContent = counts[s];
    cnt.classList.toggle('has', counts[s] > 0);
  });
  $('status-help').textContent = STATUS[currentStatus].help;

  const jobs = boardJobs.filter(j => j.status === currentStatus);
  const list = $('board-list');
  if (!jobs.length) {
    const st = STATUS[currentStatus];
    list.innerHTML = `<div class="wk-empty"><div>${st.icon}</div>No cars in ${st.name}</div>`;
    return;
  }
  list.innerHTML = jobs.map(cardHtml).join('');
  if (flashId) {
    const el = $(`job-${flashId}`);
    if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
}

function plate(reg) {
  return `<span class="wk-plate">${esc(reg)}</span>`;
}

function carLine(job) {
  const hex = colorHex(job.color);
  const name = [job.color, job.make_model].filter(Boolean).join(' ') || job.car_type;
  return `<div class="wk-car-line">
    ${hex ? `<span class="wk-dot" style="background:${hex}"></span>` : ''}
    <span>${carTypeInfo(job.car_type).icon} ${esc(name)}</span>
  </div>`;
}

function serviceChips(job) {
  const chips = [];
  const w = WASHES[job.wash_type];
  if (job.subscription_id) chips.push(`<span class="wk-chip member">⭐ Member</span>`);
  if (w) chips.push(`<span class="wk-chip">${w.icon} ${w.name}</span>`);
  let addons = [];
  try { addons = JSON.parse(job.addons || '[]'); } catch {}
  addons.forEach(a => chips.push(`<span class="wk-chip">✨ ${esc(a.name)}</span>`));
  if (job.pickup_drop) chips.push(`<span class="wk-chip">🚚 Pickup &amp; drop</span>`);
  return `<div class="wk-chips">${chips.join('')}</div>`;
}

function minutesAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z');
  const m = Math.max(0, Math.floor((Date.now() - d) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} hr ${m % 60} min ago`;
}

function cardHtml(job) {
  const cps = JSON.parse(job.checkpoints || '[]');
  const total = cps.reduce((s, c) => s + c.steps.length, 0);
  const done = cps.reduce((s, c) => s + c.steps.filter(st => st.done).length, 0);
  const mainWash = cps.find(c => ['top', 'normal', 'foam'].includes(c.service_key));
  const canFinish = mainWash ? mainWash.steps.every(s => s.done) : true;

  let middle = '';
  if (job.status === 'in_progress') {
    const pct = total ? Math.round(done / total * 100) : 100;
    middle = `
      <div class="wk-progress">
        <div class="wk-progress-top"><span>Steps done</span><span>${done} of ${total}</span></div>
        <div class="wk-bar ${done === total ? 'full' : ''}"><i style="width:${pct}%"></i></div>
      </div>
      ${cps.map((cp, ci) => `
        <div class="wk-cp-title">${esc(cp.label)}</div>
        ${cp.steps.map((st, si) => `
          <button class="wk-step-row ${st.done ? 'done' : ''}" onclick="toggleStep(${job.id},${ci},${si},${!st.done})">
            <span class="wk-tick">✓</span><span class="wk-step-label">${esc(st.label)}</span>
          </button>`).join('')}
      `).join('')}`;
  }

  let action = '';
  if (job.status === 'received') {
    action = `<button class="wk-big-btn wk-blue" onclick="moveJob(${job.id},'in_progress')">▶ Start washing</button>`;
  } else if (job.status === 'in_progress') {
    action = canFinish
      ? `<button class="wk-big-btn wk-green" onclick="moveJob(${job.id},'ready')">✅ Washing done</button>`
      : `<div class="wk-blocked">⬆ Tick all wash steps first</div>
         <button class="wk-big-btn wk-green" disabled>✅ Washing done</button>`;
  } else if (job.status === 'ready') {
    action = `<button class="wk-big-btn wk-gold" onclick="moveJob(${job.id},'delivered')">🏁 Customer took the car</button>`;
  }

  return `
    <article class="wk-card" data-status="${job.status}" id="job-${job.id}">
      ${plate(job.reg_number)}
      ${carLine(job)}
      <div class="wk-owner">👤 ${esc(job.customer_name)} · 📞 ${esc(job.customer_phone)}</div>
      ${serviceChips(job)}
      ${job.pickup_address ? `<div class="wk-note">🏠 ${esc(job.pickup_address)}</div>` : ''}
      ${job.notes ? `<div class="wk-note">📝 ${esc(job.notes)}</div>` : ''}
      ${middle}
      ${action}
      <div class="wk-time">🕐 Came ${minutesAgo(job.created_at)}</div>
    </article>`;
}

window.toggleStep = async function(jobId, ci, si, done) {
  const job = boardJobs.find(j => j.id === jobId);
  if (!job) return;
  // Update the screen straight away; roll back if the save fails
  const before = job.checkpoints;
  const cps = JSON.parse(job.checkpoints || '[]');
  cps[ci].steps[si].done = done;
  job.checkpoints = JSON.stringify(cps);
  renderBoard();
  try {
    const r = await api(`/api/jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify({ checkpoint: { service_idx: ci, step_idx: si, done } }) });
    if (!r.ok) throw new Error();
    const res = await r.json();
    job.checkpoints = JSON.stringify(res.checkpoints);
  } catch {
    job.checkpoints = before;
    toast('Not saved — check internet');
  }
  renderBoard();
};

window.moveJob = function(jobId, to) {
  const job = boardJobs.find(j => j.id === jobId);
  if (!job) return;
  if (to === 'delivered') {
    confirmSheet(
      `<div class="big">🏁</div><p>Did the customer take this car?</p>${plate(job.reg_number)}`,
      'Yes, car given back',
      () => doMove(job, to)
    );
    return;
  }
  doMove(job, to);
};

async function doMove(job, to, isUndo) {
  const from = job.status;
  try {
    const r = await api(`/api/jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: to }) });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      toast(data.error ? 'Tick all wash steps first' : 'Could not move the car. Try again.');
      return;
    }
  } catch {
    toast('No internet. Try again.');
    return;
  }
  job.status = to;
  currentStatus = to;
  renderBoard(job.id);
  const st = STATUS[to];
  toast(`${job.reg_number} → ${st.icon} ${st.name}`, isUndo ? null : () => doMove(job, from, true));
}

// ── Toast & confirm sheet ──────────────────────────────────────────────
let toastTimer;
function toast(msg, undo) {
  const t = $('toast'), btn = $('toast-undo');
  $('toast-msg').textContent = msg;
  btn.classList.toggle('hidden', !undo);
  btn.onclick = () => { t.classList.add('hidden'); undo(); };
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), undo ? 7000 : 3000);
}

function confirmSheet(html, yesLabel, onYes) {
  $('sheet-body').innerHTML = html;
  const yes = $('sheet-yes');
  yes.textContent = yesLabel;
  yes.onclick = () => { closeSheet(); onYes(); };
  $('sheet').classList.remove('hidden');
}
window.closeSheet = () => $('sheet').classList.add('hidden');

// ══════════════════════════════════════════════════════════════════════
//  NEW CAR (step-by-step)
// ══════════════════════════════════════════════════════════════════════
let draft;
let history = [];
const STEP_DOT = { phone: 'phone', name: 'car', pick: 'car', car: 'car', service: 'service', review: 'review', done: 'review' };
const DOT_ORDER = ['phone', 'car', 'service', 'review'];

function newDraft() {
  return {
    phone: '', customer: null, name: '', vehicles: [], subs: [],
    vehicle: null,                     // an existing vehicle, or null for a new one
    reg: '', carType: '', color: '', model: '',
    service: '',                       // 'member' | 'top' | 'normal' | 'foam'
    addons: new Set(), pickup: false, address: '',
    pay: 'cash', notes: '',
  };
}

window.resetWizard = function() {
  draft = newDraft();
  history = [];
  ['w-phone', 'w-name', 'w-reg', 'w-model', 'w-address', 'w-notes'].forEach(id => { $(id).value = ''; });
  document.querySelectorAll('#tab-new-car .wk-err').forEach(e => { e.textContent = ''; });
  updatePhoneCounter();
  show('phone');
};

function show(step) {
  document.querySelectorAll('.wk-step').forEach(s => s.classList.toggle('active', s.dataset.step === step));
  const dot = DOT_ORDER.indexOf(STEP_DOT[step]);
  const dots = [...document.querySelectorAll('#wiz-steps span')];
  const bars = [...document.querySelectorAll('#wiz-steps i')];
  dots.forEach((d, i) => { d.classList.toggle('active', i === dot && step !== 'done'); d.classList.toggle('done', i < dot || step === 'done'); });
  bars.forEach((b, i) => b.classList.toggle('done', i < dot || step === 'done'));
  $('wiz-steps').classList.toggle('hidden', step === 'done');
  window.scrollTo(0, 0);
  const first = document.querySelector(`.wk-step[data-step="${step}"] input`);
  if (first && !first.value && step !== 'car' && step !== 'service' && step !== 'review') setTimeout(() => first.focus(), 50);
}

function go(step) {
  const current = document.querySelector('.wk-step.active')?.dataset.step;
  if (current) history.push(current);
  if (step === 'car') renderCarStep();
  if (step === 'service') renderServiceStep();
  if (step === 'review') renderReview();
  show(step);
}

window.goBack = function() {
  const prev = history.pop();
  if (prev) show(prev);
};

// ── Step: phone ────────────────────────────────────────────────────────
function phoneDigits() {
  let d = $('w-phone').value.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
function updatePhoneCounter() {
  const n = phoneDigits().length;
  const c = $('w-phone-count');
  c.textContent = n === 10 ? '✓ 10 digits — good' : `${n} of 10 digits`;
  c.classList.toggle('ok', n === 10);
}
$('w-phone').addEventListener('input', () => { $('err-phone').textContent = ''; updatePhoneCounter(); });
$('w-phone').addEventListener('keydown', e => { if (e.key === 'Enter') stepPhoneNext(); });

window.stepPhoneNext = async function() {
  const phone = phoneDigits();
  const err = $('err-phone');
  if (phone.length !== 10) { err.textContent = 'Phone number must be 10 digits'; return; }
  draft.phone = phone;
  err.textContent = 'Checking…';
  let data = null;
  try {
    const r = await api(`/api/customers?phone=${encodeURIComponent(phone)}`);
    if (r.ok) data = await r.json();
  } catch {
    err.textContent = 'No internet. Try again.'; return;
  }
  err.textContent = '';

  if (data && data.customer) {
    draft.customer = data.customer;
    draft.name = data.customer.name;
    draft.vehicles = data.vehicles || [];
    draft.subs = data.active_subscriptions || [];
    if (draft.vehicles.length) { renderCarPicks(); go('pick'); }
    else startNewCar();
  } else {
    draft.customer = null; draft.vehicles = []; draft.subs = [];
    go('name');
  }
};

// ── Step: name ─────────────────────────────────────────────────────────
$('w-name').addEventListener('keydown', e => { if (e.key === 'Enter') stepNameNext(); });
window.stepNameNext = function() {
  const name = $('w-name').value.trim();
  if (name.length < 2) { $('err-name').textContent = 'Type the customer name'; return; }
  $('err-name').textContent = '';
  draft.name = name;
  startNewCar();
};

// ── Step: pick an existing car ─────────────────────────────────────────
function memberFor(vehicle) {
  if (!vehicle) return null;
  return draft.subs.find(s =>
    (s.vehicle_id === vehicle.id || s.vehicle_id == null) && s.washes_total - s.washes_used > 0) || null;
}

function renderCarPicks() {
  $('w-hello').textContent = draft.name;
  $('w-car-picks').innerHTML = draft.vehicles.map((v, i) => {
    const m = memberFor(v);
    const left = m ? m.washes_total - m.washes_used : 0;
    return `<button class="wk-tile" onclick="pickCar(${i})" style="flex-direction:column;align-items:flex-start;">
      ${plate(v.reg_number)}
      ${carLine(v)}
      ${m ? `<span class="wk-chip member" style="margin-top:8px;">⭐ Member · ${left} free wash${left === 1 ? '' : 'es'} left</span>` : ''}
    </button>`;
  }).join('');
}

window.pickCar = function(i) {
  const v = draft.vehicles[i];
  Object.assign(draft, { vehicle: v, reg: v.reg_number, carType: v.car_type, color: v.color || '', model: v.make_model || '' });
  draft.service = memberFor(v) ? 'member' : '';
  go('service');
};

window.startNewCar = function() {
  Object.assign(draft, { vehicle: null, reg: '', carType: '', color: '', model: '', service: '' });
  $('w-reg').value = ''; $('w-model').value = '';
  go('car');
};

// ── Step: new car details ──────────────────────────────────────────────
function renderCarStep() {
  $('w-reg').value = draft.reg;
  $('w-model').value = draft.model;
  $('err-reg').textContent = ''; $('err-type').textContent = '';

  $('w-types').innerHTML = (pricing?.car_types || []).map(ct => {
    const info = carTypeInfo(ct);
    return `<button class="wk-tile ${draft.carType === ct ? 'selected' : ''}" onclick="pickType('${esc(ct).replace(/'/g, '&#39;')}')" data-type="${esc(ct)}">
      <span class="wk-tile-icon">${info.icon}</span><b>${esc(ct)}</b>${info.eg ? `<small>${esc(info.eg)}</small>` : ''}
    </button>`;
  }).join('');

  $('w-colors').innerHTML = COLORS.map(c => `
    <button class="wk-swatch ${draft.color.toLowerCase() === c.name.toLowerCase() ? 'selected' : ''}" onclick="pickColor('${c.name}')">
      <span class="wk-dot" style="background:${c.hex}"></span>${c.name}
    </button>`).join('');
}

window.pickType = function(ct) {
  draft.carType = ct;
  $('err-type').textContent = '';
  document.querySelectorAll('#w-types .wk-tile').forEach(t => t.classList.toggle('selected', t.dataset.type === ct));
};

window.pickColor = function(name) {
  draft.color = draft.color === name ? '' : name;
  document.querySelectorAll('#w-colors .wk-swatch').forEach(s => s.classList.toggle('selected', s.textContent.trim() === draft.color));
};

// Known car number? Fill in its size/colour/name automatically.
$('w-reg').addEventListener('input', () => { $('err-reg').textContent = ''; });
$('w-reg').addEventListener('blur', async () => {
  const reg = normReg($('w-reg').value);
  if (reg.length < 4) return;
  try {
    const r = await api(`/api/customers?reg=${encodeURIComponent(reg)}`);
    const v = r.ok ? await r.json() : null;
    if (!v) return;
    if (v.car_type) pickType(v.car_type);
    if (v.color && !draft.color) {
      draft.color = v.color;
      document.querySelectorAll('#w-colors .wk-swatch').forEach(s => s.classList.toggle('selected', s.textContent.trim().toLowerCase() === v.color.toLowerCase()));
    }
    if (v.make_model && !$('w-model').value) $('w-model').value = v.make_model;
  } catch {}
});

const normReg = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

window.stepCarNext = function() {
  const reg = normReg($('w-reg').value);
  let bad = false;
  if (reg.length < 4) { $('err-reg').textContent = 'Type the car number from the number plate'; bad = true; }
  if (!draft.carType) { $('err-type').textContent = 'Tap the car size'; bad = true; }
  if (bad) return;
  // Maybe this "new" car is one of the customer's saved cars
  const known = draft.vehicles.find(v => normReg(v.reg_number) === reg);
  draft.vehicle = known || null;
  draft.reg = reg;
  draft.model = $('w-model').value.trim();
  draft.service = memberFor(draft.vehicle) ? 'member' : '';
  go('service');
};

// ── Step: service ──────────────────────────────────────────────────────
function addonPrice(a) {
  return pricing?.addon_pricing?.[a.id]?.[draft.carType] ?? a.base_price ?? 0;
}

function renderServiceStep() {
  $('err-wash').textContent = '';
  $('w-car-summary').innerHTML = `${plate(draft.reg)}<span>${carTypeInfo(draft.carType).icon} ${esc(draft.carType)}</span>`;

  const m = memberFor(draft.vehicle);
  if (m) {
    const left = m.washes_total - m.washes_used;
    $('w-member-box').innerHTML = `
      <h2 class="wk-q">⭐ This car is a member</h2>
      <button class="wk-tile member ${draft.service === 'member' ? 'selected' : ''}" onclick="pickService('member')">
        <span class="wk-tile-icon">⭐</span>
        <span class="wk-tile-body"><b>Member wash</b><small>${left} free wash${left === 1 ? '' : 'es'} left this month</small></span>
        <span class="wk-price" style="color:var(--green)">FREE</span>
      </button>`;
    $('w-wash-q').textContent = '🧽 Or a paid wash:';
  } else {
    $('w-member-box').innerHTML = '';
    $('w-wash-q').textContent = '🧽 Which wash?';
  }

  $('w-washes').innerHTML = Object.entries(WASHES).map(([key, w]) => {
    const p = pricing?.wash?.[draft.carType]?.[key];
    return `<button class="wk-tile ${draft.service === key ? 'selected' : ''}" onclick="pickService('${key}')">
      <span class="wk-tile-icon">${w.icon}</span>
      <span class="wk-tile-body"><b>${w.name}</b><small>${w.desc}</small></span>
      <span class="wk-price">${p != null ? rupees(p) : '—'}</span>
    </button>`;
  }).join('');

  $('w-addons').innerHTML = (pricing?.addons || []).map(a => `
    <button class="wk-tile wk-toggle ${draft.addons.has(a.id) ? 'selected' : ''}" style="margin-top:0" onclick="toggleAddon(${a.id})">
      <span class="wk-tile-icon">✨</span>
      <span class="wk-tile-body"><b>${esc(a.name)}</b></span>
      <span class="wk-price">+${rupees(addonPrice(a))}</span>
      <span class="wk-check" aria-hidden="true"></span>
    </button>`).join('');

  $('w-pickup').classList.toggle('selected', draft.pickup);
  $('w-address-wrap').classList.toggle('hidden', !draft.pickup);
  $('w-address').value = draft.address;
}

window.pickService = function(s) { draft.service = s; renderServiceStep(); };
window.toggleAddon = function(id) {
  draft.addons.has(id) ? draft.addons.delete(id) : draft.addons.add(id);
  renderServiceStep();
};
window.togglePickup = function() {
  draft.address = $('w-address').value;
  draft.pickup = !draft.pickup;
  renderServiceStep();
  if (draft.pickup) $('w-address').focus();
};

window.stepServiceNext = function() {
  draft.address = $('w-address').value.trim();
  if (!draft.service) { $('err-wash').textContent = 'Tap one wash'; $('err-wash').scrollIntoView({ block: 'center' }); return; }
  if (draft.pickup && !draft.address) { $('err-wash').textContent = 'Type the pickup address, or turn off pickup'; return; }
  go('review');
};

// ── Step: review ───────────────────────────────────────────────────────
function totals() {
  const lines = [];
  if (draft.service === 'member') lines.push({ ic: '⭐', name: 'Member wash', amt: 0 });
  else {
    const w = WASHES[draft.service];
    lines.push({ ic: w.icon, name: w.name, amt: pricing?.wash?.[draft.carType]?.[draft.service] || 0 });
  }
  (pricing?.addons || []).filter(a => draft.addons.has(a.id))
    .forEach(a => lines.push({ ic: '✨', name: a.name, amt: addonPrice(a) }));
  return { lines, total: lines.reduce((s, l) => s + Number(l.amt || 0), 0) };
}

function renderReview() {
  const { lines, total } = totals();
  const hex = colorHex(draft.color);
  $('w-review').innerHTML = `
    <div class="wk-review-row"><span class="ic">👤</span>${esc(draft.name)} · ${esc(draft.phone)}</div>
    <div class="wk-review-row" style="flex-wrap:wrap">${plate(draft.reg)}
      <span>${hex ? `<span class="wk-dot" style="display:inline-block;vertical-align:middle;background:${hex}"></span> ` : ''}${esc([draft.color, draft.model].filter(Boolean).join(' ') || draft.carType)}</span></div>
    ${lines.map(l => `<div class="wk-review-row"><span class="ic">${l.ic}</span>${esc(l.name)}<span class="amt">${l.amt ? rupees(l.amt) : 'FREE'}</span></div>`).join('')}
    ${draft.pickup ? `<div class="wk-review-row"><span class="ic">🚚</span>Pickup: ${esc(draft.address)}</div>` : ''}
    <div class="wk-total ${total ? '' : 'free'}"><span>${total ? 'Take from customer' : 'Customer pays'}</span><b>${total ? rupees(total) : 'FREE'}</b></div>`;

  // Nothing to collect → no payment question
  $('w-pay-wrap').classList.toggle('hidden', total === 0);
  setPay(draft.pay);
  $('err-save').textContent = '';
}

window.setPay = function(p) {
  draft.pay = p;
  document.querySelectorAll('.wk-pay button').forEach(b => b.classList.toggle('selected', b.dataset.pay === p));
};

// ── Save ───────────────────────────────────────────────────────────────
window.saveCar = async function() {
  const btn = $('w-save'), err = $('err-save');
  err.textContent = '';
  draft.notes = $('w-notes').value.trim();
  const isMember = draft.service === 'member';
  const carType = draft.carType;

  const addons = [], addon_prices = {};
  (pricing?.addons || []).filter(a => draft.addons.has(a.id)).forEach(a => {
    const p = addonPrice(a);
    addons.push({ id: a.id, name: a.name, base_price: p });
    addon_prices[a.id] = p;
  });

  const body = {
    phone: draft.phone,
    name: draft.name,
    reg_number: draft.reg,
    make_model: draft.model,
    color: draft.color,
    car_type: carType,
    // Member washes are recorded as foam; the membership covers the cost
    wash_type: isMember ? 'foam' : draft.service,
    is_monthly: false,
    frequency: null,
    payment_mode: isMember ? 'sub' : draft.pay,
    pickup_drop: draft.pickup,
    pickup_address: draft.pickup ? draft.address : '',
    notes: draft.notes,
    addons, addon_prices,
  };

  // Open WhatsApp now, inside the tap — no awaits before this line,
  // phone browsers block pop-ups that don't open straight away
  const statusUrl = `${location.origin}/status?phone=${encodeURIComponent(draft.phone)}`;
  const carDesc = [draft.color, draft.model].filter(Boolean).join(' ') || carType;
  const msg = settings.tpl_received
    ? fillTemplate(settings.tpl_received, { name: draft.name.split(' ')[0], car: carDesc, reg: draft.reg, status_url: statusUrl, amount: '' })
    : `Hi ${draft.name.split(' ')[0]}! Your ${carDesc} (${draft.reg}) has been checked in at Dhulaai Express 🚗\n\nTrack your car's wash status live here:\n${statusUrl}\n\nThank you for choosing us! 😊`;
  const waWindow = window.open(waLink(`91${draft.phone}`, msg), '_blank', 'noopener');

  btn.disabled = true; btn.textContent = 'Saving…';
  let ok = false, reason = '';
  try {
    const r = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
    ok = r.ok;
    if (!ok) reason = await r.text();
  } catch {
    reason = 'No internet. Check connection and tap Save again.';
  }
  btn.disabled = false; btn.textContent = '✅ Save car';

  if (!ok) {
    if (waWindow) waWindow.close();
    err.textContent = /membership/i.test(reason)
      ? 'This car has no free member wash left. Go back and pick a paid wash.'
      : (reason && reason.length < 120 ? reason : 'Could not save. Try again.');
    return;
  }

  $('w-done-plate').innerHTML = plate(draft.reg);
  history = [];
  show('done');
  loadBoard();
};
