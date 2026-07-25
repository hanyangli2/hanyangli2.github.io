/**
 * First-party analytics for the desk.
 * Posts events to /api/analytics (Supabase-backed).
 */

const SESSION_KEY = 'hl_analytics_sid';
const ENDPOINT = '/api/analytics';

function sessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
        `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function trackEvent(name, data) {
  const payload = {
    name,
    props: data && typeof data === 'object' ? data : {},
    session_id: sessionId(),
    path: typeof location !== 'undefined' ? location.pathname + location.hash : null,
    referrer: typeof document !== 'undefined' ? document.referrer || null : null,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  };

  const body = JSON.stringify(payload);

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
  } catch {
    // fall through to fetch
  }

  if (typeof fetch === 'function') {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

if (typeof window !== 'undefined') {
  window.trackEvent = trackEvent;
  const queued = window.__analyticsQ || [];
  window.__analyticsQ = [];
  for (const item of queued) {
    trackEvent(item[0], item[1]);
  }
}
