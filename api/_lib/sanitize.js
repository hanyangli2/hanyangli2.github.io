/**
 * Shared analytics allowlists / sanitizers (API + tests).
 */

const ALLOWED_EVENTS = new Set([
  'page_view',
  'paper_open',
  'essay_open',
  'essay_scroll',
  'outbound_click',
  'doodle_submit',
  'doodle_blocked',
  'penance_started',
  'penance_completed',
]);

const ALLOWED_PROP_KEYS = new Set([
  'paper',
  'slug',
  'strokeCount',
  'named',
  'depth',
  'host',
  'label',
  'href',
  'score',
]);

function clip(value, max) {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function sanitizeProps(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    if (typeof value === 'string') out[key] = clip(value, key === 'href' ? 128 : 64);
    else if (typeof value === 'number' && Number.isFinite(value)) {
      if (key === 'depth') {
        const ok = value === 25 || value === 50 || value === 75 || value === 100;
        if (!ok) continue;
      }
      out[key] = value;
    } else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function sanitizeEvent(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'invalid body' };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!ALLOWED_EVENTS.has(name)) {
    return { error: 'unknown event' };
  }

  return {
    event: {
      name,
      props: sanitizeProps(body.props),
      session_id: clip(body.session_id, 64),
      path: clip(body.path, 512),
      referrer: clip(body.referrer, 512),
      ua: clip(body.ua, 512),
    },
  };
}

module.exports = {
  ALLOWED_EVENTS,
  ALLOWED_PROP_KEYS,
  sanitizeEvent,
  sanitizeProps,
  clip,
};
