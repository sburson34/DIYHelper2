const API = window.location.origin;
let currentFilter = '';
let currentRequestId = null;

// DOM elements
const requestList = document.getElementById('request-list');
const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('detail-content');
const backBtn = document.getElementById('back-btn');
const deleteBtn = document.getElementById('delete-btn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadRequests();
  setupFilters();
  backBtn.addEventListener('click', showList);
  deleteBtn.addEventListener('click', deleteCurrentRequest);
});

function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.status;
      loadRequests();
    });
  });
}

async function loadRequests() {
  const url = currentFilter
    ? `${API}/api/help-requests?status=${currentFilter}`
    : `${API}/api/help-requests`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    renderList(data);
  } catch (err) {
    requestList.innerHTML = '<div class="empty-state"><h2>Error loading requests</h2><p>Could not connect to the API.</p></div>';
  }
}

function renderList(requests) {
  if (!requests.length) {
    requestList.innerHTML = '<div class="empty-state"><h2>No requests found</h2><p>Help requests from the app will appear here.</p></div>';
    return;
  }

  requestList.innerHTML = requests.map(r => `
    <div class="request-card" onclick="viewRequest(${r.id})">
      <div class="request-card-header">
        <span class="request-card-title">${escapeHtml(r.projectTitle)}</span>
        <span class="status-badge status-${r.status}">${r.status.replace('_', ' ')}</span>
      </div>
      <div class="request-card-info">
        <span>${escapeHtml(r.customerName)}</span>
        <span>${escapeHtml(r.customerEmail)}</span>
        <span>${escapeHtml(r.customerPhone)}</span>
        <span>${new Date(r.createdAt).toLocaleDateString()}</span>
        ${r.followUpDate ? `<span>Follow-up: ${new Date(r.followUpDate).toLocaleDateString()}</span>` : ''}
      </div>
    </div>
  `).join('');
}

async function viewRequest(id) {
  try {
    const res = await fetch(`${API}/api/help-requests/${id}`);
    const data = await res.json();
    currentRequestId = id;
    renderDetail(data);
    requestList.style.display = 'none';
    document.querySelector('.filters').style.display = 'none';
    detailPanel.classList.remove('hidden');
  } catch (err) {
    alert('Failed to load request details.');
  }
}

function showList() {
  detailPanel.classList.add('hidden');
  requestList.style.display = 'flex';
  document.querySelector('.filters').style.display = 'flex';
  currentRequestId = null;
  loadRequests();
}

function renderDetail(data) {
  let projectData = {};
  try { projectData = JSON.parse(data.projectData); } catch {}

  const steps = (projectData.steps || []).map(s => typeof s === 'string' ? s : s.text);

  detailContent.innerHTML = `
    <div class="detail-section">
      <h2>${escapeHtml(data.projectTitle)}</h2>
      <span class="status-badge status-${data.status}" style="margin-bottom:12px;display:inline-block">${data.status.replace('_', ' ')}</span>
      <p style="color:#94A3B8;margin-top:8px">Submitted ${new Date(data.createdAt).toLocaleString()}</p>
    </div>

    <div class="detail-section">
      <h3>Customer</h3>
      <div class="customer-info">
        <div class="info-card"><label>Name</label><p>${escapeHtml(data.customerName)}</p></div>
        <div class="info-card"><label>Email</label><p><a href="mailto:${escapeHtml(data.customerEmail)}" style="color:#FCA004">${escapeHtml(data.customerEmail)}</a></p></div>
        <div class="info-card"><label>Phone</label><p><a href="tel:${escapeHtml(data.customerPhone)}" style="color:#FCA004">${escapeHtml(data.customerPhone)}</a></p></div>
      </div>
    </div>

    ${data.userDescription ? `
    <div class="detail-section">
      <h3>User Description</h3>
      <div class="description-text">${escapeHtml(data.userDescription)}</div>
    </div>` : ''}

    ${data.imageBase64 ? `
    <div class="detail-section">
      <h3>Photo</h3>
      <img class="thumbnail" src="data:image/jpeg;base64,${data.imageBase64}" alt="Project photo">
    </div>` : ''}

    <div class="detail-section">
      <h3>Project Overview</h3>
      <div class="project-overview">
        <div class="overview-stat"><span class="stat-label">Difficulty</span><div class="stat-value">${escapeHtml(projectData.difficulty || 'N/A')}</div></div>
        <div class="overview-stat"><span class="stat-label">Time</span><div class="stat-value">${escapeHtml(projectData.estimated_time || 'N/A')}</div></div>
        <div class="overview-stat"><span class="stat-label">Cost</span><div class="stat-value">${escapeHtml(projectData.estimated_cost || 'N/A')}</div></div>
      </div>
    </div>

    ${steps.length ? `
    <div class="detail-section">
      <h3>Steps</h3>
      <div class="steps-list">
        ${steps.map((s, i) => `<div class="step-item"><span class="step-number">${i + 1}</span><span class="step-text">${escapeHtml(s)}</span></div>`).join('')}
      </div>
    </div>` : ''}

    ${projectData.tools_and_materials?.length ? `
    <div class="detail-section">
      <h3>Tools & Materials</h3>
      <div class="tools-list">${projectData.tools_and_materials.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    </div>` : ''}

    ${projectData.safety_tips?.length ? `
    <div class="detail-section">
      <h3>Safety Tips</h3>
      <div class="safety-list">${projectData.safety_tips.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    </div>` : ''}

    ${projectData.when_to_call_pro?.length ? `
    <div class="detail-section">
      <h3>When to Call a Pro</h3>
      <div class="pro-list">${projectData.when_to_call_pro.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    </div>` : ''}

    <div class="detail-section">
      <h3>Manage Request</h3>
      <div class="edit-form">
        <div class="form-group">
          <label>Status</label>
          <select id="edit-status">
            <option value="new" ${data.status === 'new' ? 'selected' : ''}>New</option>
            <option value="in_progress" ${data.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${data.status === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="cancelled" ${data.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="edit-notes" placeholder="Add notes about this request...">${escapeHtml(data.notes || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Follow-up Date</label>
          <input type="date" id="edit-followup" value="${data.followUpDate ? data.followUpDate.split('T')[0] : ''}">
        </div>
        <button class="save-btn" onclick="saveChanges()">Save Changes</button>
      </div>
    </div>
  `;
}

async function saveChanges() {
  if (!currentRequestId) return;

  const status = document.getElementById('edit-status').value;
  const notes = document.getElementById('edit-notes').value;
  const followUpDate = document.getElementById('edit-followup').value || null;

  try {
    const res = await fetch(`${API}/api/help-requests/${currentRequestId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes, followUpDate }),
    });
    if (res.ok) {
      const updated = await res.json();
      renderDetail(updated);
      // Flash the save button
      const btn = document.querySelector('.save-btn');
      btn.textContent = 'Saved!';
      btn.style.background = '#00B894';
      setTimeout(() => { btn.textContent = 'Save Changes'; btn.style.background = ''; }, 1500);
    }
  } catch (err) {
    alert('Failed to save changes.');
  }
}

async function deleteCurrentRequest() {
  if (!currentRequestId) return;
  if (!confirm('Are you sure you want to delete this request? This cannot be undone.')) return;

  try {
    const res = await fetch(`${API}/api/help-requests/${currentRequestId}`, { method: 'DELETE' });
    if (res.ok) {
      showList();
    }
  } catch (err) {
    alert('Failed to delete request.');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
