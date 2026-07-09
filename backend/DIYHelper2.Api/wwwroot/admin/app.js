'use strict';

/* ============================================================================
   White-label Owner Console. Vanilla JS, no framework, no inline handlers or
   inline styles (a strict Content-Security-Policy forbids both). Auth is the
   browser's cached HTTP Basic credentials — every fetch is a bare same-origin
   call. All interpolated data is passed through escapeHtml().
   ========================================================================== */

const API = window.location.origin;

const state = {
  section: 'overview',
  isSuperAdmin: false,
  brand: '',                 // selected brand slug (super-admin) or ''
  brandNames: {},            // slug -> companyName
  leadFilter: '',
  currentRequestId: null,
  currentScheduleId: null,
  techs: [],                 // technicians for the active brand (assignee picker)
  priceBook: [],             // price-book items for the active brand (quote builder)
  quoteLines: [],            // working quote lines for the open lead
  pushPlatform: '',
  pushWhen: 'now',
};

const PUSH_TEMPLATES = [
  { label: 'Summer decks', title: 'Summer is deck season ☀️', body: 'A great time to enjoy the outdoors — contact us for a free deck-building quote.' },
  { label: 'Spring cleanup', title: 'Spring cleanup time 🌱', body: 'Book now for gutter cleaning, power washing, and yard prep before the rush.' },
  { label: 'Fall gutters', title: 'Leaves are falling 🍂', body: 'Keep your gutters clear this fall. Ask us about a seasonal maintenance visit.' },
  { label: 'Winter prep', title: 'Winterize your home ❄️', body: 'Seal drafts, protect pipes, and cut heating bills. We can help before the freeze.' },
  { label: 'Limited offer', title: 'Limited-time offer 🏷️', body: 'Save on your next project this month. Tap to see what we can do for your home.' },
];

/* ── DOM refs ──────────────────────────────────────────────────────────── */
const el = (id) => document.getElementById(id);
const sections = {
  overview: el('overview-section'),
  leads: el('leads-section'),
  schedule: el('schedule-section'),
  technicians: el('technicians-section'),
  pricing: el('pricing-section'),
  push: el('push-section'),
  studio: el('studio-section'),
};

// Statuses the operator can move a job through — shared by the leads detail and
// the dispatch scheduler. Order matches the customer-app tracker.
const JOB_STATUSES = ['new', 'scheduled', 'on_the_way', 'in_progress', 'completed', 'cancelled'];
// Jobs in these statuses have left the active work queue and drop off the board.
const BOARD_DONE = ['completed', 'cancelled'];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await setupIdentity();
  wireTabs();
  wireBrandScope();
  wireLeads();
  wireSchedule();
  wireTechnicians();
  wirePricing();
  wirePush();
  wireStudio();
  el('signout').addEventListener('click', signOut);
  renderTemplates();
  showSection('overview');
}

/* ── Identity / brand scope ─────────────────────────────────────────────── */
async function setupIdentity() {
  try {
    const data = await getJson('/api/brands');
    state.isSuperAdmin = !!data.isSuperAdmin;
    const brands = data.brands || [];
    brands.forEach((b) => { state.brandNames[b.slug] = b.companyName; });

    if (state.isSuperAdmin) {
      el('brand-name').textContent = 'Owner Console';
      el('account-name').textContent = 'Operator';
      el('account-role').textContent = 'Super Admin';
      if (brands.length >= 1) {
        const sel = el('brand-select');
        sel.innerHTML = '<option value="">All brands</option>' +
          brands.map((b) => `<option value="${escapeHtml(b.slug)}">${escapeHtml(b.companyName)}</option>`).join('');
        el('brand-scope').classList.remove('hidden');
      }
    } else if (brands.length === 1) {
      const b = brands[0];
      state.brand = b.slug;
      document.title = b.companyName + ' — Owner Console';
      el('brand-name').textContent = b.companyName;
      el('account-name').textContent = b.companyName;
      el('account-role').textContent = 'Company';
    }
  } catch (err) {
    toast('Could not load your account.', 'error');
  }
}

function wireBrandScope() {
  const sel = el('brand-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    state.brand = sel.value;
    // Refresh whichever section is active.
    if (state.section === 'overview') loadOverview();
    else if (state.section === 'leads') loadRequests();
    else if (state.section === 'schedule') loadSchedule();
    else if (state.section === 'technicians') loadTechnicians();
    else if (state.section === 'pricing') loadPricing();
    else if (state.section === 'push') { loadAudience(); loadCampaigns(); updatePreviewAppName(); }
  });
}

/* The effective brand for a scoped call: scoped logins are forced server-side,
   so we only pass a brand for the super-admin's explicit selection. */
function brandParam() {
  return state.isSuperAdmin && state.brand ? state.brand : '';
}

/* ── Tabs / sections ────────────────────────────────────────────────────── */
function wireTabs() {
  el('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    showSection(tab.dataset.section);
  });
}

function showSection(name) {
  state.section = name;
  Object.entries(sections).forEach(([key, node]) => node.classList.toggle('hidden', key !== name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.section === name));
  if (name === 'overview') loadOverview();
  else if (name === 'leads') loadRequests();
  else if (name === 'schedule') loadSchedule();
  else if (name === 'technicians') loadTechnicians();
  else if (name === 'pricing') loadPricing();
  else if (name === 'push') { loadAudience(); loadCampaigns(); updatePreview(); updatePreviewAppName(); }
  else if (name === 'studio') updateStudio();
}

