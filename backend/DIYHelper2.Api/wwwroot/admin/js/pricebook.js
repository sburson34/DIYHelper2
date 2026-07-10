'use strict';

/* ── Pricing tab: flat-rate price book + QuickBooks connection ──────────── */

import { el, escapeHtml, toast } from './ui.js';
import { API, getJson, sendJson, del } from './api.js';
import { state, brandParam } from './state.js';

export function wirePricing() {
  el('price-add-btn').addEventListener('click', addPriceItem);
  el('qbo-connect-btn').addEventListener('click', connectQuickBooks);
  el('price-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-price-action]');
    if (!btn) return;
    if (btn.dataset.priceAction === 'delete') deletePriceItem(btn.dataset.priceId);
    else if (btn.dataset.priceAction === 'save') savePriceItem(btn.dataset.priceId);
  });
}

export async function loadPriceBookForBrand() {
  const bp = brandParam();
  try {
    state.priceBook = await getJson('/api/pricebook' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
  } catch (err) {
    state.priceBook = [];
  }
  return state.priceBook;
}

export async function loadPricing() {
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
  const item = state.priceBook.find((p) => String(p.id) === String(id));
  const label = item && item.name ? `“${item.name}”` : 'this price item';
  if (!confirm(`Delete ${label} from the price book?`)) return;
  try {
    await del(`/api/pricebook/${encodeURIComponent(id)}`);
    loadPricing();
  } catch (err) {
    toast('Could not delete item.', 'error');
  }
}
