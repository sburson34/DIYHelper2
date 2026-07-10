'use strict';

/* ── Login overlay + session lifecycle ─────────────────────────────────────
   Contract (served by AdminSessionEndpoints):
     POST   /admin/session {username,password} → 200 {isSuperAdmin, brand}
            + HttpOnly cookie dh_admin_session; 401 bad creds; 429 locked out.
     GET    /admin/session → 200 {isSuperAdmin, brand} | 401.
     DELETE /admin/session → 204.
   The cookie is HttpOnly — this module never reads it; the browser attaches
   it because every fetch uses credentials: 'same-origin'. */

import { el } from './ui.js';
import { API } from './api.js';
import { state, setupIdentity } from './state.js';
import { refreshCurrent } from './router.js';

export function wireSession() {
  el('login-form').addEventListener('submit', submitLogin);
  el('signout').addEventListener('click', signOut);
}

export function showLogin() {
  const overlay = el('login-overlay');
  if (!overlay || !overlay.classList.contains('hidden')) return;
  overlay.classList.remove('hidden');
  const u = el('login-username');
  if (u) u.focus();
}

export function hideLogin() {
  const overlay = el('login-overlay');
  if (overlay) overlay.classList.add('hidden');
}

/** Whoami at boot. Returns {isSuperAdmin, brand} or null when signed out.
    Uses a raw fetch so a 401 here doesn't double-trigger the overlay hook. */
export async function bootSession() {
  try {
    const res = await fetch(`${API}/admin/session`, { credentials: 'same-origin' });
    if (res.ok) return await res.json();
  } catch (err) { /* offline / server down — fall through to the login form */ }
  return null;
}

async function submitLogin(e) {
  e.preventDefault();
  const username = el('login-username').value.trim();
  const password = el('login-password').value;
  setLoginError('');
  if (!username || !password) {
    setLoginError('Enter your username and password.');
    return;
  }
  const btn = el('login-submit');
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/admin/session`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const session = await res.json();
      el('login-password').value = '';
      hideLogin();
      await setupIdentity(session);
      refreshCurrent(); // reload whichever section is showing
      return;
    }
    if (res.status === 401) setLoginError('Wrong username or password.');
    else if (res.status === 429) setLoginError('Too many attempts — wait a minute and try again.');
    else {
      let msg = `Sign-in failed (HTTP ${res.status}).`;
      try { const b = await res.json(); if (b && b.error) msg = b.error; } catch (err) { /* ignore */ }
      setLoginError(msg);
    }
  } catch (err) {
    setLoginError('Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}

function setLoginError(msg) {
  const line = el('login-error');
  if (!line) return;
  line.textContent = msg;
  line.classList.toggle('hidden', !msg);
}

/* Sign out: revoke the cookie server-side, then reload — the boot flow lands
   on the login overlay with completely fresh state. (Replaces the old
   bogus-Basic-credentials hack.) */
export async function signOut(e) {
  if (e) e.preventDefault();
  try {
    await fetch(`${API}/admin/session`, { method: 'DELETE', credentials: 'same-origin' });
  } catch (err) { /* cookie may already be gone */ }
  window.location.reload();
}
