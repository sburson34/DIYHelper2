'use strict';

/* ── Leads tab: list, filters, detail view, SMS, payment, lead editing ─────
   The quote builder inside the detail lives in quotes.js; the customer
   equipment block lives in assets.js. Both render into hosts created here. */

import { el, escapeHtml, toast, errorState, safeBase64, fmtDate, fmtDateTime } from './ui.js';
import { getJson, sendJson, del } from './api.js';
import { state, brandParam, JOB_STATUSES } from './state.js';
import { quoteBuilderHtml, renderQuoteLines, resetQuoteBuilder } from './quotes.js';
import { loadPriceBookForBrand } from './pricebook.js';
import { loadAssetsForLead } from './assets.js';

// Title of the open lead — used to name it in the delete confirmation.
let currentLeadTitle = '';

export function wireLeads() {
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

  el('back-btn').addEventListener('click', showLeadList);
  el('delete-btn').addEventListener('click', deleteCurrentRequest);
  el('detail-content').addEventListener('click', (e) => {
    if (e.target.closest('#save-lead-btn')) saveChanges();
    else if (e.target.closest('#resend-report-btn')) resendReport();
    else if (e.target.closest('#sms-send-btn')) sendCustomerSms();
    else if (e.target.closest('#pay-link-btn')) requestPaymentLink(false);
    else if (e.target.closest('#pay-sms-btn')) requestPaymentLink(true);
  });
}

export async function loadRequests() {
  const list = el('request-list');
  el('detail-panel').classList.add('hidden');
  el('request-list').classList.remove('hidden');
  el('lead-filters').classList.remove('hidden');
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
    errorState(list, 'Error loading leads', loadRequests);
  }
}

export function renderCards(container, requests, emptyMsg) {
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

export async function viewRequest(id) {
  try {
    const data = await getJson(`/api/help-requests/${encodeURIComponent(id)}`);
    state.currentRequestId = id;
    resetQuoteBuilder();                 // fresh quote builder per lead
    await loadPriceBookForBrand();       // populate the quote item picker
    renderDetail(data);
    renderQuoteLines();
    loadMessages(id);
    loadAssetsForLead(data);
    el('request-list').classList.add('hidden');
    el('lead-filters').classList.add('hidden');
    el('detail-panel').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast('Failed to load lead details.', 'error');
  }
}

export function showLeadList() {
  el('detail-panel').classList.add('hidden');
  el('request-list').classList.remove('hidden');
  el('lead-filters').classList.remove('hidden');
  state.currentRequestId = null;
  loadRequests();
}

/* Address card for the Customer grid: street + city/state/zip + a Google Maps
   link. Any subset of the fields renders; absent address renders nothing. */
function addressCardHtml(data) {
  const fullAddress = [data.address, data.city, data.state, data.zip].filter(Boolean).join(', ');
  if (!fullAddress) return '';
  const cityLine = [[data.city, data.state].filter(Boolean).join(', '), data.zip].filter(Boolean).join(' ');
  const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(fullAddress);
  return `<div class="info-card"><label>Address</label>
    <p>${escapeHtml(data.address || '')}${data.address && cityLine ? '<br>' : ''}${escapeHtml(cityLine)}</p>
    <a class="link addr-maps-link" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener">Open in Google Maps</a>
  </div>`;
}

/* Photo: prefer the media proxy URL (same-origin relative path — the session
   cookie rides along on the <img> request); fall back to legacy base64. */
function photoSectionHtml(data) {
  if (typeof data.imageUrl === 'string' && data.imageUrl.startsWith('/')) {
    return `<div class="detail-section"><h3>Photo</h3><img class="thumbnail" src="${escapeHtml(data.imageUrl)}" alt="Project photo"></div>`;
  }
  const b64 = safeBase64(data.imageBase64);
  return b64 ? `<div class="detail-section"><h3>Photo</h3><img class="thumbnail" src="data:image/jpeg;base64,${b64}" alt="Project photo"></div>` : '';
}

function renderDetail(data) {
  let projectData = {};
  try { projectData = JSON.parse(data.projectData); } catch (e) { /* ignore */ }
  const steps = (projectData.steps || []).map((s) => (typeof s === 'string' ? s : s.text));
  currentLeadTitle = data.projectTitle || '';

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
        ${addressCardHtml(data)}
        ${data.serviceType ? `<div class="info-card"><label>Service</label><p>${escapeHtml(data.serviceType)}</p></div>` : ''}
        ${data.preferredWindow || data.preferredDate ? `<div class="info-card"><label>Preferred time</label><p>${escapeHtml([fmtDate(data.preferredDate), data.preferredWindow].filter(Boolean).join(' '))}</p></div>` : ''}
      </div>
    </div>
    <div class="detail-section">
      <h3>Customer equipment</h3>
      <div id="assets-host"><div class="spinner"></div></div>
    </div>
    ${data.userDescription ? `<div class="detail-section"><h3>Description</h3><div class="description-text">${escapeHtml(data.userDescription)}</div></div>` : ''}
    ${photoSectionHtml(data)}
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
        <div class="form-group">
          <label for="edit-maint">Maintenance reminder</label>
          <select id="edit-maint">
            ${[[0, 'None'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Every 12 months']].map(([v, label]) => `<option value="${v}" ${(data.maintenanceIntervalMonths || 0) === v ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        ${costingLine(data)}
        ${data.completedAt ? `<button class="btn ghost" id="resend-report-btn" type="button">${data.reportSentAt ? 'Resend' : 'Send'} job report</button>` : ''}
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
  const maintenanceIntervalMonths = Number(el('edit-maint').value) || 0;
  const btn = el('save-lead-btn');
  btn.disabled = true;
  try {
    const updated = await sendJson(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}`, 'PUT', { status, notes, followUpDate, laborCost, partsCost, maintenanceIntervalMonths });
    resetQuoteBuilder();
    await loadPriceBookForBrand();
    renderDetail(updated);
    renderQuoteLines();
    loadAssetsForLead(updated);
    toast('Lead updated.', 'success');
  } catch (err) {
    toast('Failed to save changes.', 'error');
  }
}

async function deleteCurrentRequest() {
  if (!state.currentRequestId) return;
  const label = currentLeadTitle ? `lead “${currentLeadTitle}”` : 'this lead';
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
  try {
    await del(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}`);
    toast('Lead deleted.', 'success');
    showLeadList();
  } catch (err) {
    toast('Failed to delete lead.', 'error');
  }
}

/* ── Customer SMS (in the lead detail) ──────────────────────────────────── */
export async function loadMessages(id) {
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

async function resendReport() {
  try {
    const res = await sendJson(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}/report`, 'PUT', {});
    toast(res.sent ? 'Report emailed to the customer.' : (res.reason || 'Could not send report.'), res.sent ? 'success' : 'error');
  } catch (err) {
    toast(err.message || 'Could not send report.', 'error');
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
