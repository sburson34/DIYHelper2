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
  push: el('push-section'),
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await setupIdentity();
  wireTabs();
  wireBrandScope();
  wireLeads();
  wirePush();
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
  else if (name === 'push') { loadAudience(); loadCampaigns(); updatePreview(); updatePreviewAppName(); }
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

    grid.innerHTML = `
      <div class="kpi"><div class="kpi-label">Total leads</div><div class="kpi-value">${total}</div><div class="kpi-hint">all time</div></div>
      <div class="kpi blue"><div class="kpi-label">New leads</div><div class="kpi-value">${news}</div><div class="kpi-hint">awaiting response</div></div>
      <div class="kpi green"><div class="kpi-label">Opted-in devices</div><div class="kpi-value">${deviceLabel}</div><div class="kpi-hint">${deviceHint}</div></div>
      <div class="kpi"><div class="kpi-label">Campaigns sent</div><div class="kpi-value">${campaignsSent}</div><div class="kpi-hint">push notifications</div></div>`;

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
    renderDetail(data);
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
    <div class="detail-section">
      <h3>Manage lead</h3>
      <div class="edit-form">
        <div class="form-group">
          <label for="edit-status">Status</label>
          <select id="edit-status">
            ${['new', 'in_progress', 'completed', 'cancelled'].map((s) => `<option value="${s}" ${data.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}
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
        <button class="save-btn" id="save-lead-btn" type="button">Save changes</button>
      </div>
    </div>`;
}

function arrTags(title, arr) {
  if (!arr || !arr.length) return '';
  return `<div class="detail-section"><h3>${escapeHtml(title)}</h3><div class="tools-list">${arr.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div></div>`;
}

async function saveChanges() {
  if (!state.currentRequestId) return;
  const status = el('edit-status').value;
  const notes = el('edit-notes').value;
  const followUpDate = el('edit-followup').value || null;
  const btn = el('save-lead-btn');
  btn.disabled = true;
  try {
    const updated = await sendJson(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}`, 'PUT', { status, notes, followUpDate });
    renderDetail(updated);
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
