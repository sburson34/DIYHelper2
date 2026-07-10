'use strict';

/* ── Push notifications tab: composer, live preview, campaign history ────── */

import { el, escapeHtml, toast, errorState, fmtDateTime } from './ui.js';
import { getJson, sendJson } from './api.js';
import { state, brandParam } from './state.js';

const PUSH_TEMPLATES = [
  { label: 'Summer decks', title: 'Summer is deck season ☀️', body: 'A great time to enjoy the outdoors — contact us for a free deck-building quote.' },
  { label: 'Spring cleanup', title: 'Spring cleanup time 🌱', body: 'Book now for gutter cleaning, power washing, and yard prep before the rush.' },
  { label: 'Fall gutters', title: 'Leaves are falling 🍂', body: 'Keep your gutters clear this fall. Ask us about a seasonal maintenance visit.' },
  { label: 'Winter prep', title: 'Winterize your home ❄️', body: 'Seal drafts, protect pipes, and cut heating bills. We can help before the freeze.' },
  { label: 'Limited offer', title: 'Limited-time offer 🏷️', body: 'Save on your next project this month. Tap to see what we can do for your home.' },
];

// Last-loaded campaigns — lets the cancel confirm name the campaign.
let lastCampaigns = [];

/** Section-show hook (tab click / post-login refresh). */
export function showPushSection() {
  loadAudience();
  loadCampaigns();
  updatePreview();
  updatePreviewAppName();
}

/** Brand-scope-change hook (matches the old wireBrandScope behavior). */
export function pushBrandChanged() {
  loadAudience();
  loadCampaigns();
  updatePreviewAppName();
}

export function wirePush() {
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

export function renderTemplates() {
  el('template-row').innerHTML = PUSH_TEMPLATES
    .map((t, i) => `<button class="template-chip" type="button" data-idx="${i}">${escapeHtml(t.label)}</button>`)
    .join('');
}

export function updatePreviewAppName() {
  let name = 'Your app';
  if (!state.isSuperAdmin) {
    const only = Object.values(state.brandNames)[0];
    if (only) name = only;
  } else if (state.brand && state.brandNames[state.brand]) {
    name = state.brandNames[state.brand];
  }
  el('preview-app').textContent = name;
}

export function updatePreview() {
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

export async function loadAudience() {
  const pill = el('audience-pill');
  const sendBtn = el('send-btn');
  const bp = brandParam();
  if (state.isSuperAdmin && !bp) {
    pill.innerHTML = '<span>Select a brand above to see its audience.</span>';
    if (sendBtn) sendBtn.disabled = false; // sendPush validates the missing brand
    return;
  }
  try {
    const params = new URLSearchParams();
    if (bp) params.set('brand', bp);
    if (state.pushPlatform) params.set('platform', state.pushPlatform);
    const qs = params.toString();
    const aud = await getJson('/api/push/audience' + (qs ? `?${qs}` : ''));
    const total = aud.total || 0;
    pill.innerHTML = `<span class="big">${total}</span><span>opted-in devices${state.pushPlatform ? ' (' + escapeHtml(state.pushPlatform) + ')' : ` · ${aud.ios || 0} iOS, ${aud.android || 0} Android`}</span>`;
    // Nobody to send to → disable the Send button until the audience changes.
    if (sendBtn) sendBtn.disabled = total === 0;
  } catch (err) {
    pill.innerHTML = '<span>Could not load audience.</span>';
    if (sendBtn) sendBtn.disabled = false;
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

export async function loadCampaigns() {
  const host = el('campaign-history');
  host.innerHTML = '<div class="spinner"></div>';
  const bp = brandParam();
  if (state.isSuperAdmin && !bp) { host.innerHTML = '<div class="empty-state"><h2>Select a brand to see its campaigns.</h2></div>'; return; }
  try {
    const params = new URLSearchParams();
    if (bp) params.set('brand', bp);
    const qs = params.toString();
    const camps = await getJson('/api/push/campaigns' + (qs ? `?${qs}` : ''));
    lastCampaigns = camps;
    if (!camps.length) { host.innerHTML = '<div class="empty-state"><h2>No campaigns yet.</h2><p>Your sent and scheduled notifications will appear here.</p></div>'; return; }

    host.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>When</th><th>Title</th><th>Audience</th><th>Status</th><th>Delivery</th><th></th></tr></thead>
      <tbody>${camps.map(campaignRow).join('')}</tbody>
    </table></div>`;
  } catch (err) {
    errorState(host, 'Could not load campaigns.', loadCampaigns);
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
  const camp = lastCampaigns.find((c) => String(c.id) === String(id));
  const label = camp && camp.title ? `“${camp.title}”` : 'this scheduled campaign';
  if (!confirm(`Cancel ${label}?`)) return;
  try {
    await sendJson(`/api/push/campaigns/${encodeURIComponent(id)}/cancel`, 'POST', {});
    toast('Campaign canceled.', 'success');
    loadCampaigns();
  } catch (err) {
    toast(err.message || 'Could not cancel.', 'error');
  }
}
