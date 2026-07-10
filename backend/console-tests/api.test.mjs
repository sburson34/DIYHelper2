import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API, getJson, sendJson, del, setUnauthorizedHandler } from '../DIYHelper2.Api/wwwroot/admin/js/api.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  setUnauthorizedHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getJson', () => {
  it('returns the parsed body and sends same-origin credentials', async () => {
    fetch.mockResolvedValue(jsonResponse(200, { hello: 'world' }));
    const data = await getJson('/api/thing');
    expect(data).toEqual({ hello: 'world' });
    expect(fetch).toHaveBeenCalledWith(`${API}/api/thing`, { credentials: 'same-origin' });
  });

  it('parses a JSON {error} body into the thrown message', async () => {
    fetch.mockResolvedValue(jsonResponse(400, { error: 'That brand does not exist.' }));
    await expect(getJson('/api/thing')).rejects.toThrow('That brand does not exist.');
  });

  it('falls back to HTTP <status> when the error body is not JSON', async () => {
    fetch.mockResolvedValue(jsonResponse(500, undefined));
    await expect(getJson('/api/thing')).rejects.toThrow('HTTP 500');
  });

  it('exposes the status code on the thrown error', async () => {
    fetch.mockResolvedValue(jsonResponse(429, { error: 'Slow down.' }));
    const err = await getJson('/api/thing').catch((e) => e);
    expect(err.status).toBe(429);
  });
});

describe('401 handling', () => {
  it('fires the onUnauthorized hook and still rejects', async () => {
    const hook = vi.fn();
    setUnauthorizedHandler(hook);
    fetch.mockResolvedValue(jsonResponse(401, undefined));
    await expect(getJson('/api/secret')).rejects.toThrow('HTTP 401');
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('does not fire the hook for non-401 failures', async () => {
    const hook = vi.fn();
    setUnauthorizedHandler(hook);
    fetch.mockResolvedValue(jsonResponse(404, undefined));
    await expect(getJson('/api/missing')).rejects.toThrow('HTTP 404');
    expect(hook).not.toHaveBeenCalled();
  });

  it('fires the hook from sendJson and del too', async () => {
    const hook = vi.fn();
    setUnauthorizedHandler(hook);
    fetch.mockResolvedValue(jsonResponse(401, undefined));
    await expect(sendJson('/api/x', 'PUT', {})).rejects.toThrow();
    await expect(del('/api/x')).rejects.toThrow();
    expect(hook).toHaveBeenCalledTimes(2);
  });
});

describe('sendJson', () => {
  it('sends the method, JSON content-type, serialized body, and credentials', async () => {
    fetch.mockResolvedValue(jsonResponse(200, { ok: true }));
    await sendJson('/api/items', 'POST', { name: 'Widget' });
    expect(fetch).toHaveBeenCalledWith(`${API}/api/items`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    });
  });
});

describe('del', () => {
  it('sends DELETE with same-origin credentials', async () => {
    fetch.mockResolvedValue(jsonResponse(204, undefined));
    await del('/api/items/7');
    expect(fetch).toHaveBeenCalledWith(`${API}/api/items/7`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  });

  it('throws on a failed delete instead of swallowing it', async () => {
    fetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    await expect(del('/api/items/7')).rejects.toThrow('boom');
  });
});
