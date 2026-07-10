'use strict';

/* ── Shared console state + identity/brand scope ─────────────────────────── */

import { el, escapeHtml, toast } from './ui.js';
import { getJson } from './api.js';

export const state = {
  section: 'overview',
  isSuperAdmin: false,
  brand: '',                 // selected brand slug (super-admin) or the scoped brand
  brandNames: {},            // slug -> companyName
  leadFilter: '',
  currentRequestId: null,
  currentScheduleId: null,
  techs: [],                 // technicians for the active brand (assignee picker)
  priceBook: [],             // price-book items for the active brand (quote builder)
  pushPlatform: '',
  pushWhen: 'now',
};

// Statuses the operator can move a job through — shared by the leads detail and
// the dispatch scheduler. Order matches the customer-app tracker.
export const JOB_STATUSES = ['new', 'scheduled', 'on_the_way', 'in_progress', 'completed', 'cancelled'];
// Jobs in these statuses have left the active work queue and drop off the board.
export const BOARD_DONE = ['completed', 'cancelled'];

/* The effective brand for a scoped call: scoped logins are forced server-side,
   so we only pass a brand for the super-admin's explicit selection. */
export function brandParam() {
  return state.isSuperAdmin && state.brand ? state.brand : '';
}

/* Identity bootstrap. `session` is the GET/POST /admin/session payload
   ({isSuperAdmin, brand}) — the source of truth for role + scoped brand.
   /api/brands still supplies the display names + the super-admin selector. */
export async function setupIdentity(session) {
  if (session) {
    state.isSuperAdmin = !!session.isSuperAdmin;
    if (!state.isSuperAdmin && session.brand) state.brand = session.brand;
  }
  try {
    const data = await getJson('/api/brands');
    if (!session) state.isSuperAdmin = !!data.isSuperAdmin;
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
        // Restore a previous selection if it still exists (e.g. after re-login).
        if (state.brand) {
          sel.value = state.brand;
          if (sel.value !== state.brand) { state.brand = ''; sel.value = ''; }
        }
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

/* Brand selector (super-admin). `onChange` refreshes whichever section is
   active — wired to router.brandChanged() by the bootstrap. */
export function wireBrandScope(onChange) {
  const sel = el('brand-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    state.brand = sel.value;
    if (typeof onChange === 'function') onChange();
  });
}
