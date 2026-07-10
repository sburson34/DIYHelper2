'use strict';

/* ── Section registry + tab router ─────────────────────────────────────────
   Each tab registers itself with a DOM node and hooks:
     show          — called whenever the section becomes (or re-becomes) active
     onBrandChange — called when the super-admin switches brands while the
                     section is active. `undefined` falls back to `show`;
                     `null` means "do nothing" (e.g. Brand Studio). */

import { el } from './ui.js';
import { state } from './state.js';

const registry = {};

export function registerSection(name, node, hooks) {
  registry[name] = {
    node,
    show: hooks ? hooks.show : undefined,
    onBrandChange: hooks ? hooks.onBrandChange : undefined,
  };
}

export function wireTabs() {
  el('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    showSection(tab.dataset.section);
  });
}

export function showSection(name) {
  const reg = registry[name];
  if (!reg) return;
  state.section = name;
  Object.entries(registry).forEach(([key, r]) => {
    if (r.node) r.node.classList.toggle('hidden', key !== name);
  });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.section === name));
  if (typeof reg.show === 'function') reg.show();
}

/** Re-runs the active section's loader (used after login / brand refresh). */
export function refreshCurrent() {
  showSection(state.section);
}

/** Brand scope changed — refresh the active section's data. */
export function brandChanged() {
  const reg = registry[state.section];
  if (!reg) return;
  if (reg.onBrandChange === null) return; // section opted out
  const fn = reg.onBrandChange !== undefined ? reg.onBrandChange : reg.show;
  if (typeof fn === 'function') fn();
}
