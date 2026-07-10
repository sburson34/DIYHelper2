'use strict';

/* ── Shared DOM + formatting utilities ─────────────────────────────────────
   Small, dependency-free helpers used by every console module. All data that
   ends up inside an HTML template string MUST pass through escapeHtml(). */

export const el = (id) => document.getElementById(id);

/* Entity-escapes text for interpolation into HTML — including attribute
   values, so quotes are escaped too (the old DOM-based trick left `"` alone
   and leaned on CSP to stop attribute breakout; this closes it outright). */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only emit a base64 string into a data: URI if it's actually base64 (defends
// the attribute against any injected quote/markup — real base64 never has one).
export function safeBase64(s) {
  return typeof s === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(s) ? s.replace(/\s+/g, '') : '';
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

// Local YYYY-MM-DD key for grouping (avoids UTC day-boundary drift).
export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toast(message, type) {
  const host = el('toast-host');
  if (!host) return;
  const node = document.createElement('div');
  node.className = 'toast' + (type ? ` ${type}` : '');
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => { node.remove(); }, 4000);
}

/* Standard "could not load" block with an optional Retry button (CSP-safe:
   built via DOM APIs so the retry handler is a real listener). */
export function errorState(host, message, retryFn) {
  if (!host) return;
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';
  const h = document.createElement('h2');
  h.textContent = message;
  wrap.appendChild(h);
  if (typeof retryFn === 'function') {
    const btn = document.createElement('button');
    btn.className = 'btn ghost retry-btn';
    btn.type = 'button';
    btn.textContent = 'Retry';
    btn.addEventListener('click', retryFn);
    wrap.appendChild(btn);
  }
  host.replaceChildren(wrap);
}
