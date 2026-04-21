// Tiny module-level event bus so the app shell (logo header, drawer item)
// can ask the Capture screen to reset itself, with an optional confirm prompt
// when the screen is currently focused and has unsaved data.

type ResetListener = () => void;

const listeners = new Set<ResetListener>();

export const subscribeReset = (fn: ResetListener): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const requestCaptureReset = (): void => {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.warn('captureBus listener error', e); }
  }
};
