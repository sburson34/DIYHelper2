'use strict';

/* ── Quote builder (rendered inside the lead detail) ───────────────────────
   Supports tiered Good/Better/Best quotes: up to 3 named options, each with
   its own line items. A single unnamed option serializes to the legacy
   {lines:[...]} payload (full back-compat); 2–3 options serialize to
   {options:[{name, lines}]} for PUT /api/help-requests/{id}/quote. */

import { el, escapeHtml, toast } from './ui.js';
import { sendJson } from './api.js';
import { state } from './state.js';
import { viewRequest } from './leads.js';

const OPTION_NAME_DEFAULTS = ['Good', 'Better', 'Best'];
const MAX_OPTIONS = 3;

// Working options for the open lead. Index 0 always exists.
let quoteOptions = [{ name: '', lines: [] }];
let activeOption = 0;

export function resetQuoteBuilder() {
  quoteOptions = [{ name: '', lines: [] }];
  activeOption = 0;
}

export function wireQuotes() {
  el('detail-content').addEventListener('click', (e) => {
    if (e.target.closest('#quote-add-item')) {
      const sel = el('quote-item');
      const item = state.priceBook.find((p) => String(p.id) === sel.value);
      if (item) {
        syncActiveFromDom();
        quoteOptions[activeOption].lines.push({ description: item.name, amount: item.defaultPrice, quantity: 1 });
        renderQuoteLines();
      }
    } else if (e.target.closest('#quote-add-custom')) {
      syncActiveFromDom();
      quoteOptions[activeOption].lines.push({ description: '', amount: 0, quantity: 1 });
      renderQuoteLines();
    } else if (e.target.closest('.q-remove')) {
      const idx = Number(e.target.closest('.q-remove').dataset.idx);
      // Preserve any in-progress edits, drop the removed row, re-render.
      syncActiveFromDom();
      quoteOptions[activeOption].lines.splice(idx, 1);
      renderQuoteLines();
    } else if (e.target.closest('#quote-suggest-ai')) {
      suggestQuoteWithAi();
    } else if (e.target.closest('#send-quote-btn')) {
      sendQuote();
    } else if (e.target.closest('#quote-add-option')) {
      addOption();
    } else if (e.target.closest('.quote-tab-x')) {
      removeOption(Number(e.target.closest('.quote-tab-x').dataset.removeOpt));
    } else if (e.target.closest('.quote-tab[data-opt]')) {
      switchOption(Number(e.target.closest('.quote-tab[data-opt]').dataset.opt));
    }
  });
  // Live total as the operator edits line amounts/quantities; live rename of
  // the active option tab.
  el('detail-content').addEventListener('input', (e) => {
    if (e.target.closest('#quote-lines')) updateQuoteTotal();
    else if (e.target.classList.contains('quote-tab-name')) quoteOptions[activeOption].name = e.target.value;
  });
}

/* ── Static detail markup ───────────────────────────────────────────────── */

function parseQuoteOptions(data) {
  let opts = data.quoteOptions;
  if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch (e) { opts = null; } }
  return Array.isArray(opts) && opts.length ? opts : null;
}

/* Read-only view of the quote that's already on the lead (tiered or legacy),
   including which option the customer approved. */
function existingQuoteHtml(data) {
  const opts = parseQuoteOptions(data);
  if (!opts) return '';
  return `<div class="quote-options-view">` + opts.map((o) => {
    const total = o.total != null ? Number(o.total) : optionTotal(o.lines);
    const approved = data.quoteSelectedOption && o.name === data.quoteSelectedOption;
    return `<div class="quote-option-row">
      <span class="quote-option-name">${escapeHtml(o.name || 'Option')}${approved ? ' <span class="quote-approved-tag">✓ approved</span>' : ''}</span>
      <span class="quote-option-total">$${escapeHtml(total.toFixed(2))}</span>
    </div>`;
  }).join('') + '</div>';
}

