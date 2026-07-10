'use strict';

/* ── Customer equipment (assets), rendered inside the lead detail ──────────
   Contract:
     GET    /api/assets?brand=&customerEmail=   → list
     POST   /api/assets {brand?, customerEmail, label, make, model, serial}
     PUT    /api/assets/{id} {label, make, model, serial}
     DELETE /api/assets/{id}
   Degrades gracefully while the backend feature is rolling out: a failed list
   shows a muted note instead of an error page. Per-asset job history stays
   customer-app-only for now. */

import { el, escapeHtml, toast } from './ui.js';
import { getJson, sendJson, del } from './api.js';
import { state, brandParam } from './state.js';

// Email of the customer whose equipment is showing (from the open lead).
let currentEmail = '';

export function wireAssets() {
  // #detail-content persists across renders, so one delegated listener works.
  el('detail-content').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-asset-action]');
    if (!btn) return;
    const action = btn.dataset.assetAction;
    if (action === 'add') addAsset(btn);
    else if (action === 'save') saveAsset(btn.dataset.assetId, btn);
    else if (action === 'delete') deleteAsset(btn.dataset.assetId);
  });
}

export async function loadAssetsForLead(lead) {
  const host = el('assets-host');
  if (!host) return;
  currentEmail = String(lead.customerEmail || '').trim();
  if (!currentEmail) {
    host.innerHTML = '<div class="muted">No customer email on this lead — equipment can’t be linked.</div>';
    return;
  }
  host.innerHTML = '<div class="spinner"></div>';
  await reloadAssets();
}

async function reloadAssets() {
  const host = el('assets-host');
  if (!host || !currentEmail) return;
  try {
    const params = new URLSearchParams();
    const bp = brandParam();
    if (bp) params.set('brand', bp);
    params.set('customerEmail', currentEmail);
    const assets = await getJson(`/api/assets?${params.toString()}`);
    renderAssets(Array.isArray(assets) ? assets : []);
  } catch (err) {
    host.innerHTML = '<div class="muted">Equipment tracking is not available yet.</div>';
  }
}

function renderAssets(assets) {
  const host = el('assets-host');
  const addForm = `
    <div class="asset-add">
      <input id="asset-new-label" type="text" placeholder="Label (e.g. Water heater)" maxlength="80">
      <input id="asset-new-make" type="text" placeholder="Make" maxlength="60">
      <input id="asset-new-model" type="text" placeholder="Model" maxlength="60">
      <input id="asset-new-serial" type="text" placeholder="Serial #" maxlength="60">
      <button class="btn ghost" type="button" data-asset-action="add">Add equipment</button>
    </div>`;
  const rows = assets.length ? assets.map((a) => {
    const id = escapeHtml(String(a.id));
    return `
    <div class="tech-card asset-row">
      <div class="asset-fields">
        <input class="asset-input" data-asset-id="${id}" data-field="label" type="text" value="${escapeHtml(a.label || '')}" placeholder="Label" maxlength="80">
        <input class="asset-input" data-asset-id="${id}" data-field="make" type="text" value="${escapeHtml(a.make || '')}" placeholder="Make" maxlength="60">
        <input class="asset-input" data-asset-id="${id}" data-field="model" type="text" value="${escapeHtml(a.model || '')}" placeholder="Model" maxlength="60">
        <input class="asset-input" data-asset-id="${id}" data-field="serial" type="text" value="${escapeHtml(a.serial || '')}" placeholder="Serial #" maxlength="60">
      </div>
      <div class="tech-actions">
        <button class="btn ghost" type="button" data-asset-action="save" data-asset-id="${id}">Save</button>
        <button class="btn danger" type="button" data-asset-action="delete" data-asset-id="${id}">Delete</button>
      </div>
    </div>`;
  }).join('') : '<div class="muted">No equipment on file for this customer yet.</div>';
  host.innerHTML = addForm + rows;
}

function fieldValue(id, field) {
  const input = document.querySelector(`.asset-input[data-asset-id="${id}"][data-field="${field}"]`);
  return input ? input.value.trim() : '';
}

async function addAsset(btn) {
  const label = el('asset-new-label').value.trim();
  if (!label) { toast('Give the equipment a label (e.g. “Water heater”).', 'error'); return; }
  const body = {
    label,
    make: el('asset-new-make').value.trim() || null,
    model: el('asset-new-model').value.trim() || null,
    serial: el('asset-new-serial').value.trim() || null,
    customerEmail: currentEmail,
  };
  if (state.isSuperAdmin && state.brand) body.brand = state.brand;
  btn.disabled = true;
  try {
    await sendJson('/api/assets', 'POST', body);
    toast('Equipment added.', 'success');
    await reloadAssets();
  } catch (err) {
    toast(err.message || 'Could not add equipment.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function saveAsset(id, btn) {
  const label = fieldValue(id, 'label');
  if (!label) { toast('The label can’t be empty.', 'error'); return; }
  const body = {
    label,
    make: fieldValue(id, 'make') || null,
    model: fieldValue(id, 'model') || null,
    serial: fieldValue(id, 'serial') || null,
  };
  btn.disabled = true;
  try {
    await sendJson(`/api/assets/${encodeURIComponent(id)}`, 'PUT', body);
    toast('Equipment saved.', 'success');
    await reloadAssets();
  } catch (err) {
    toast(err.message || 'Could not save equipment.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteAsset(id) {
  const label = fieldValue(id, 'label');
  if (!confirm(`Remove ${label ? `“${label}”` : 'this equipment'} from the customer’s record?`)) return;
  try {
    await del(`/api/assets/${encodeURIComponent(id)}`);
    toast('Equipment removed.', 'success');
    await reloadAssets();
  } catch (err) {
    toast(err.message || 'Could not remove equipment.', 'error');
  }
}