/* ── Overview ───────────────────────────────────────────────────────────── */
async function loadOverview() {
  const grid = el('kpi-grid');
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    const bp = brandParam();
    const leads = await getJson('/api/help-requests' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
    const total = leads.length;
    const news = leads.filter((r) => r.status === 'new').length;

    let deviceLabel = '&mdash;';
    let deviceHint = 'Select a brand';
    if (!state.isSuperAdmin || bp) {
      const aud = await getJson('/api/push/audience' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
      deviceLabel = String(aud.total || 0);
      deviceHint = `${aud.ios || 0} iOS · ${aud.android || 0} Android`;
    }

    let campaignsSent = 0;
    try {
      const camps = await getJson('/api/push/campaigns' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
      campaignsSent = camps.filter((c) => c.status === 'sent').length;
    } catch (e) { /* non-fatal */ }

    // Job-costing KPIs (revenue / margin) when a specific brand is in scope.
    let opsCards = '';
    if (!state.isSuperAdmin || bp) {
      try {
        const ops = await getJson('/api/ops/summary' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
        const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        opsCards = `
      <div class="kpi green"><div class="kpi-label">Revenue</div><div class="kpi-value">${money(ops.revenue)}</div><div class="kpi-hint">approved quotes</div></div>
      <div class="kpi"><div class="kpi-label">Margin</div><div class="kpi-value">${money(ops.margin)}</div><div class="kpi-hint">after labor + parts</div></div>
      <div class="kpi"><div class="kpi-label">Completed jobs</div><div class="kpi-value">${ops.completedJobs}</div><div class="kpi-hint">avg ticket ${money(ops.avgTicket)}</div></div>`;
      } catch (e) { /* ops summary optional */ }
    }

    grid.innerHTML = `
      <div class="kpi"><div class="kpi-label">Total leads</div><div class="kpi-value">${total}</div><div class="kpi-hint">all time</div></div>
      <div class="kpi blue"><div class="kpi-label">New leads</div><div class="kpi-value">${news}</div><div class="kpi-hint">awaiting response</div></div>
      <div class="kpi green"><div class="kpi-label">Opted-in devices</div><div class="kpi-value">${deviceLabel}</div><div class="kpi-hint">${deviceHint}</div></div>
      <div class="kpi"><div class="kpi-label">Campaigns sent</div><div class="kpi-value">${campaignsSent}</div><div class="kpi-hint">push notifications</div></div>
      ${opsCards}`;

    renderCards(el('overview-recent-list'), leads.slice(0, 5), 'No leads yet.');
  } catch (err) {
    grid.innerHTML = '<div class="empty-state"><h2>Could not load overview</h2></div>';
  }
}

/* ── Leads ──────────────────────────────────────────────────────────────── */
function wireLeads() {
  el('lead-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('#lead-filters .filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.leadFilter = btn.dataset.status;
    loadRequests();
  });

  // Delegated click on lead cards.
  el('request-list').addEventListener('click', (e) => {
    const card = e.target.closest('.request-card');
    if (card && card.dataset.id) viewRequest(card.dataset.id);
  });
  el('overview-recent-list').addEventListener('click', (e) => {
    const card = e.target.closest('.request-card');
    if (card && card.dataset.id) { showSection('leads'); viewRequest(card.dataset.id); }
  });

  el('back-btn').addEventListener('click', showLeadList);
  el('delete-btn').addEventListener('click', deleteCurrentRequest);
  el('detail-content').addEventListener('click', (e) => {
    if (e.target.closest('#save-lead-btn')) saveChanges();
    else if (e.target.closest('#quote-add-item')) {
      const sel = el('quote-item');
      const item = state.priceBook.find((p) => String(p.id) === sel.value);
      if (item) { state.quoteLines.push({ description: item.name, amount: item.defaultPrice, quantity: 1 }); renderQuoteLines(); }
    } else if (e.target.closest('#quote-add-custom')) {
      state.quoteLines.push({ description: '', amount: 0, quantity: 1 });
      renderQuoteLines();
    } else if (e.target.closest('.q-remove')) {
      const idx = Number(e.target.closest('.q-remove').dataset.idx);
      // Preserve any in-progress edits, drop the removed row, re-render.
      state.quoteLines = readQuoteLinesFromDom();
      state.quoteLines.splice(idx, 1);
      renderQuoteLines();
    } else if (e.target.closest('#send-quote-btn')) {
      sendQuote();
    } else if (e.target.closest('#sms-send-btn')) {
      sendCustomerSms();
    } else if (e.target.closest('#pay-link-btn')) {
      requestPaymentLink(false);
    } else if (e.target.closest('#pay-sms-btn')) {
      requestPaymentLink(true);
    }
  });
  // Live total as the operator edits line amounts/quantities.
  el('detail-content').addEventListener('input', (e) => {
    if (e.target.closest('#quote-lines')) updateQuoteTotal();
  });
}

async function loadRequests() {
  const list = el('request-list');
  el('detail-panel').classList.add('hidden');
  el('request-list').classList.remove('hidden');
  document.getElementById('lead-filters').classList.remove('hidden');
  list.innerHTML = '<div class="spinner"></div>';

  const params = new URLSearchParams();
  if (state.leadFilter) params.set('status', state.leadFilter);
  const bp = brandParam();
  if (bp) params.set('brand', bp);
  const qs = params.toString();

  try {
    const data = await getJson('/api/help-requests' + (qs ? `?${qs}` : ''));
    renderCards(list, data, 'No leads found for this filter.');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><h2>Error loading leads</h2><p>Could not connect to the API.</p></div>';
  }
}

function renderCards(container, requests, emptyMsg) {
  if (!requests.length) {
    container.innerHTML = `<div class="empty-state"><h2>${escapeHtml(emptyMsg)}</h2></div>`;
    return;
  }
  container.innerHTML = requests.map((r) => `
    <div class="request-card" data-id="${escapeHtml(String(r.id))}">
      <div class="request-card-header">
        <span class="request-card-title">${escapeHtml(r.projectTitle)}</span>
        <span class="status-badge status-${escapeHtml(r.status)}">${escapeHtml((r.status || '').replace('_', ' '))}</span>
      </div>
      ${state.isSuperAdmin && r.brand ? `<div class="brand-chip">${escapeHtml(state.brandNames[r.brand] || r.brand)}</div>` : ''}
      <div class="request-card-info">
        <span>${escapeHtml(r.customerName)}</span>
        <span>${escapeHtml(r.customerEmail)}</span>
        <span>${escapeHtml(r.customerPhone)}</span>
        <span>${escapeHtml(fmtDate(r.createdAt))}</span>
        ${r.followUpDate ? `<span>Follow-up: ${escapeHtml(fmtDate(r.followUpDate))}</span>` : ''}
      </div>
    </div>`).join('');
}

async function viewRequest(id) {
  try {
    const data = await getJson(`/api/help-requests/${encodeURIComponent(id)}`);
    state.currentRequestId = id;
    state.quoteLines = [];               // fresh quote builder per lead
    await loadPriceBookForBrand();       // populate the quote item picker
    renderDetail(data);
    renderQuoteLines();
    loadMessages(id);
    el('request-list').classList.add('hidden');
    document.getElementById('lead-filters').classList.add('hidden');
    el('detail-panel').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast('Failed to load lead details.', 'error');
  }
}

function showLeadList() {
  el('detail-panel').classList.add('hidden');
  el('request-list').classList.remove('hidden');
  document.getElementById('lead-filters').classList.remove('hidden');
  state.currentRequestId = null;
  loadRequests();
}

function renderDetail(data) {
  let projectData = {};
  try { projectData = JSON.parse(data.projectData); } catch (e) { /* ignore */ }
  const steps = (projectData.steps || []).map((s) => (typeof s === 'string' ? s : s.text));

  el('detail-content').innerHTML = `
    <div class="detail-section">
      <h2>${escapeHtml(data.projectTitle)}</h2>
      <span class="status-badge spaced status-${escapeHtml(data.status)}">${escapeHtml((data.status || '').replace('_', ' '))}</span>
      <p class="submitted-at">Submitted ${escapeHtml(fmtDateTime(data.createdAt))}</p>
    </div>
    <div class="detail-section">
      <h3>Customer</h3>
      <div class="customer-info">
        <div class="info-card"><label>Name</label><p>${escapeHtml(data.customerName)}</p></div>
        <div class="info-card"><label>Email</label><p><a class="link" href="mailto:${escapeHtml(data.customerEmail)}">${escapeHtml(data.customerEmail)}</a></p></div>
        <div class="info-card"><label>Phone</label><p><a class="link" href="tel:${escapeHtml(data.customerPhone)}">${escapeHtml(data.customerPhone)}</a></p></div>
      </div>
    </div>
    ${data.userDescription ? `<div class="detail-section"><h3>Description</h3><div class="description-text">${escapeHtml(data.userDescription)}</div></div>` : ''}
    ${safeBase64(data.imageBase64) ? `<div class="detail-section"><h3>Photo</h3><img class="thumbnail" src="data:image/jpeg;base64,${safeBase64(data.imageBase64)}" alt="Project photo"></div>` : ''}
    <div class="detail-section">
      <h3>Project overview</h3>
      <div class="project-overview">
        <div class="overview-stat"><span class="stat-label">Difficulty</span><div class="stat-value">${escapeHtml(projectData.difficulty || 'N/A')}</div></div>
        <div class="overview-stat"><span class="stat-label">Time</span><div class="stat-value">${escapeHtml(projectData.estimated_time || 'N/A')}</div></div>
        <div class="overview-stat"><span class="stat-label">Cost</span><div class="stat-value">${escapeHtml(projectData.estimated_cost || 'N/A')}</div></div>
      </div>
    </div>
    ${steps.length ? `<div class="detail-section"><h3>Steps</h3><div class="steps-list">${steps.map((s, i) => `<div class="step-item"><span class="step-number">${i + 1}</span><span class="step-text">${escapeHtml(s)}</span></div>`).join('')}</div></div>` : ''}
    ${arrTags('Tools & materials', projectData.tools_and_materials)}
    ${arrTags('Safety tips', projectData.safety_tips)}
    ${arrTags('When to call a pro', projectData.when_to_call_pro)}
    ${quoteBuilderHtml(data)}
    <div class="detail-section">
      <h3>Payment</h3>
      ${data.paidAt
        ? `<div class="paid-badge">✓ Paid $${escapeHtml(Number(data.amountPaid || 0).toFixed(2))} on ${escapeHtml(fmtDate(data.paidAt))}</div>`
        : `<div class="pay-actions">
             <button class="btn accent" id="pay-link-btn" type="button">Create payment link</button>
             <button class="btn ghost" id="pay-sms-btn" type="button">Create &amp; text to customer</button>
           </div>
           <div id="pay-link-result" class="pay-link-result"></div>`}
    </div>
    <div class="detail-section">
      <h3>Text customer</h3>
      <div id="sms-log" class="sms-log"></div>
      <div class="sms-compose">
        <textarea id="sms-body" placeholder="Type a text to the customer…" maxlength="480"></textarea>
        <button class="btn accent" id="sms-send-btn" type="button">Send text</button>
      </div>
    </div>
    <div class="detail-section">
      <h3>Manage lead</h3>
      <div class="edit-form">
        <div class="form-group">
          <label for="edit-status">Status</label>
          <select id="edit-status">
            ${JOB_STATUSES.map((s) => `<option value="${s}" ${data.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="edit-notes">Notes</label>
          <textarea id="edit-notes" placeholder="Add private notes about this lead…">${escapeHtml(data.notes || '')}</textarea>
        </div>
        <div class="form-group">
          <label for="edit-followup">Follow-up date</label>
          <input type="date" id="edit-followup" value="${data.followUpDate ? escapeHtml(data.followUpDate.split('T')[0]) : ''}">
        </div>
        <div class="sched-row">
          <div class="form-group">
            <label for="edit-labor">Labor cost</label>
            <div class="price-edit-amt"><span class="price-dollar">$</span><input type="number" min="0" step="0.01" id="edit-labor" value="${data.laborCost != null ? escapeHtml(String(data.laborCost)) : ''}"></div>
          </div>
          <div class="form-group">
            <label for="edit-parts">Parts cost</label>
            <div class="price-edit-amt"><span class="price-dollar">$</span><input type="number" min="0" step="0.01" id="edit-parts" value="${data.partsCost != null ? escapeHtml(String(data.partsCost)) : ''}"></div>
          </div>
        </div>
        ${costingLine(data)}
        <button class="save-btn" id="save-lead-btn" type="button">Save changes</button>
      </div>
    </div>`;
}

function arrTags(title, arr) {
  if (!arr || !arr.length) return '';
  return `<div class="detail-section"><h3>${escapeHtml(title)}</h3><div class="tools-list">${arr.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div></div>`;
}

// Revenue (approved quote) minus labor + parts = margin. Shown live-ish on save.
function costingLine(data) {
  const revenue = data.quoteStatus === 'approved' ? Number(data.quoteTotal || 0) : 0;
  const cost = Number(data.laborCost || 0) + Number(data.partsCost || 0);
  const margin = revenue - cost;
  const cls = margin >= 0 ? 'ok' : 'warn';
  return `<div class="costing-line">Revenue $${revenue.toFixed(2)} · Cost $${cost.toFixed(2)} · <span class="${cls}">Margin $${margin.toFixed(2)}</span></div>`;
}

async function saveChanges() {
  if (!state.currentRequestId) return;
  const status = el('edit-status').value;
  const notes = el('edit-notes').value;
  const followUpDate = el('edit-followup').value || null;
  const laborRaw = el('edit-labor').value.trim();
  const partsRaw = el('edit-parts').value.trim();
  const laborCost = laborRaw === '' ? -1 : parseFloat(laborRaw);
  const partsCost = partsRaw === '' ? -1 : parseFloat(partsRaw);
  const btn = el('save-lead-btn');
  btn.disabled = true;
  try {
    const updated = await sendJson(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}`, 'PUT', { status, notes, followUpDate, laborCost, partsCost });
    state.quoteLines = [];
    await loadPriceBookForBrand();
    renderDetail(updated);
    renderQuoteLines();
    toast('Lead updated.', 'success');
  } catch (err) {
    toast('Failed to save changes.', 'error');
  }
}

async function deleteCurrentRequest() {
  if (!state.currentRequestId) return;
  if (!confirm('Delete this lead? This cannot be undone.')) return;
  try {
    await fetch(`${API}/api/help-requests/${encodeURIComponent(state.currentRequestId)}`, { method: 'DELETE' });
    toast('Lead deleted.', 'success');
    showLeadList();
  } catch (err) {
    toast('Failed to delete lead.', 'error');
  }
}

/* ── Schedule / dispatch board ──────────────────────────────────────────── */
function wireSchedule() {
  // Delegated click on a job card anywhere on the board opens its scheduler.
  el('schedule-board').addEventListener('click', (e) => {
    const card = e.target.closest('.job-card');
    if (card && card.dataset.id) openScheduler(card.dataset.id);
  });
  el('sched-back-btn').addEventListener('click', showBoard);
  el('schedule-editor-content').addEventListener('click', (e) => {
    if (e.target.closest('#sched-save-btn')) saveSchedule();
  });
}

// Local YYYY-MM-DD key for grouping (avoids UTC day-boundary drift).
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadSchedule() {
  showBoard();
  const board = el('schedule-board');
  board.innerHTML = '<div class="spinner"></div>';
  const bp = brandParam();
  // Techs power the assignee picker + the assigned-name chip on each job card.
  if (!(state.isSuperAdmin && !bp)) await loadTechsForBrand(); else state.techs = [];
  try {
    const jobs = await getJson('/api/help-requests' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
    renderBoard(jobs.filter((j) => !BOARD_DONE.includes(j.status)));
  } catch (err) {
    board.innerHTML = '<div class="empty-state"><h2>Could not load the schedule.</h2></div>';
  }
}

function renderBoard(jobs) {
  const board = el('schedule-board');

  // Build the rolling week of day-columns, keyed by local date.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    days.push({ key: dayKey(d), date: d, jobs: [] });
  }
  const byKey = {};
  days.forEach((c) => { byKey[c.key] = c; });

  const unscheduled = [];
  const overdue = [];
  const later = [];
  jobs.forEach((j) => {
    if (!j.scheduledFor) { unscheduled.push(j); return; }
    const d = new Date(j.scheduledFor);
    if (isNaN(d.getTime())) { unscheduled.push(j); return; }
    const k = dayKey(d);
    if (byKey[k]) byKey[k].jobs.push(j);
    else if (d < today) overdue.push(j);
    else later.push(j);
  });

  const byTime = (a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor);
  const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  const columns = [];
  columns.push(boardColumn('Unscheduled', unscheduled, true));
  if (overdue.length) columns.unshift(boardColumn('Overdue', overdue.sort(byTime)));
  days.forEach((c) => columns.push(boardColumn(dayLabel(c.date), c.jobs.sort(byTime))));
  if (later.length) columns.push(boardColumn('Later', later.sort(byTime)));

  board.innerHTML = columns.join('');
}

function boardColumn(title, jobs, isUnscheduled) {
  const cards = jobs.length
    ? jobs.map(jobCard).join('')
    : `<div class="board-empty">${isUnscheduled ? 'Nothing waiting.' : 'No jobs.'}</div>`;
  return `<div class="board-col${isUnscheduled ? ' board-col-unscheduled' : ''}">
    <div class="board-col-head">${escapeHtml(title)}<span class="board-count">${jobs.length}</span></div>
    <div class="board-col-body">${cards}</div>
  </div>`;
}

function jobCard(j) {
  const time = j.scheduledFor
    ? new Date(j.scheduledFor).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : (j.preferredWindow ? escapeHtml(j.preferredWindow) : '');
  const eta = j.status === 'on_the_way' && j.techEtaMinutes != null ? `<span class="job-eta">ETA ${escapeHtml(String(j.techEtaMinutes))}m</span>` : '';
  const tech = j.assignedTechId != null ? (state.techs.find((tt) => tt.id === j.assignedTechId) || null) : null;
  const techChip = tech ? `<div class="job-tech"><span class="job-tech-dot"></span>${escapeHtml(tech.name)}</div>` : '';
  return `<div class="job-card" data-id="${escapeHtml(String(j.id))}">
    <div class="job-card-top">
      ${time ? `<span class="job-time">${escapeHtml(time)}</span>` : ''}
      <span class="status-badge status-${escapeHtml(j.status)}">${escapeHtml((j.status || '').replace(/_/g, ' '))}</span>
    </div>
    <div class="job-title">${escapeHtml(j.projectTitle || 'Service request')}</div>
    ${j.serviceType ? `<div class="job-service">${escapeHtml(j.serviceType)}</div>` : ''}
    <div class="job-customer">${escapeHtml(j.customerName || '')}</div>
    ${techChip}
    ${eta}
  </div>`;
}

function showBoard() {
  el('schedule-editor').classList.add('hidden');
  el('schedule-board').classList.remove('hidden');
  state.currentScheduleId = null;
}

async function openScheduler(id) {
  try {
    const j = await getJson(`/api/help-requests/${encodeURIComponent(id)}`);
    state.currentScheduleId = id;
    renderScheduleEditor(j);
    el('schedule-board').classList.add('hidden');
    el('schedule-editor').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast('Failed to load that job.', 'error');
  }
}

function renderScheduleEditor(j) {
  const sched = j.scheduledFor ? new Date(j.scheduledFor) : null;
  const dateVal = sched && !isNaN(sched.getTime()) ? dayKey(sched) : '';
  const timeVal = sched && !isNaN(sched.getTime())
    ? `${String(sched.getHours()).padStart(2, '0')}:${String(sched.getMinutes()).padStart(2, '0')}` : '';

  el('schedule-editor-content').innerHTML = `
    <div class="detail-section">
      <h2>${escapeHtml(j.projectTitle || 'Service request')}</h2>
      <span class="status-badge spaced status-${escapeHtml(j.status)}">${escapeHtml((j.status || '').replace(/_/g, ' '))}</span>
    </div>
    <div class="detail-section">
      <h3>Customer</h3>
      <div class="customer-info">
        <div class="info-card"><label>Name</label><p>${escapeHtml(j.customerName || '')}</p></div>
        <div class="info-card"><label>Phone</label><p><a class="link" href="tel:${escapeHtml(j.customerPhone || '')}">${escapeHtml(j.customerPhone || '')}</a></p></div>
        ${j.serviceType ? `<div class="info-card"><label>Service</label><p>${escapeHtml(j.serviceType)}</p></div>` : ''}
      </div>
      ${j.preferredWindow || j.preferredDate ? `<p class="submitted-at">Customer preferred: ${escapeHtml(fmtDate(j.preferredDate) || '')} ${escapeHtml(j.preferredWindow || '')}</p>` : ''}
    </div>
    ${j.userDescription ? `<div class="detail-section"><h3>Description</h3><div class="description-text">${escapeHtml(j.userDescription)}</div></div>` : ''}
    <div class="detail-section">
      <h3>Schedule this job</h3>
      <div class="edit-form">
        <div class="sched-row">
          <div class="form-group"><label for="sched-date">Date</label><input type="date" id="sched-date" value="${escapeHtml(dateVal)}"></div>
          <div class="form-group"><label for="sched-time">Time</label><input type="time" id="sched-time" value="${escapeHtml(timeVal)}"></div>
        </div>
        <div class="sched-row">
          <div class="form-group">
            <label for="sched-status">Status</label>
            <select id="sched-status">${JOB_STATUSES.map((s) => `<option value="${s}" ${j.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label for="sched-tech">Assign to</label>
            <select id="sched-tech">
              <option value="">Unassigned</option>
              ${state.techs.filter((tt) => tt.isActive || tt.id === j.assignedTechId).map((tt) => `<option value="${escapeHtml(String(tt.id))}" ${j.assignedTechId === tt.id ? 'selected' : ''}>${escapeHtml(tt.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label for="sched-eta">Tech ETA (minutes) — set when on the way, blank to clear</label>
          <input type="number" id="sched-eta" min="0" max="600" value="${j.techEtaMinutes != null ? escapeHtml(String(j.techEtaMinutes)) : ''}">
        </div>
        <button class="save-btn" id="sched-save-btn" type="button">Save schedule</button>
      </div>
    </div>`;
}

async function saveSchedule() {
  if (!state.currentScheduleId) return;
  const date = el('sched-date').value;
  const time = el('sched-time').value;
  const status = el('sched-status').value;
  const etaRaw = el('sched-eta').value.trim();
  const techVal = el('sched-tech').value;

  const body = { status };
  if (date) body.scheduledFor = new Date(`${date}T${time || '09:00'}`).toISOString();
  // -1 is the backend's explicit "clear" sentinel for both ETA and assignment.
  body.techEtaMinutes = etaRaw === '' ? -1 : Number(etaRaw);
  body.assignedTechId = techVal === '' ? -1 : Number(techVal);

  const btn = el('sched-save-btn');
  btn.disabled = true;
  try {
    await sendJson(`/api/help-requests/${encodeURIComponent(state.currentScheduleId)}`, 'PUT', body);
    toast('Schedule saved. The customer will see it in the app.', 'success');
    loadSchedule();
  } catch (err) {
    toast('Failed to save the schedule.', 'error');
    btn.disabled = false;
  }
}

/* ── Technicians ────────────────────────────────────────────────────────── */
function wireTechnicians() {
  el('tech-add-btn').addEventListener('click', addTechnician);
  el('tech-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tech-action]');
    if (!btn) return;
    const id = btn.dataset.techId;
    const action = btn.dataset.techAction;
    if (action === 'code') regenTechCode(id);
    else if (action === 'toggle') toggleTechActive(id, btn.dataset.techActive === 'true');
    else if (action === 'delete') deleteTechnician(id);
  });
}

// Fetch technicians for the active brand into state.techs (shared by the list
// and the scheduler's assignee picker). Returns the array.
async function loadTechsForBrand() {
  const bp = brandParam();
  try {
    state.techs = await getJson('/api/technicians' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
  } catch (err) {
    state.techs = [];
  }
  return state.techs;
}

async function loadTechnicians() {
  const host = el('tech-list');
  host.innerHTML = '<div class="spinner"></div>';
  if (state.isSuperAdmin && !brandParam()) {
    host.innerHTML = '<div class="empty-state"><h2>Select a brand to manage its technicians.</h2></div>';
    return;
  }
  await loadTechsForBrand();
  renderTechList();
}

function renderTechList() {
  const host = el('tech-list');
  if (!state.techs.length) {
    host.innerHTML = '<div class="empty-state"><h2>No technicians yet.</h2><p>Add your first tech above to give them app access.</p></div>';
    return;
  }
  host.innerHTML = state.techs.map((tt) => `
    <div class="tech-card${tt.isActive ? '' : ' inactive'}">
      <div class="tech-main">
        <div class="tech-name">${escapeHtml(tt.name)}${tt.isActive ? '' : ' <span class="muted">(inactive)</span>'}</div>
        <div class="tech-meta">${escapeHtml(tt.phone || '')}${tt.phone && tt.email ? ' · ' : ''}${escapeHtml(tt.email || '')}</div>
      </div>
      <div class="tech-actions">
        <button class="btn ghost" type="button" data-tech-action="code" data-tech-id="${escapeHtml(String(tt.id))}">${tt.hasCode ? 'New code' : 'Get code'}</button>
        <button class="btn ghost" type="button" data-tech-action="toggle" data-tech-id="${escapeHtml(String(tt.id))}" data-tech-active="${tt.isActive}">${tt.isActive ? 'Deactivate' : 'Activate'}</button>
        <button class="btn danger" type="button" data-tech-action="delete" data-tech-id="${escapeHtml(String(tt.id))}">Delete</button>
      </div>
    </div>`).join('');
}

async function addTechnician() {
  const name = el('tech-name').value.trim();
  if (!name) { toast('Enter the technician’s name.', 'error'); return; }
  if (state.isSuperAdmin && !brandParam()) { toast('Select a brand first.', 'error'); return; }
  const body = { name, phone: el('tech-phone').value.trim() || null, email: el('tech-email').value.trim() || null };
  if (state.isSuperAdmin && state.brand) body.brand = state.brand;
  const btn = el('tech-add-btn');
  btn.disabled = true;
  try {
    const created = await sendJson('/api/technicians', 'POST', body);
    ['tech-name', 'tech-phone', 'tech-email'].forEach((id) => { el(id).value = ''; });
    showTechCode(created.name, created.loginCode);
    loadTechnicians();
  } catch (err) {
    toast(err.message || 'Could not add technician.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function regenTechCode(id) {
  if (!confirm('Generate a new login code? The old one stops working.')) return;
  try {
    const res = await sendJson(`/api/technicians/${encodeURIComponent(id)}/code`, 'POST', {});
    const tech = state.techs.find((x) => String(x.id) === String(id));
    showTechCode(tech ? tech.name : 'Technician', res.loginCode);
    loadTechnicians();
  } catch (err) {
    toast(err.message || 'Could not generate a code.', 'error');
  }
}

// The login code is shown exactly once (server only stores its hash). Persist it
// on screen until dismissed so the owner can write it down / text it to the tech.
function showTechCode(name, code) {
  const host = el('tech-list');
  const banner = document.createElement('div');
  banner.className = 'code-banner';
  banner.innerHTML = `<div><div class="code-label">Login code for ${escapeHtml(name)}</div><div class="code-value">${escapeHtml(code)}</div><div class="code-hint">Share this with the tech — it won’t be shown again.</div></div>`;
  const dismiss = document.createElement('button');
  dismiss.className = 'btn ghost';
  dismiss.type = 'button';
  dismiss.textContent = 'Done';
  dismiss.addEventListener('click', () => banner.remove());
  banner.appendChild(dismiss);
  host.parentNode.insertBefore(banner, host);
}

async function toggleTechActive(id, isActive) {
  try {
    await sendJson(`/api/technicians/${encodeURIComponent(id)}`, 'PUT', { isActive: !isActive });
    loadTechnicians();
  } catch (err) {
    toast(err.message || 'Could not update technician.', 'error');
  }
}

async function deleteTechnician(id) {
  if (!confirm('Remove this technician? Their past job assignments are kept.')) return;
  try {
    await fetch(`${API}/api/technicians/${encodeURIComponent(id)}`, { method: 'DELETE' });
    loadTechnicians();
  } catch (err) {
    toast('Could not delete technician.', 'error');
  }
}

/* ── Pricing / price book ───────────────────────────────────────────────── */
function wirePricing() {
  el('price-add-btn').addEventListener('click', addPriceItem);
  el('qbo-connect-btn').addEventListener('click', connectQuickBooks);
  el('price-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-price-action]');
    if (!btn) return;
    if (btn.dataset.priceAction === 'delete') deletePriceItem(btn.dataset.priceId);
    else if (btn.dataset.priceAction === 'save') savePriceItem(btn.dataset.priceId);
  });
}

async function loadPriceBookForBrand() {
  const bp = brandParam();
  try {
    state.priceBook = await getJson('/api/pricebook' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
  } catch (err) {
    state.priceBook = [];
  }
  return state.priceBook;
}

async function loadPricing() {
  const host = el('price-list');
  host.innerHTML = '<div class="spinner"></div>';
  if (state.isSuperAdmin && !brandParam()) {
    host.innerHTML = '<div class="empty-state"><h2>Select a brand to manage its pricing.</h2></div>';
    return;
  }
  await loadPriceBookForBrand();
  renderPriceList();
  loadQboStatus();
}

// Show the QuickBooks connect bar + current connection state for the active brand.
async function loadQboStatus() {
  const bar = el('qbo-bar');
  const bp = brandParam();
  // Only meaningful for a specific brand (scoped login, or super-admin selection).
  if (state.isSuperAdmin && !bp) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  try {
    const s = await getJson('/api/accounting/status' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
    const status = el('qbo-status');
    const btn = el('qbo-connect-btn');
    if (s.connected) {
      status.textContent = 'Connected — completed jobs sync as invoices';
      status.classList.add('ok');
      btn.textContent = 'Reconnect';
    } else {
      status.textContent = 'Not connected';
      status.classList.remove('ok');
      btn.textContent = 'Connect QuickBooks';
    }
  } catch (err) {
    el('qbo-status').textContent = 'Status unavailable';
  }
}

function connectQuickBooks() {
  const bp = brandParam();
  if (state.isSuperAdmin && !bp) { toast('Select a brand first.', 'error'); return; }
  // OAuth is a browser redirect; open in a new tab so the console stays put.
  window.open(`${API}/api/accounting/qbo/connect${bp ? `?brand=${encodeURIComponent(bp)}` : ''}`, '_blank');
}

function renderPriceList() {
  const host = el('price-list');
  if (!state.priceBook.length) {
    host.innerHTML = '<div class="empty-state"><h2>No price items yet.</h2><p>Add your common services above to speed up quoting.</p></div>';
    return;
  }
  host.innerHTML = state.priceBook.map((p) => `
    <div class="tech-card">
      <div class="tech-main" style="flex:1">
        <input class="price-edit-name" data-price-id="${escapeHtml(String(p.id))}" type="text" value="${escapeHtml(p.name)}" maxlength="80">
      </div>
      <div class="price-edit-amt">
        <span class="price-dollar">$</span>
        <input class="price-edit-price" data-price-id="${escapeHtml(String(p.id))}" type="number" min="0" step="0.01" value="${escapeHtml(String(p.defaultPrice))}">
      </div>
      <div class="tech-actions">
        <button class="btn ghost" type="button" data-price-action="save" data-price-id="${escapeHtml(String(p.id))}">Save</button>
        <button class="btn danger" type="button" data-price-action="delete" data-price-id="${escapeHtml(String(p.id))}">Delete</button>
      </div>
    </div>`).join('');
}

async function addPriceItem() {
  const name = el('price-name').value.trim();
  const amount = parseFloat(el('price-amount').value);
  if (!name) { toast('Enter an item name.', 'error'); return; }
  if (state.isSuperAdmin && !brandParam()) { toast('Select a brand first.', 'error'); return; }
  const body = { name, defaultPrice: isNaN(amount) ? 0 : amount };
  if (state.isSuperAdmin && state.brand) body.brand = state.brand;
  try {
    await sendJson('/api/pricebook', 'POST', body);
    el('price-name').value = ''; el('price-amount').value = '';
    loadPricing();
  } catch (err) {
    toast(err.message || 'Could not add item.', 'error');
  }
}

async function savePriceItem(id) {
  const nameInput = document.querySelector(`.price-edit-name[data-price-id="${id}"]`);
  const priceInput = document.querySelector(`.price-edit-price[data-price-id="${id}"]`);
  const amount = parseFloat(priceInput.value);
  try {
    await sendJson(`/api/pricebook/${encodeURIComponent(id)}`, 'PUT', { name: nameInput.value.trim(), defaultPrice: isNaN(amount) ? 0 : amount });
    toast('Saved.', 'success');
    loadPriceBookForBrand();
  } catch (err) {
    toast(err.message || 'Could not save.', 'error');
  }
}

async function deletePriceItem(id) {
  if (!confirm('Delete this price item?')) return;
  try {
    await fetch(`${API}/api/pricebook/${encodeURIComponent(id)}`, { method: 'DELETE' });
    loadPricing();
  } catch (err) {
    toast('Could not delete item.', 'error');
  }
}

/* ── Quote builder (rendered inside the lead detail) ────────────────────── */
function quoteBuilderHtml(data) {
  const status = data.quoteStatus;
  const statusLine = status
    ? `<div class="quote-status">Current quote: <span class="status-badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>${data.quoteTotal != null ? ` · $${escapeHtml(Number(data.quoteTotal).toFixed(2))}` : ''}</div>`
    : '';
  const options = state.priceBook.filter((p) => p.isActive)
    .map((p) => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name)} — $${escapeHtml(Number(p.defaultPrice).toFixed(2))}</option>`).join('');
  return `
    <div class="detail-section">
      <h3>Quote</h3>
      ${statusLine}
      <div class="quote-add-row">
        <select id="quote-item"><option value="">Add from price book…</option>${options}</select>
        <button class="btn ghost" id="quote-add-item" type="button">Add</button>
        <button class="btn ghost" id="quote-add-custom" type="button">Custom line</button>
      </div>
      <div id="quote-lines" class="quote-lines"></div>
      <div class="quote-total-row">Total: <span id="quote-total">$0.00</span></div>
      <button class="save-btn" id="send-quote-btn" type="button">Send quote to customer</button>
    </div>`;
}

function renderQuoteLines() {
  const host = el('quote-lines');
  if (!host) return;
  host.innerHTML = state.quoteLines.map((l, i) => `
    <div class="quote-line" data-idx="${i}">
      <input class="q-desc" type="text" placeholder="Description" value="${escapeHtml(l.description || '')}">
      <div class="price-edit-amt"><span class="price-dollar">$</span><input class="q-amount" type="number" min="0" step="0.01" value="${escapeHtml(String(l.amount ?? 0))}"></div>
      <input class="q-qty" type="number" min="1" step="1" value="${escapeHtml(String(l.quantity ?? 1))}" title="Quantity">
      <button class="btn ghost q-remove" type="button" data-idx="${i}">✕</button>
    </div>`).join('');
  updateQuoteTotal();
}

function readQuoteLinesFromDom() {
  return Array.from(document.querySelectorAll('#quote-lines .quote-line')).map((row) => ({
    description: row.querySelector('.q-desc').value,
    amount: parseFloat(row.querySelector('.q-amount').value) || 0,
    quantity: parseInt(row.querySelector('.q-qty').value, 10) || 1,
  }));
}

function updateQuoteTotal() {
  const total = readQuoteLinesFromDom().reduce((sum, l) => sum + l.amount * l.quantity, 0);
  const node = el('quote-total');
  if (node) node.textContent = `$${total.toFixed(2)}`;
}

async function sendQuote() {
  const lines = readQuoteLinesFromDom().filter((l) => l.description || l.amount);
  if (!lines.length) { toast('Add at least one line to the quote.', 'error'); return; }
  const btn = el('send-quote-btn');
  btn.disabled = true;
  try {
    await sendJson(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}/quote`, 'PUT', { lines });
    toast('Quote sent — the customer can approve it in the app.', 'success');
    viewRequest(state.currentRequestId);
  } catch (err) {
    toast(err.message || 'Could not send quote.', 'error');
    btn.disabled = false;
  }
}

/* ── Customer SMS (in the lead detail) ──────────────────────────────────── */
async function loadMessages(id) {
  const host = el('sms-log');
  if (!host) return;
  try {
    const msgs = await getJson(`/api/help-requests/${encodeURIComponent(id)}/messages`);
    if (!msgs.length) { host.innerHTML = '<div class="muted sms-empty">No texts yet.</div>'; return; }
    host.innerHTML = msgs.map((m) => `
      <div class="sms-bubble ${m.direction === 'in' ? 'in' : 'out'}${m.sent === false ? ' failed' : ''}">
        <div class="sms-text">${escapeHtml(m.body)}</div>
        <div class="sms-meta">${m.direction === 'in' ? 'Customer' : 'You'} · ${escapeHtml(fmtDateTime(m.createdAt))}${m.sent === false ? ' · not sent' : ''}</div>
      </div>`).join('');
  } catch (err) {
    host.innerHTML = '<div class="muted sms-empty">Could not load messages.</div>';
  }
}

async function sendCustomerSms() {
  const body = el('sms-body').value.trim();
  if (!body) { toast('Type a message first.', 'error'); return; }
  const btn = el('sms-send-btn');
  btn.disabled = true;
  try {
    const res = await sendJson(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}/message`, 'PUT', { body });
    if (res.sent) { toast('Text sent.', 'success'); el('sms-body').value = ''; }
    else toast(res.reason || 'SMS is not configured.', 'error');
    loadMessages(state.currentRequestId);
  } catch (err) {
    toast(err.message || 'Could not send text.', 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ── Collect payment (in the lead detail) ───────────────────────────────── */
async function requestPaymentLink(sendSms) {
  const host = el('pay-link-result');
  const btn = el(sendSms ? 'pay-sms-btn' : 'pay-link-btn');
  btn.disabled = true;
  try {
    const res = await sendJson(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}/payment-link`, 'PUT', { sendSms });
    if (res.available && res.url) {
      host.innerHTML = `<div class="pay-ok">Payment link ready${sendSms ? ' and texted to the customer' : ''}:</div><a class="link pay-url" href="${escapeHtml(res.url)}" target="_blank" rel="noopener">${escapeHtml(res.url)}</a>`;
      if (sendSms) { toast('Payment link texted.', 'success'); loadMessages(state.currentRequestId); }
    } else {
      host.innerHTML = `<div class="muted">${escapeHtml(res.reason || 'Payments are not available.')}</div>`;
    }
  } catch (err) {
    toast(err.message || 'Could not create payment link.', 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ── Push notifications ─────────────────────────────────────────────────── */
function wirePush() {
  ['push-title', 'push-body', 'push-subtitle', 'push-image'].forEach((id) => {
    el(id).addEventListener('input', updatePreview);
  });

  el('platform-seg').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    document.querySelectorAll('#platform-seg .seg').forEach((s) => s.classList.remove('active'));
    seg.classList.add('active');
    state.pushPlatform = seg.dataset.platform;
    loadAudience();
  });

  el('when-seg').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    document.querySelectorAll('#when-seg .seg').forEach((s) => s.classList.remove('active'));
    seg.classList.add('active');
    state.pushWhen = seg.dataset.when;
    el('push-schedule').classList.toggle('hidden', state.pushWhen !== 'later');
  });

  el('template-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.template-chip');
    if (!chip) return;
    const tpl = PUSH_TEMPLATES[Number(chip.dataset.idx)];
    if (!tpl) return;
    el('push-title').value = tpl.title;
    el('push-body').value = tpl.body;
    updatePreview();
  });

  el('send-btn').addEventListener('click', sendPush);
  el('test-btn').addEventListener('click', sendTestPush);
  el('campaign-history').addEventListener('click', (e) => {
    const cancelBtn = e.target.closest('[data-cancel-id]');
    if (cancelBtn) cancelCampaign(cancelBtn.dataset.cancelId);
  });
}

