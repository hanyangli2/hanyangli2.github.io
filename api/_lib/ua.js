/**
 * Coarse device / OS labels from a user-agent string.
 * Intentionally simple — good enough for a personal dashboard.
 */

function deviceFromUa(ua) {
  if (!ua || typeof ua !== 'string') return 'unknown';
  const s = ua.toLowerCase();
  if (/ipad|tablet|(android(?!.*mobile))|kindle|silk/.test(s)) return 'tablet';
  if (/mobi|iphone|ipod|android|webos|opera mini|iemobile/.test(s)) return 'mobile';
  return 'desktop';
}

function osFromUa(ua) {
  if (!ua || typeof ua !== 'string') return 'unknown';
  const s = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return 'ios';
  if (/android/.test(s)) return 'android';
  if (/mac os x|macintosh/.test(s)) return 'mac';
  if (/windows/.test(s)) return 'windows';
  if (/cros/.test(s)) return 'chromeos';
  if (/linux/.test(s)) return 'linux';
  return 'other';
}

/** Read Vercel edge geo headers (no raw IP stored). */
function geoFromHeaders(headers) {
  const h = headers || {};
  const get = (k) => {
    const v = h[k] || h[k.toLowerCase()];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const decode = (value) => {
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return {
    country: get('x-vercel-ip-country'),
    city: decode(get('x-vercel-ip-city')),
  };
}

module.exports = { deviceFromUa, osFromUa, geoFromHeaders };
