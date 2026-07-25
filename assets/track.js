/**
 * Tiny Vercel Web Analytics helper for the desk page.
 * Safe to call before the insights script finishes loading (events queue on window.va).
 */
export function trackEvent(name, data) {
  if (typeof globalThis.va !== 'function') return;
  globalThis.va('event', data ? { name, data } : { name });
}

if (typeof window !== 'undefined') {
  window.trackEvent = trackEvent;
}
