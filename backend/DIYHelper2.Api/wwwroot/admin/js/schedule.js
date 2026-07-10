'use strict';

/* ── Schedule tab: dispatch board, job scheduler, tech route view, and the
   online-booking availability settings card. ─────────────────────────────── */

import { el, escapeHtml, toast, errorState, fmtDate, dayKey } from './ui.js';
import { getJson, sendJson } from './api.js';
import { state, brandParam, JOB_STATUSES, BOARD_DONE } from './state.js';
import { loadTechsForBrand } from './technicians.js';

export function wireSchedule() {
  // Delegated click on a job card anywhere on the board opens its scheduler.
  el('schedule-board').addEventListener('click', (e) => {
    const card = e.target.closest('.job-card');
    if (card && card.dataset.id) openScheduler(card.dataset.id);
  });
  el('sched-back-btn').addEventListener('click', showBoard);
  el('schedule-editor-content').addEventListener('click', (e) => {
    if (e.target.closest('#sched-save-btn')) saveSchedule();
    else if (e.target.closest('#sched-suggest-tech')) suggestTech(e.target.closest('#sched-suggest-tech').dataset.job);
  });

  // Route view.
  el('route-show-btn').addEventListener('click', showRoute);

  // Availability card (rendered into its host; delegate events).
  const avHost = el('availability-host');
  avHost.addEventListener('click', (e) => {
    if (e.target.closest('#av-save-btn')) saveAvailability();
  });
  avHost.addEventListener('change', (e) => {
    if (!e.target.classList.contains('av-on')) return;
    const day = e.target.dataset.day;
    const on = e.target.checked;
    avHost.querySelectorAll(`.av-start[data-day="${day}"], .av-end[data-day="${day}"]`)
      .forEach((inp) => { inp.disabled = !on; });
  });
}

async function suggestTech(jobId) {
  try {
    const res = await getJson(`/api/help-requests/${encodeURIComponent(jobId)}/suggest-tech`);
    if (res.techId) {
      el('sched-tech').value = String(res.techId);
      toast(`Suggested ${res.name} (${res.currentJobs} open job${res.currentJobs === 1 ? '' : 's'}).`, 'success');
    } else {
      toast(res.reason || 'No technician to suggest.', 'error');
    }
  } catch (err) {
    toast('Could not suggest a technician.', 'error');
  }
}

export async function loadSchedule() {
  showBoard();
  const board = el('schedule-board');
  board.innerHTML = '<div class="spinner"></div>';
  const bp = brandParam();
  const scoped = !(state.isSuperAdmin && !bp);
  // Techs power the assignee picker + the assigned-name chip on each job card.
  if (scoped) await loadTechsForBrand(); else state.techs = [];
  updateRouteCard(scoped);
  loadAvailability();
  try {
    const jobs = await getJson('/api/help-requests' + (bp ? `?brand=${encodeURIComponent(bp)}` : ''));
    renderBoard(jobs.filter((j) => !BOARD_DONE.includes(j.status)));
  } catch (err) {
    errorState(board, 'Could not load the schedule.', loadSchedule);
  }
}

function renderBoard(jobs) {
  const board = el('schedule-board');

  // Build the rolling week of day-columns, keyed by local date.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    days.push({ key: dayKey(d), date: d, jobs: [] });
  }
  const byKey = {};
  days.forEach((c) => { byKey[c.key] = c; });

  const unscheduled = [];
  const overdue = [];
  const later = [];
  jobs.forEach((j) => {
    if (!j.scheduledFor) { unscheduled.push(j); return; }
    const d = new Date(j.scheduledFor);
    if (isNaN(d.getTime())) { unscheduled.push(j); return; }
    const k = dayKey(d);
    if (byKey[k]) byKey[k].jobs.push(j);
    else if (d < today) overdue.push(j);
    else later.push(j);
  });

  const byTime = (a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor);
  const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  const columns = [];
  columns.push(boardColumn('Unscheduled', unscheduled, true));
  if (overdue.length) columns.unshift(boardColumn('Overdue', overdue.sort(byTime)));
  days.forEach((c) => columns.push(boardColumn(dayLabel(c.date), c.jobs.sort(byTime))));
  if (later.length) columns.push(boardColumn('Later', later.sort(byTime)));

  board.innerHTML = columns.join('');
}

function boardColumn(title, jobs, isUnscheduled) {
  const cards = jobs.length
    ? jobs.map(jobCard).join('')
    : `<div class="board-empty">${isUnscheduled ? 'Nothing waiting.' : 'No jobs.'}</div>`;
  return `<div class="board-col${isUnscheduled ? ' board-col-unscheduled' : ''}">
    <div class="board-col-head">${escapeHtml(title)}<span class="board-count">${jobs.length}</span></div>
    <div class="board-col-body">${cards}</div>
  </div>`;
}

