'use strict';

/* ── Overview tab: KPIs, next actions, AI review reply, recent leads ─────── */

import { el, escapeHtml, toast, errorState } from './ui.js';
import { getJson, sendJson } from './api.js';
import { state, brandParam } from './state.js';
import { showSection } from './router.js';
import { renderCards, viewRequest } from './leads.js';

export function wireOverview() {
  el('overview-recent-list').addEventListener('click', (e) => {
    const card = e.target.closest('.request-card');
    if (card && card.dataset.id) { showSection('leads'); viewRequest(card.dataset.id); }
  });
  el('review-draft-btn').addEventListener('click', draftReviewReply);
}

export async function loadOverview() {
  const grid = el('kpi-grid');
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    const bp = brandParam();
    const q = bp ? `?brand=${encodeURIComponent(bp)}` : '';
    const scoped = !state.isSuperAdmin || !!bp;

    // Independent calls — fire them all at once. Leads + audience failures are
    // fatal (as before); campaigns and the ops summary are best-effort.
    const [leads, aud, camps, ops] = await Promise.all([
      getJson('/api/help-requests' + q),
      scoped ? getJson('/api/push/audience' + q) : Promise.resolve(null),
      getJson('/api/push/campaigns' + q).catch(() => null),
      scoped ? getJson('/api/ops/summary' + q).catch(() => null) : Promise.resolve(null),
    ]);

    const total = leads.length;
    const news = leads.filter((r) => r.status === 'new').length;

    let deviceLabel = '&mdash;';
    let deviceHint = 'Select a brand';
    if (aud) {
      deviceLabel = String(aud.total || 0);
      deviceHint = `${aud.ios || 0} iOS · ${aud.android || 0} Android`;
    }

    const campaignsSent = camps ? camps.filter((c) => c.status === 'sent').length : 0;

    // Job-costing KPIs (revenue / margin) when a specific brand is in scope.
    let opsCards = '';
    if (ops) {
      const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      opsCards = `
      <div class="kpi green"><div class="kpi-label">Revenue</div><div class="kpi-value">${money(ops.revenue)}</div><div class="kpi-hint">approved quotes</div></div>
      <div class="kpi"><div class="kpi-label">Margin</div><div class="kpi-value">${money(ops.margin)}</div><div class="kpi-hint">after labor + parts</div></div>
      <div class="kpi"><div class="kpi-label">Completed jobs</div><div class="kpi-value">${ops.completedJobs}</div><div class="kpi-hint">avg ticket ${money(ops.avgTicket)}</div></div>
      <div class="kpi"><div class="kpi-label">Booking rate</div><div class="kpi-value">${Number(ops.bookingRate || 0)}%</div><div class="kpi-hint">${ops.bookedJobs} of ${ops.totalLeads} leads</div></div>
      <div class="kpi"><div class="kpi-label">Quote win rate</div><div class="kpi-value">${Number(ops.quoteWinRate || 0)}%</div><div class="kpi-hint">${ops.quotesSent} quotes sent</div></div>
      <div class="kpi"><div class="kpi-label">Outstanding</div><div class="kpi-value">${money(ops.outstandingRevenue)}</div><div class="kpi-hint">unpaid vs ${money(ops.collectedRevenue)} collected</div></div>`;
    }

    grid.innerHTML = `
      <div class="kpi"><div class="kpi-label">Total leads</div><div class="kpi-value">${total}</div><div class="kpi-hint">all time</div></div>
      <div class="kpi blue"><div class="kpi-label">New leads</div><div class="kpi-value">${news}</div><div class="kpi-hint">awaiting response</div></div>
      <div class="kpi green"><div class="kpi-label">Opted-in devices</div><div class="kpi-value">${deviceLabel}</div><div class="kpi-hint">${deviceHint}</div></div>
      <div class="kpi"><div class="kpi-label">Campaigns sent</div><div class="kpi-value">${campaignsSent}</div><div class="kpi-hint">push notifications</div></div>
      ${opsCards}`;

    renderCards(el('overview-recent-list'), leads.slice(0, 5), 'No leads yet.');
    loadNextActions();
  } catch (err) {
    errorState(grid, 'Could not load overview', loadOverview);
  }
}

// Rule-based "what needs attention" rollup.
async function loadNextActions() {
  const host = el('next-actions');
  const bp = brandParam();
  if (state.isSuperAdmin && !bp) { host.classList.add('hidden'); return; }
  try {
    const a = await getJson('/api/ops/next-actions' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
    const items = [
      ['New leads to respond to', a.newLeads],
      ['Quotes to chase (2+ days)', a.quotesToChase],
      ['Completed & unpaid', a.unpaidCompleted],
      ['Scheduled, no tech assigned', a.unassignedScheduled],
      ['Maintenance due soon', a.maintenanceDue],
    ].filter(([, n]) => n > 0);
    if (!items.length) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    host.innerHTML = '<div class="section-head"><h3>Needs your attention</h3></div>' +
      '<div class="todo-row">' +
      items.map(([label, n]) => `<div class="todo-chip"><span class="todo-count">${n}</span>${escapeHtml(label)}</div>`).join('') +
      '</div>';
  } catch (err) {
    host.classList.add('hidden');
  }
}

async function draftReviewReply() {
  const review = el('review-input').value.trim();
  if (!review) { toast('Paste a review first.', 'error'); return; }
  const rating = el('review-rating').value;
  const btn = el('review-draft-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Drafting…';
  try {
    const body = { review };
    if (rating) body.rating = Number(rating);
    const res = await sendJson('/api/ai/review-response', 'POST', body);
    el('review-output').textContent = res.response || '';
  } catch (err) {
    toast(err.message || 'Could not draft a reply.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
