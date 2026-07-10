'use strict';

/* ── Inventory tab: truck stock with low-stock flags ────────────────────── */

import { el, escapeHtml, toast } from './ui.js';
import { getJson, sendJson, del } from './api.js';
import { state, brandParam } from './state.js';

// Last-loaded items — lets the delete confirm name the part.
let invItems = [];

export function wireInventory() {
  el('inv-add-btn').addEventListener('click', addInventoryItem);
  el('inv-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-inv-action]');
    if (!btn) return;
    if (btn.dataset.invAction === 'delete') deleteInventoryItem(btn.dataset.invId);
    else if (btn.dataset.invAction === 'save') saveInventoryItem(btn.dataset.invId);
  });
}

export async function loadInventory() {
  const host = el('inv-list');
  host.innerHTML = '<div class="spinner"></div>';
  if (state.isSuperAdmin && !brandParam()) {
    host.innerHTML = '<div class="empty-state"><h2>Select a brand to manage its inventory.</h2></div>';
    return;
  }
  const bp = brandParam();
  let items = [];
  try { items = await getJson('/api/inventory' + (bp ? `?brand=${encodeURIComponent(bp)}` : '')); } catch (e) { items = []; }
  invItems = items;
  if (!items.length) {
    host.innerHTML = '<div class="empty-state"><h2>No inventory yet.</h2><p>Add the parts you keep on the truck.</p></div>';
    return;
  }
  host.innerHTML = items.map((it) => `
    <div class="tech-card${it.low ? ' inv-low' : ''}">
      <div class="tech-main" style="flex:1">
        <div class="tech-name">${escapeHtml(it.name)}${it.low ? ' <span class="inv-low-tag">LOW</span>' : ''}</div>
        <div class="tech-meta">${escapeHtml(it.sku || '')}</div>
      </div>
      <div class="inv-nums">
        <label>Qty <input class="inv-edit-qty" data-inv-id="${escapeHtml(String(it.id))}" type="number" min="0" value="${escapeHtml(String(it.quantity))}"></label>
        <label>Reorder <input class="inv-edit-reorder" data-inv-id="${escapeHtml(String(it.id))}" type="number" min="0" value="${escapeHtml(String(it.reorderAt))}"></label>
      </div>
      <div class="tech-actions">
        <button class="btn ghost" type="button" data-inv-action="save" data-inv-id="${escapeHtml(String(it.id))}">Save</button>
        <button class="btn danger" type="button" data-inv-action="delete" data-inv-id="${escapeHtml(String(it.id))}">Delete</button>
      </div>
    </div>`).join('');
}

async function addInventoryItem() {
  const name = el('inv-name').value.trim();
  if (!name) { toast('Enter a part name.', 'error'); return; }
  if (state.isSuperAdmin && !brandParam()) { toast('Select a brand first.', 'error'); return; }
  const body = { name, sku: el('inv-sku').value.trim() || null, quantity: parseInt(el('inv-qty').value, 10) || 0, reorderAt: parseInt(el('inv-reorder').value, 10) || 0 };
  if (state.isSuperAdmin && state.brand) body.brand = state.brand;
  try {
    await sendJson('/api/inventory', 'POST', body);
    ['inv-name', 'inv-sku', 'inv-qty', 'inv-reorder'].forEach((id) => { el(id).value = ''; });
    loadInventory();
  } catch (err) { toast(err.message || 'Could not add item.', 'error'); }
}

async function saveInventoryItem(id) {
  const qty = parseInt(document.querySelector(`.inv-edit-qty[data-inv-id="${id}"]`).value, 10) || 0;
  const reorder = parseInt(document.querySelector(`.inv-edit-reorder[data-inv-id="${id}"]`).value, 10) || 0;
  try {
    await sendJson(`/api/inventory/${encodeURIComponent(id)}`, 'PUT', { quantity: qty, reorderAt: reorder });
    loadInventory();
  } catch (err) { toast(err.message || 'Could not save.', 'error'); }
}

async function deleteInventoryItem(id) {
  const item = invItems.find((it) => String(it.id) === String(id));
  const label = item && item.name ? `“${item.name}”` : 'this inventory item';
  if (!confirm(`Delete ${label} from inventory?`)) return;
  try {
    await del(`/api/inventory/${encodeURIComponent(id)}`);
    loadInventory();
  } catch (err) { toast('Could not delete item.', 'error'); }
}