function jobCard(j) {
  const time = j.scheduledFor
    ? new Date(j.scheduledFor).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : (j.preferredWindow ? escapeHtml(j.preferredWindow) : '');
  const eta = j.status === 'on_the_way' && j.techEtaMinutes != null ? `<span class="job-eta">ETA ${escapeHtml(String(j.techEtaMinutes))}m</span>` : '';
  const tech = j.assignedTechId != null ? (state.techs.find((tt) => tt.id === j.assignedTechId) || null) : null;
  const techChip = tech ? `<div class="job-tech"><span class="job-tech-dot"></span>${escapeHtml(tech.name)}</div>` : '';
  return `<div class="job-card" data-id="${escapeHtml(String(j.id))}">
    <div class="job-card-top">
      ${time ? `<span class="job-time">${escapeHtml(time)}</span>` : ''}
      <span class="status-badge status-${escapeHtml(j.status)}">${escapeHtml((j.status || '').replace(/_/g, ' '))}</span>
    </div>
    <div class="job-title">${escapeHtml(j.projectTitle || 'Service request')}</div>
    ${j.serviceType ? `<div class="job-service">${escapeHtml(j.serviceType)}</div>` : ''}
    <div class="job-customer">${escapeHtml(j.customerName || '')}</div>
    ${techChip}
    ${eta}
  </div>`;
}

function showBoard() {
  el('schedule-editor').classList.add('hidden');
  el('schedule-board').classList.remove('hidden');
  state.currentScheduleId = null;
}

async function openScheduler(id) {
  try {
    const j = await getJson(`/api/help-requests/${encodeURIComponent(id)}`);
    state.currentScheduleId = id;
    renderScheduleEditor(j);
    el('schedule-board').classList.add('hidden');
    el('schedule-editor').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast('Failed to load that job.', 'error');
  }
}

