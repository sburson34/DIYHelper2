// Tiny module-level event bus so the app shell (logo header, drawer item)
// can ask the Capture screen to reset itself, with an optional confirm prompt
// when the screen is currently focused and has unsaved data.

const listeners = new Set();

export const subscribeReset = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const requestCaptureReset = () => {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.warn('captureBus listener error', e); }
  }
};
