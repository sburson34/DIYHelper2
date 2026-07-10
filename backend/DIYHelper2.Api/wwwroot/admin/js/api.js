'use strict';

/* ── HTTP helpers ──────────────────────────────────────────────────────────
   Every call is same-origin and carries the dh_admin_session cookie
   (credentials is explicit so the contract is obvious). Any 401 funnels into
   the onUnauthorized hook, which the bootstrap wires to the login overlay. */

export const API = window.location.origin;

let onUnauthorized = null;

/** Called (once per failing request) whenever the API answers 401. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function getJson(path) {
  const res = await fetch(`${API}${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw await httpError(res);
  return res.json();
}

export async function sendJson(path, method, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res);
  return res.json();
}

/** DELETE with error propagation (unlike the old bare fetch-and-hope). */
export async function del(path) {
  const res = await fetch(`${API}${path}`, { method: 'DELETE', credentials: 'same-origin' });
  if (!res.ok) throw await httpError(res);
  return res;
}

async function httpError(res) {
  if (res.status === 401 && typeof onUnauthorized === 'function') {
    try { onUnauthorized(); } catch (e) { /* never mask the real error */ }
  }
  let msg = `HTTP ${res.status}`;
  try {
    const b = await res.json();
    if (b && b.error) msg = b.error;
  } catch (e) { /* body wasn't JSON */ }
  const err = new Error(msg);
  err.status = res.status;
  return err;
}