function renderTemplates() {
  el('template-row').innerHTML = PUSH_TEMPLATES
    .map((t, i) => `<button class="template-chip" type="button" data-idx="${i}">${escapeHtml(t.label)}</button>`)
    .join('');
}

function updatePreviewAppName() {
  let name = 'Your app';
  if (!state.isSuperAdmin) {
    const only = Object.values(state.brandNames)[0];
    if (only) name = only;
  } else if (state.brand && state.brandNames[state.brand]) {
    name = state.brandNames[state.brand];
  }
  el('preview-app').textContent = name;
}

function updatePreview() {
  const title = el('push-title').value.trim();
  const body = el('push-body').value.trim();
  const subtitle = el('push-subtitle').value.trim();
  const image = el('push-image').value.trim();

  el('preview-title').textContent = title || 'Title';
  el('preview-body').textContent = body || 'Your message will appear here.';

  const subEl = el('preview-subtitle');
  if (subtitle) { subEl.textContent = subtitle; subEl.classList.remove('hidden'); }
  else { subEl.classList.add('hidden'); }

  const imgEl = el('preview-image');
  if (/^https:\/\//i.test(image)) { imgEl.src = image; imgEl.classList.remove('hidden'); }
  else { imgEl.classList.add('hidden'); imgEl.removeAttribute('src'); }

  el('title-counter').textContent = `${title.length}/100`;
  el('body-counter').textContent = `${body.length}/500`;
}

async function loadAudience() {
  const pill = el('audience-pill');
  const bp = brandParam();
  if (state.isSuperAdmin && !bp) {
    pill.innerHTML = '<span>Select a brand above to see its audience.</span>';
    return;
  }
  try {
    const params = new URLSearchParams();
    if (bp) params.set('brand', bp);
    if (state.pushPlatform) params.set('platform', state.pushPlatform);
    const qs = params.toString();
    const aud = await getJson('/api/push/audience' + (qs ? `?${qs}` : ''));
    pill.innerHTML = `<span class="big">${aud.total || 0}</span><span>opted-in devices${state.pushPlatform ? ' (' + escapeHtml(state.pushPlatform) + ')' : ` · ${aud.ios || 0} iOS, ${aud.android || 0} Android`}</span>`;
  } catch (err) {
    pill.innerHTML = '<span>Could not load audience.</span>';
  }
}

function buildPushPayload() {
  const title = el('push-title').value.trim();
  const body = el('push-body').value.trim();
  const subtitle = el('push-subtitle').value.trim();
  const image = el('push-image').value.trim();
  const link = el('push-link').value.trim();

  const payload = { title, body };
  if (state.isSuperAdmin && state.brand) payload.brand = state.brand;
  if (subtitle) payload.subtitle = subtitle;
  if (image) payload.imageUrl = image;
  if (link) payload.data = { url: link };
  if (state.pushPlatform) payload.platform = state.pushPlatform;
  if (state.pushWhen === 'later') {
    const v = el('push-schedule').value;
    if (v) payload.scheduledFor = new Date(v).toISOString();
  }
  return payload;
}

async function sendPush() {
  const payload = buildPushPayload();
  if (!payload.title || !payload.body) { toast('Title and message are required.', 'error'); return; }
  if (state.isSuperAdmin && !state.brand) { toast('Select a brand to send to.', 'error'); return; }
  if (state.pushWhen === 'later' && !el('push-schedule').value) { toast('Pick a date and time to schedule.', 'error'); return; }

  const btn = el('send-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Sending…';
  try {
    const camp = await sendJson('/api/push/send', 'POST', payload);
    if (camp.status === 'scheduled') toast(`Scheduled for ${fmtDateTime(camp.scheduledFor)}.`, 'success');
    else toast(`Sent to ${camp.recipientCount} device${camp.recipientCount === 1 ? '' : 's'}.`, 'success');
    clearComposer();
    loadCampaigns();
    loadAudience();
  } catch (err) {
    toast(err.message || 'Failed to send.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function sendTestPush() {
  const token = el('test-token').value.trim();
  if (!token) { toast('Paste an Expo push token to test.', 'error'); return; }
  const payload = buildPushPayload();
  if (!payload.title || !payload.body) { toast('Title and message are required.', 'error'); return; }
  payload.token = token;
  delete payload.brand; delete payload.platform; delete payload.scheduledFor;

  const btn = el('test-btn');
  btn.disabled = true;
  try {
    await sendJson('/api/push/test', 'POST', payload);
    toast('Test notification sent.', 'success');
  } catch (err) {
    toast(err.message || 'Test failed.', 'error');
  } finally {
    btn.disabled = false;
  }
}

function clearComposer() {
  ['push-title', 'push-body', 'push-subtitle', 'push-image', 'push-link', 'push-schedule'].forEach((id) => { el(id).value = ''; });
  updatePreview();
}

async function loadCampaigns() {
  const host = el('campaign-history');
  host.innerHTML = '<div class="spinner"></div>';
  const bp = brandParam();
  if (state.isSuperAdmin && !bp) { host.innerHTML = '<div class="empty-state"><h2>Select a brand to see its campaigns.</h2></div>'; return; }
  try {
    const params = new URLSearchParams();
    if (bp) params.set('brand', bp);
    const qs = params.toString();
    const camps = await getJson('/api/push/campaigns' + (qs ? `?${qs}` : ''));
    if (!camps.length) { host.innerHTML = '<div class="empty-state"><h2>No campaigns yet.</h2><p>Your sent and scheduled notifications will appear here.</p></div>'; return; }

    host.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>When</th><th>Title</th><th>Audience</th><th>Status</th><th>Delivery</th><th></th></tr></thead>
      <tbody>${camps.map(campaignRow).join('')}</tbody>
    </table></div>`;
  } catch (err) {
    host.innerHTML = '<div class="empty-state"><h2>Could not load campaigns.</h2></div>';
  }
}

function campaignRow(c) {
  const when = c.status === 'scheduled' ? `Scheduled ${fmtDateTime(c.scheduledFor)}` : fmtDateTime(c.sentAt || c.createdAt);
  const audience = `${c.recipientCount || 0}${c.platform ? ' ' + escapeHtml(c.platform) : ''}`;
  const delivery = c.status === 'sent'
    ? `<div class="delivery-cell"><span class="pill-metric ok">${c.deliveredCount || 0}✓</span><span class="pill-metric bad">${c.failedCount || 0}✗</span></div>`
    : '<span class="muted">—</span>';
  const cancel = c.status === 'scheduled'
    ? `<button class="btn ghost" type="button" data-cancel-id="${escapeHtml(String(c.id))}">Cancel</button>`
    : '';
  return `<tr>
    <td>${escapeHtml(when)}</td>
    <td>${escapeHtml(c.title)}</td>
    <td>${escapeHtml(audience)}</td>
    <td><span class="status-badge status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></td>
    <td>${delivery}</td>
    <td>${cancel}</td>
  </tr>`;
}

async function cancelCampaign(id) {
  if (!confirm('Cancel this scheduled campaign?')) return;
  try {
    await sendJson(`/api/push/campaigns/${encodeURIComponent(id)}/cancel`, 'POST', {});
    toast('Campaign canceled.', 'success');
    loadCampaigns();
  } catch (err) {
    toast(err.message || 'Could not cancel.', 'error');
  }
}

/* ── Brand Studio ───────────────────────────────────────────────────────── */
// Palette math — a compact JS port of app/src/brandPalette.ts so the live
// preview and contrast warnings match exactly what the mobile app will render.
function parseHex(s) {
  if (typeof s !== 'string') return null;
  let h = s.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function normHex(s) {
  const c = parseHex(s);
  if (!c) return null;
  const h = (n) => n.toString(16).padStart(2, '0');
  return ('#' + h(c.r) + h(c.g) + h(c.b)).toUpperCase();
}
function luminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0;
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
function contrast(a, b) {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function mixHex(a, b, w) {
  const ca = parseHex(a); const cb = parseHex(b);
  if (!ca || !cb) return a;
  const h = (n) => Math.round(n).toString(16).padStart(2, '0');
  return ('#' + h(ca.r + (cb.r - ca.r) * w) + h(ca.g + (cb.g - ca.g) * w) + h(ca.b + (cb.b - ca.b) * w)).toUpperCase();
}
function onColorFor(bg) {
  const dark = '#10151F'; const light = '#FFFFFF';
  const cd = contrast(bg, dark); const cl = contrast(bg, light);
  if (cl >= 4.5 && cl >= cd) return light;
  if (cd >= 4.5) return dark;
  return cd >= cl ? dark : light;
}

const studio = { colors: {}, candidates: [], logos: [], selectedLogo: null };

function wireStudio() {
  el('studio-import-btn').addEventListener('click', importFromWebsite);
  el('studio-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') importFromWebsite(); });

  // Keep each color's picker <-> hex text in sync and refresh the preview.
  ['primary', 'secondary', 'accent'].forEach((key) => {
    const text = el(`studio-${key}`);
    const picker = el(`studio-${key}-picker`);
    text.addEventListener('input', () => { const n = normHex(text.value); if (n) picker.value = n; updateStudio(); });
    picker.addEventListener('input', () => { text.value = picker.value.toUpperCase(); updateStudio(); });
  });
  ['studio-name', 'studio-id', 'studio-short', 'studio-privacy', 'studio-terms'].forEach((id) => {
    el(id).addEventListener('input', updateStudio);
  });
  el('studio-font').addEventListener('change', updateStudio);

  el('cand-primary').addEventListener('click', (e) => pickCandidate(e, 'primary'));
  el('cand-secondary').addEventListener('click', (e) => pickCandidate(e, 'secondary'));
  el('cand-accent').addEventListener('click', (e) => pickCandidate(e, 'accent'));
  el('logo-candidates').addEventListener('click', (e) => {
    const img = e.target.closest('.logo-thumb');
    if (!img) return;
    selectLogo(img.dataset.url);
    updateStudio();
  });

  // Icon generator controls.
  const bgText = el('icon-bg'); const bgPicker = el('icon-bg-picker');
  bgText.addEventListener('input', () => { const n = normHex(bgText.value); if (n) bgPicker.value = n; regenIcons(); });
  bgPicker.addEventListener('input', () => { bgText.value = bgPicker.value.toUpperCase(); regenIcons(); });
  el('icon-scale').addEventListener('input', regenIcons);
  el('download-icon-btn').addEventListener('click', () => downloadCanvas('icon-canvas', 'icon.png'));
  el('download-splash-btn').addEventListener('click', () => downloadCanvas('splash-canvas', 'splash.png'));
  el('contrast-note').addEventListener('click', (e) => { if (e.target.closest('#fix-contrast-btn')) fixPrimaryContrast(); });

  el('studio-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(el('studio-json').value).then(
      () => toast('brand.json copied.', 'success'),
      () => toast('Copy failed — select the text manually.', 'error'));
  });
  el('studio-download-btn').addEventListener('click', downloadBrandJson);
}

function pickCandidate(e, key) {
  const sw = e.target.closest('.swatch');
  if (!sw) return;
  el(`studio-${key}`).value = sw.dataset.color;
  el(`studio-${key}-picker`).value = sw.dataset.color;
  updateStudio();
}

function slugify(s) {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function importFromWebsite() {
  const url = el('studio-url').value.trim();
  if (!url) { toast('Enter a website URL.', 'error'); return; }
  const btn = el('studio-import-btn');
  btn.disabled = true; btn.textContent = 'Importing…';
  el('studio-warnings').innerHTML = '';
  try {
    const data = await getJson(`/api/brands/extract?url=${encodeURIComponent(url)}`);
    if (data.companyName) {
      el('studio-name').value = data.companyName;
      el('studio-short').value = data.companyName.split(/\s+/)[0];
      el('studio-id').value = slugify(data.companyName);
    }
    if (data.primary) { el('studio-primary').value = data.primary; el('studio-primary-picker').value = data.primary; }
    if (data.secondary) { el('studio-secondary').value = data.secondary; el('studio-secondary-picker').value = data.secondary; }
    if (data.accent) { el('studio-accent').value = data.accent; el('studio-accent-picker').value = data.accent; }
    if (data.privacyPolicyUrl) el('studio-privacy').value = data.privacyPolicyUrl;
    if (data.termsUrl) el('studio-terms').value = data.termsUrl;

    renderCandidates('cand-primary', data.colorCandidates);
    renderCandidates('cand-secondary', data.colorCandidates);
    renderCandidates('cand-accent', data.colorCandidates);
    renderLogos(data.logoCandidates || []);
    renderFonts(data.fonts || []);
    if ((data.logoCandidates || []).length) selectLogo(data.logoCandidates[0]);

    (data.warnings || []).forEach((w) => {
      const div = document.createElement('div');
      div.className = 'warn-banner';
      div.textContent = w;
      el('studio-warnings').appendChild(div);
    });
    updateStudio();
    toast('Imported. Review and adjust below.', 'success');
  } catch (err) {
    toast(err.message || 'Import failed.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Import';
  }
}

function renderCandidates(hostId, colors) {
  el(hostId).innerHTML = (colors || []).map((c) =>
    `<span class="swatch" data-color="${escapeHtml(c)}" title="${escapeHtml(c)}"></span>`).join('');
  // Swatch fill is a dynamic value → set via CSSOM (allowed under CSP).
  Array.from(el(hostId).children).forEach((sw) => { sw.style.background = sw.dataset.color; });
}

function renderLogos(logos) {
  studio.logos = logos;
  const host = el('logo-candidates');
  if (!logos.length) { host.innerHTML = '<span class="muted">No logos found — upload one manually.</span>'; return; }
  host.innerHTML = logos.map((u) =>
    `<img class="logo-thumb" data-url="${escapeHtml(u)}" src="${escapeHtml(u)}" alt="logo option">`).join('');
}

const BUNDLED_FONTS = ['Inter', 'Poppins', 'Montserrat'];

function mapDetectedFont(fonts) {
  for (const f of fonts) {
    const hit = BUNDLED_FONTS.find((b) => f.toLowerCase().includes(b.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

function renderFonts(fonts) {
  const mapped = mapDetectedFont(fonts || []);
  if (mapped) el('studio-font').value = mapped;
  el('studio-fonts').innerHTML = (fonts && fonts.length)
    ? `Detected on site: ${fonts.map(escapeHtml).join(', ')}` +
      (mapped ? ` → using <b>${escapeHtml(mapped)}</b>` : ' (no bundled match — using System)')
    : '';
}

function currentStudioColors() {
  const primary = normHex(el('studio-primary').value) || '#FCA004';
  const secondary = normHex(el('studio-secondary').value) || '#0A4FA6';
  const accent = normHex(el('studio-accent').value) || '#FDD314';
  return { primary, secondary, accent };
}

function updateStudio() {
  const { primary, secondary, accent } = currentStudioColors();
  const onPrimary = onColorFor(primary);
  const onAccent = onColorFor(accent);
  const name = el('studio-name').value.trim() || 'Your app';

  // Live preview.
  const font = el('studio-font').value;
  el('app-preview').style.fontFamily = font === 'System' ? '' : `'${font}', sans-serif`;
  el('ap-appname').textContent = name;
  el('ap-header').style.background = primary;
  el('ap-appname').style.color = onPrimary;
  const btn = el('ap-btn');
  btn.style.background = primary; btn.style.color = onPrimary;
  const chip = el('ap-chip');
  chip.style.background = mixHex('#FFFFFF', accent, 0.85); chip.style.color = onColorFor(mixHex('#FFFFFF', accent, 0.85));
  el('ap-link').style.color = secondary;

  // Palette strip.
  const cells = [
    ['primary', primary, onPrimary], ['on', onPrimary, primary],
    ['secondary', secondary, onColorFor(secondary)], ['accent', accent, onAccent],
  ];
  el('palette-strip').innerHTML = cells.map(([label, bg, fg]) =>
    `<div class="palette-cell" data-bg="${escapeHtml(bg)}" data-fg="${escapeHtml(fg)}">${escapeHtml(label)}</div>`).join('');
  Array.from(el('palette-strip').children).forEach((c) => { c.style.background = c.dataset.bg; c.style.color = c.dataset.fg; });

  // Contrast guidance.
  const ratio = contrast(onPrimary, primary);
  const note = el('contrast-note');
  if (ratio >= 4.5) {
    note.innerHTML = `<span class="ok">✓ Primary carries accessible text (${ratio.toFixed(1)}:1).</span>`;
  } else {
    note.innerHTML =
      `<span class="warn">⚠ Text on the primary is only ${ratio.toFixed(1)}:1 (AA needs 4.5).</span> ` +
      `<button class="link-btn" id="fix-contrast-btn" type="button">Darken to AA</button>`;
  }

  // Default the icon background to a deep brand tone until the operator sets one.
  if (!el('icon-bg').value) {
    const bg = mixHex(secondary, '#000000', 0.35);
    el('icon-bg').value = bg;
    el('icon-bg-picker').value = bg;
  }
  regenIcons();

  el('studio-json').value = buildBrandJson();
}

// Nudges the primary darker (or lighter) until white/dark text clears AA, then
// writes it back — a one-click fix for the contrast warning.
function fixPrimaryContrast() {
  let primary = currentStudioColors().primary;
  const goDark = luminance(primary) > 0.35; // bright color → darken for white text
  for (let i = 0; i < 24 && contrast(onColorFor(primary), primary) < 4.5; i++) {
    primary = goDark ? mixHex(primary, '#000000', 0.06) : mixHex(primary, '#FFFFFF', 0.06);
  }
  el('studio-primary').value = primary;
  el('studio-primary-picker').value = primary;
  updateStudio();
}

function buildBrandJson() {
  const { primary, secondary, accent } = currentStudioColors();
  const id = slugify(el('studio-id').value || el('studio-name').value) || 'new-brand';
  const config = {
    id,
    name: el('studio-name').value.trim() || 'New Brand',
    slug: id,
    scheme: id.replace(/-/g, ''),
    bundleId: `com.${id.replace(/-/g, '')}.app`,
    companyShortName: el('studio-short').value.trim() || el('studio-name').value.trim() || 'New Brand',
    fontFamily: el('studio-font').value,
    releasePrefix: id,
    privacyPolicyUrl: el('studio-privacy').value.trim() || '',
    termsUrl: el('studio-terms').value.trim() || '',
    colors: { primary, secondary, accent },
    splashBackground: mixHex(secondary, '#000000', 0.35),
    iconBackground: mixHex(secondary, '#000000', 0.35),
    _logoSource: studio.selectedLogo || '',
  };
  return JSON.stringify(config, null, 2);
}

function downloadBrandJson() {
  const id = slugify(el('studio-id').value || el('studio-name').value) || 'brand';
  const blob = new Blob([el('studio-json').value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${id}.brand.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── App-icon generator ──────────────────────────────────────────────────
// Loads the chosen logo through our same-origin image proxy (so the canvas
// isn't cross-origin tainted and can export), composites it onto a square
// brand-colored canvas, and exports store-ready icon.png / splash.png.
const iconState = { logoImg: null };

function selectLogo(url) {
  studio.selectedLogo = url;
  document.querySelectorAll('#logo-candidates .logo-thumb')
    .forEach((t) => t.classList.toggle('selected', t.dataset.url === url));
  loadLogoForIcon(url);
}

function loadLogoForIcon(url) {
  const img = new Image();
  img.onload = () => {
    iconState.logoImg = img;
    el('download-icon-btn').disabled = false;
    el('download-splash-btn').disabled = false;
    el('icon-hint').textContent = 'Adjust the background and logo size, then download.';
    regenIcons();
  };
  img.onerror = () => {
    iconState.logoImg = null;
    el('download-icon-btn').disabled = true;
    el('download-splash-btn').disabled = true;
    el('icon-hint').textContent = 'Could not load that logo — try another candidate or add one by hand.';
  };
  img.src = `${API}/api/brands/proxy-image?url=${encodeURIComponent(url)}`;
}

function currentIconBg() {
  const { secondary } = currentStudioColors();
  return normHex(el('icon-bg').value) || mixHex(secondary, '#000000', 0.35);
}

function regenIcons() {
  if (!iconState.logoImg) return;
  const bg = currentIconBg();
  const frac = Number(el('icon-scale').value) / 100;
  drawBrandIcon(el('icon-canvas'), iconState.logoImg, bg, frac);
  drawBrandIcon(el('splash-canvas'), iconState.logoImg, bg, frac * 0.68); // splash logo sits smaller
}

function drawBrandIcon(canvas, img, bg, fraction) {
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  const box = S * fraction;
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const scale = Math.min(box / iw, box / ih);
  const w = iw * scale; const h = ih * scale;
  try { ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h); } catch (e) { /* invalid/tainted image */ }
}

function downloadCanvas(canvasId, filename) {
  const id = slugify(el('studio-id').value || el('studio-name').value) || 'brand';
  el(canvasId).toBlob((blob) => {
    if (!blob) { toast('Could not export image.', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${id}-${filename}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

/* ── Sign out ───────────────────────────────────────────────────────────── */
function signOut(e) {
  e.preventDefault();
  // Basic Auth has no server-side logout; hitting the endpoint with a bogus
  // credential makes the browser drop its cached ones, then we reload.
  fetch(`${API}/api/brands`, { headers: { Authorization: 'Basic ' + btoa('logout:logout') } })
    .catch(() => {})
    .finally(() => { window.location.reload(); });
}

/* ── HTTP helpers ───────────────────────────────────────────────────────── */
async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw await httpError(res);
  return res.json();
}

async function sendJson(path, method, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res);
  return res.json();
}

async function httpError(res) {
  let msg = `HTTP ${res.status}`;
  try { const b = await res.json(); if (b && b.error) msg = b.error; } catch (e) { /* ignore */ }
  return new Error(msg);
}

/* ── Utilities ──────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// Only emit a base64 string into a data: URI if it's actually base64 (defends
// the attribute against any injected quote/markup — real base64 never has one).
function safeBase64(s) {
  return typeof s === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(s) ? s.replace(/\s+/g, '') : '';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

let toastTimer = null;
function toast(message, type) {
  const host = el('toast-host');
  const node = document.createElement('div');
  node.className = 'toast' + (type ? ` ${type}` : '');
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => { node.remove(); }, 4000);
}
