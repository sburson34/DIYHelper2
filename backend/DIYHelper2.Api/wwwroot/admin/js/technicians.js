'use strict';

/* ── Technicians tab ────────────────────────────────────────────────────── */

import { el, escapeHtml, toast } from './ui.js';
import { getJson, sendJson, del } from './api.js';
import { state, brandParam } from './state.js';

export function wireTechnicians() {
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

// Fetch technicians for the active brand into state.techs (shared by the list,
// the scheduler's assignee picker, and the route view). Returns the array.
export async function loadTechsForBrand() {
  const bp = brandParam();
  try {
    state.techs = await getJson('/api/technicians' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
  } catch (err) {
    state.techs = [];
  }
  return state.techs;
}

export async function loadTechnicians() {
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
  const tech = state.techs.find((x) => String(x.id) === String(id));
  const label = tech && tech.name ? `technician “${tech.name}”` : 'this technician';
  if (!confirm(`Remove ${label}? Their past job assignments are kept.`)) return;
  try {
    await del(`/api/technicians/${encodeURIComponent(id)}`);
    loadTechnicians();
  } catch (err) {
    toast('Could not delete technician.', 'error');
  }
}