export function quoteBuilderHtml(data) {
  const status = data.quoteStatus;
  const approvedNote = status === 'approved' && data.quoteSelectedOption
    ? ` · accepted “${escapeHtml(data.quoteSelectedOption)}”` : '';
  const statusLine = status
    ? `<div class="quote-status">Current quote: <span class="status-badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>${data.quoteTotal != null ? ` · $${escapeHtml(Number(data.quoteTotal).toFixed(2))}` : ''}${approvedNote}</div>`
    : '';
  const options = state.priceBook.filter((p) => p.isActive)
    .map((p) => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name)} — $${escapeHtml(Number(p.defaultPrice).toFixed(2))}</option>`).join('');
  return `
    <div class="detail-section">
      <h3>Quote</h3>
      ${statusLine}
      ${existingQuoteHtml(data)}
      <div id="quote-tabs-host"></div>
      <div class="quote-add-row">
        <select id="quote-item"><option value="">Add from price book…</option>${options}</select>
        <button class="btn ghost" id="quote-add-item" type="button">Add</button>
        <button class="btn ghost" id="quote-add-custom" type="button">Custom line</button>
        <button class="btn ghost" id="quote-suggest-ai" type="button">✨ Suggest with AI</button>
      </div>
      <div id="quote-lines" class="quote-lines"></div>
      <div class="quote-total-row">Total: <span id="quote-total">$0.00</span></div>
      <button class="save-btn" id="send-quote-btn" type="button">Send quote to customer</button>
    </div>`;
}

/* ── Option tabs ────────────────────────────────────────────────────────── */

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function quoteTabsHtml() {
  const addBtn = quoteOptions.length < MAX_OPTIONS
    ? `<button class="btn ghost quote-add-option" id="quote-add-option" type="button">+ Add option</button>`
    : '';
  if (quoteOptions.length === 1) {
    // Single (legacy) quote — no tab chrome, just the option to tier it.
    return `<div class="quote-tabs">${addBtn}</div>`;
  }
  const tabs = quoteOptions.map((o, i) => {
    const total = money(optionTotal(o.lines));
    if (i === activeOption) {
      return `<span class="quote-tab active">
        <input class="quote-tab-name" type="text" value="${escapeHtml(o.name)}" maxlength="30" placeholder="Option ${i + 1}" aria-label="Option name">
        <span class="quote-tab-total">${escapeHtml(total)}</span>
        <button class="quote-tab-x" type="button" data-remove-opt="${i}" title="Remove this option">✕</button>
      </span>`;
    }
    return `<button class="quote-tab" type="button" data-opt="${i}">${escapeHtml(o.name || `Option ${i + 1}`)}<span class="quote-tab-total">${escapeHtml(total)}</span></button>`;
  }).join('');
  return `<div class="quote-tabs">${tabs}${addBtn}</div>`;
}

function addOption() {
  if (quoteOptions.length >= MAX_OPTIONS) return;
  syncActiveFromDom();
  // First tab picks up "Good" only once a second option exists.
  if (quoteOptions.length === 1 && !quoteOptions[0].name) quoteOptions[0].name = OPTION_NAME_DEFAULTS[0];
  quoteOptions.push({ name: OPTION_NAME_DEFAULTS[quoteOptions.length] || '', lines: [] });
  activeOption = quoteOptions.length - 1;
  renderQuoteLines();
}

function removeOption(i) {
  if (quoteOptions.length <= 1 || i < 0 || i >= quoteOptions.length) return;
  syncActiveFromDom();
  quoteOptions.splice(i, 1);
  if (activeOption >= quoteOptions.length) activeOption = quoteOptions.length - 1;
  else if (i < activeOption) activeOption -= 1;
  renderQuoteLines();
}

function switchOption(i) {
  if (i === activeOption || i < 0 || i >= quoteOptions.length) return;
  syncActiveFromDom();
  activeOption = i;
  renderQuoteLines();
}

/** Pull any in-progress DOM edits back into the active option. */
function syncActiveFromDom() {
  if (el('quote-lines')) quoteOptions[activeOption].lines = readQuoteLinesFromDom();
}

/* ── Line editor ────────────────────────────────────────────────────────── */

export function renderQuoteLines() {
  const tabsHost = el('quote-tabs-host');
  if (tabsHost) tabsHost.innerHTML = quoteTabsHtml();
  const host = el('quote-lines');
  if (!host) return;
  host.innerHTML = quoteOptions[activeOption].lines.map((l, i) => `
    <div class="quote-line" data-idx="${i}">
      <input class="q-desc" type="text" placeholder="Description" value="${escapeHtml(l.description || '')}">
      <div class="price-edit-amt"><span class="price-dollar">$</span><input class="q-amount" type="number" min="0" step="0.01" value="${escapeHtml(String(l.amount ?? 0))}"></div>
      <input class="q-qty" type="number" min="1" step="1" value="${escapeHtml(String(l.quantity ?? 1))}" title="Quantity">
      <button class="btn ghost q-remove" type="button" data-idx="${i}">✕</button>
    </div>`).join('');
  updateQuoteTotal();
}

export function readQuoteLinesFromDom(root = document) {
  return Array.from(root.querySelectorAll('#quote-lines .quote-line')).map((row) => ({
    description: row.querySelector('.q-desc').value,
    amount: parseFloat(row.querySelector('.q-amount').value) || 0,
    quantity: parseInt(row.querySelector('.q-qty').value, 10) || 1,
  }));
}

export function optionTotal(lines) {
  return (lines || []).reduce((sum, l) => sum + (Number(l.amount) || 0) * (Number(l.quantity) || 1), 0);
}

export function updateQuoteTotal() {
  const total = optionTotal(readQuoteLinesFromDom());
  const node = el('quote-total');
  if (node) node.textContent = `$${total.toFixed(2)}`;
  // Keep the active tab's chip in sync while typing.
  const tabTotal = document.querySelector('#quote-tabs-host .quote-tab.active .quote-tab-total');
  if (tabTotal) tabTotal.textContent = `$${total.toFixed(2)}`;
}

/* ── Serialization (pure — unit-tested in backend/console-tests) ────────── */

/** One option → legacy {lines}; several → {options:[{name, lines}]}. Empty
    lines are dropped; blank option names get positional defaults. */
export function serializeQuotePayload(options) {
  const opts = (options || []).map((o) => ({
    name: String(o.name || '').trim(),
    lines: (o.lines || []).filter((l) => l.description || l.amount),
  }));
  if (opts.length <= 1) return { lines: opts.length ? opts[0].lines : [] };
  opts.forEach((o, i) => { if (!o.name) o.name = `Option ${i + 1}`; });
  return { options: opts };
}

/* ── Actions ────────────────────────────────────────────────────────────── */

async function suggestQuoteWithAi() {
  const btn = el('quote-suggest-ai');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Thinking…';
  try {
    const res = await sendJson(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}/suggest-quote`, 'PUT', {});
    const lines = (res.lines || []).filter((l) => l.description || l.amount);
    if (!lines.length) { toast('AI had no suggestions.', 'error'); return; }
    // Merge current edits, append AI suggestions to the active option.
    syncActiveFromDom();
    quoteOptions[activeOption].lines = quoteOptions[activeOption].lines.concat(
      lines.map((l) => ({ description: l.description, amount: l.amount, quantity: l.quantity || 1 })));
    renderQuoteLines();
    toast(`Added ${lines.length} AI-suggested line${lines.length === 1 ? '' : 's'}. Review before sending.`, 'success');
  } catch (err) {
    toast(err.message || 'AI suggestion failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function sendQuote() {
  syncActiveFromDom();
  const payload = serializeQuotePayload(quoteOptions);
  if (payload.lines) {
    if (!payload.lines.length) { toast('Add at least one line to the quote.', 'error'); return; }
  } else {
    for (const o of payload.options) {
      if (!o.lines.length) { toast(`Add at least one line to “${o.name}”.`, 'error'); return; }
    }
    const names = payload.options.map((o) => o.name.toLowerCase());
    if (new Set(names).size !== names.length) { toast('Give each option a different name.', 'error'); return; }
  }
  const btn = el('send-quote-btn');
  btn.disabled = true;
  try {
    await sendJson(`/api/help-requests/${encodeURIComponent(state.currentRequestId)}/quote`, 'PUT', payload);
    toast('Quote sent — the customer can approve it in the app.', 'success');
    viewRequest(state.currentRequestId);
  } catch (err) {
    toast(err.message || 'Could not send quote.', 'error');
    btn.disabled = false;
  }
}