function renderScheduleEditor(j) {
  const sched = j.scheduledFor ? new Date(j.scheduledFor) : null;
  const dateVal = sched && !isNaN(sched.getTime()) ? dayKey(sched) : '';
  const timeVal = sched && !isNaN(sched.getTime())
    ? `${String(sched.getHours()).padStart(2, '0')}:${String(sched.getMinutes()).padStart(2, '0')}` : '';

  el('schedule-editor-content').innerHTML = `
    <div class="detail-section">
      <h2>${escapeHtml(j.projectTitle || 'Service request')}</h2>
      <span class="status-badge spaced status-${escapeHtml(j.status)}">${escapeHtml((j.status || '').replace(/_/g, ' '))}</span>
    </div>
    <div class="detail-section">
      <h3>Customer</h3>
      <div class="customer-info">
        <div class="info-card"><label>Name</label><p>${escapeHtml(j.customerName || '')}</p></div>
        <div class="info-card"><label>Phone</label><p><a class="link" href="tel:${escapeHtml(j.customerPhone || '')}">${escapeHtml(j.customerPhone || '')}</a></p></div>
        ${j.serviceType ? `<div class="info-card"><label>Service</label><p>${escapeHtml(j.serviceType)}</p></div>` : ''}
      </div>
      ${j.preferredWindow || j.preferredDate ? `<p class="submitted-at">Customer preferred: ${escapeHtml(fmtDate(j.preferredDate) || '')} ${escapeHtml(j.preferredWindow || '')}</p>` : ''}
    </div>
    ${j.userDescription ? `<div class="detail-section"><h3>Description</h3><div class="description-text">${escapeHtml(j.userDescription)}</div></div>` : ''}
    <div class="detail-section">
      <h3>Schedule this job</h3>
      <div class="edit-form">
        <div class="sched-row">
          <div class="form-group"><label for="sched-date">Date</label><input type="date" id="sched-date" value="${escapeHtml(dateVal)}"></div>
          <div class="form-group"><label for="sched-time">Time</label><input type="time" id="sched-time" value="${escapeHtml(timeVal)}"></div>
        </div>
        <div class="sched-row">
          <div class="form-group">
            <label for="sched-status">Status</label>
            <select id="sched-status">${JOB_STATUSES.map((s) => `<option value="${s}" ${j.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label for="sched-tech">Assign to <button class="link-btn" id="sched-suggest-tech" type="button" data-job="${escapeHtml(String(j.id))}">Suggest</button></label>
            <select id="sched-tech">
              <option value="">Unassigned</option>
              ${state.techs.filter((tt) => tt.isActive || tt.id === j.assignedTechId).map((tt) => `<option value="${escapeHtml(String(tt.id))}" ${j.assignedTechId === tt.id ? 'selected' : ''}>${escapeHtml(tt.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label for="sched-eta">Tech ETA (minutes) — set when on the way, blank to clear</label>
          <input type="number" id="sched-eta" min="0" max="600" value="${j.techEtaMinutes != null ? escapeHtml(String(j.techEtaMinutes)) : ''}">
        </div>
        <button class="save-btn" id="sched-save-btn" type="button">Save schedule</button>
      </div>
    </div>`;
}

async function saveSchedule() {
  if (!state.currentScheduleId) return;
  const date = el('sched-date').value;
  const time = el('sched-time').value;
  const status = el('sched-status').value;
  const etaRaw = el('sched-eta').value.trim();
  const techVal = el('sched-tech').value;

  const body = { status };
  if (date) body.scheduledFor = new Date(`${date}T${time || '09:00'}`).toISOString();
  // -1 is the backend's explicit "clear" sentinel for both ETA and assignment.
  body.techEtaMinutes = etaRaw === '' ? -1 : Number(etaRaw);
  body.assignedTechId = techVal === '' ? -1 : Number(techVal);

  const btn = el('sched-save-btn');
  btn.disabled = true;
  try {
    await sendJson(`/api/help-requests/${encodeURIComponent(state.currentScheduleId)}`, 'PUT', body);
    toast('Schedule saved. The customer will see it in the app.', 'success');
    loadSchedule();
  } catch (err) {
    toast('Failed to save the schedule.', 'error');
    btn.disabled = false;
  }
}

/* ── Route view: GET /api/ops/route?techId=&date= ───────────────────────── */

function updateRouteCard(scoped) {
  const card = el('route-card');
  if (!card) return;
  if (!scoped) { card.classList.add('hidden'); el('route-result').innerHTML = ''; return; }
  card.classList.remove('hidden');
  const sel = el('route-tech');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Choose a technician…</option>' +
    state.techs.filter((t) => t.isActive).map((t) => `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.name)}</option>`).join('');
  if (prev) sel.value = prev; // keep the selection across board refreshes
  const dateInput = el('route-date');
  if (!dateInput.value) dateInput.value = dayKey(new Date());
}

async function showRoute() {
  const techId = el('route-tech').value;
  const date = el('route-date').value;
  if (!techId) { toast('Choose a technician first.', 'error'); return; }
  if (!date) { toast('Pick a date for the route.', 'error'); return; }
  const host = el('route-result');
  host.innerHTML = '<div class="spinner"></div>';
  const btn = el('route-show-btn');
  btn.disabled = true;
  try {
    const params = new URLSearchParams({ techId, date });
    const bp = brandParam();
    if (bp) params.set('brand', bp);
    const r = await getJson(`/api/ops/route?${params.toString()}`);
    renderRoute(r || {});
  } catch (err) {
    host.innerHTML = '';
    toast(err.message || 'Could not load the route.', 'error');
  } finally {
    btn.disabled = false;
  }
}

function stopAddress(s) {
  const addr = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ');
  if (addr) return addr;
  return (s.lat != null && s.lng != null) ? `${s.lat}, ${s.lng}` : '';
}

function fmtStopTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/* Directions deep-link: first stop is the origin, last the destination,
   everything between rides along as waypoints. */
function mapsDirUrl(stops) {
  const pts = stops
    .map((s) => (s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : stopAddress(s)))
    .filter(Boolean);
  if (!pts.length) return '';
  if (pts.length === 1) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pts[0])}`;
  const mid = pts.slice(1, -1);
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(pts[0])}` +
    `&destination=${encodeURIComponent(pts[pts.length - 1])}` +
    (mid.length ? `&waypoints=${encodeURIComponent(mid.join('|'))}` : '');
}

function renderRoute(r) {
  const host = el('route-result');
  const stops = r.stops || [];
  const unroutable = r.unroutable || [];
  if (!stops.length && !unroutable.length) {
    host.innerHTML = '<div class="muted route-empty">No scheduled jobs for that technician on that date.</div>';
    return;
  }
  const rows = stops.map((s, i) => `
    <div class="route-stop">
      <span class="route-num">${i + 1}</span>
      <span class="route-time">${escapeHtml(fmtStopTime(s.scheduledFor || s.time))}</span>
      <div class="route-stop-main">
        <div class="route-cust">${escapeHtml(s.customerName || s.projectTitle || 'Job')}</div>
        <div class="route-addr">${escapeHtml(stopAddress(s))}</div>
      </div>
      <span class="route-miles">${s.legMiles != null ? escapeHtml(Number(s.legMiles).toFixed(1)) + ' mi' : ''}</span>
    </div>`).join('');
  const mapsUrl = mapsDirUrl(stops);
  const totalMiles = r.totalMiles != null ? Number(r.totalMiles).toFixed(1) : null;
  host.innerHTML = `
    ${stops.length ? `<div class="route-stops">${rows}</div>` : ''}
    <div class="route-summary">
      ${totalMiles != null ? `<span>Total: ${escapeHtml(totalMiles)} miles</span>` : ''}
      ${mapsUrl ? `<a class="link" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener">Open in Google Maps</a>` : ''}
    </div>
    ${unroutable.length ? `<div class="route-unroutable">⚠ No mappable address (left off the route): ${unroutable.map((u) => escapeHtml(u.customerName || u.projectTitle || `#${u.id}`)).join(', ')}</div>` : ''}`;
}

/* ── Availability settings: GET/PUT /api/brands/{slug}/scheduling ───────── */

const WEEKDAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];
const SLOT_CHOICES = [60, 90, 120, 240];

async function loadAvailability() {
  const card = el('availability-card');
  if (!card) return;
  // Needs a concrete brand: the scoped login's own, or the super-admin's
  // selection. All-brands view hides the card (mirrors the technicians tab).
  const slug = state.brand;
  if (!slug || (state.isSuperAdmin && !brandParam())) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  const host = el('availability-host');
  host.innerHTML = '<div class="spinner"></div>';
  try {
    const cfg = await getJson(`/api/brands/${encodeURIComponent(slug)}/scheduling`);
    renderAvailability(cfg || {});
  } catch (err) {
    host.innerHTML = '<div class="muted">Self-scheduling settings are not available yet.</div>';
  }
}

function renderAvailability(cfg) {
  const host = el('availability-host');
  const hours = cfg.businessHours || {};
  const rows = WEEKDAYS.map(([key, label]) => {
    const ranges = Array.isArray(hours[key]) ? hours[key] : [];
    const on = ranges.length > 0;
    const start = on && ranges[0].start ? ranges[0].start : '08:00';
    const end = on && ranges[0].end ? ranges[0].end : '17:00';
    return `<div class="av-row">
      <label class="av-day"><input type="checkbox" class="av-on" data-day="${key}"${on ? ' checked' : ''}> ${escapeHtml(label)}</label>
      <input type="time" class="av-start" data-day="${key}" value="${escapeHtml(start)}"${on ? '' : ' disabled'}>
      <span class="av-dash">–</span>
      <input type="time" class="av-end" data-day="${key}" value="${escapeHtml(end)}"${on ? '' : ' disabled'}>
    </div>`;
  }).join('');

  const slotMinutes = SLOT_CHOICES.includes(Number(cfg.slotMinutes)) ? Number(cfg.slotMinutes) : 120;
  const slotOpts = SLOT_CHOICES.map((m) => `<option value="${m}"${m === slotMinutes ? ' selected' : ''}>${m === 240 ? '4 hours' : `${m} minutes`}</option>`).join('');
  const capacity = cfg.slotCapacity != null ? String(cfg.slotCapacity) : '';
  const tz = cfg.timeZoneId || 'America/Chicago';

  host.innerHTML = `
    <div class="av-rows">${rows}</div>
    <div class="av-settings">
      <div class="form-group">
        <label for="av-slot">Slot length</label>
        <select id="av-slot">${slotOpts}</select>
      </div>
      <div class="form-group">
        <label for="av-capacity">Jobs per slot</label>
        <input type="number" id="av-capacity" min="1" max="50" value="${escapeHtml(capacity)}" placeholder="Auto (active techs)">
      </div>
      <div class="form-group">
        <label for="av-tz">Time zone (IANA)</label>
        <input type="text" id="av-tz" value="${escapeHtml(tz)}" placeholder="America/Chicago" maxlength="64">
      </div>
    </div>
    <button class="save-btn" id="av-save-btn" type="button">Save availability</button>`;
}

async function saveAvailability() {
  const slug = state.brand;
  if (!slug) return;
  const host = el('availability-host');
  const businessHours = {};
  WEEKDAYS.forEach(([key]) => {
    const on = host.querySelector(`.av-on[data-day="${key}"]`).checked;
    const start = host.querySelector(`.av-start[data-day="${key}"]`).value || '08:00';
    const end = host.querySelector(`.av-end[data-day="${key}"]`).value || '17:00';
    businessHours[key] = on ? [{ start, end }] : [];
  });
  const capRaw = el('av-capacity').value.trim();
  const body = {
    businessHours,
    slotMinutes: Number(el('av-slot').value) || 120,
    slotCapacity: capRaw === '' ? null : Number(capRaw),
    timeZoneId: el('av-tz').value.trim() || 'America/Chicago',
  };
  const btn = el('av-save-btn');
  btn.disabled = true;
  try {
    await sendJson(`/api/brands/${encodeURIComponent(slug)}/scheduling`, 'PUT', body);
    toast('Booking availability saved.', 'success');
  } catch (err) {
    toast(err.message || 'Could not save availability.', 'error');
  } finally {
    btn.disabled = false;
  }
}
