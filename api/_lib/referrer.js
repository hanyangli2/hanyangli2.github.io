/**
 * Map a raw document.referrer URL / utm_source to a short traffic source label.
 */

function labelFromHost(host) {
  const bare = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!bare) return 'direct';

  if (
    bare === 'x.com' ||
    bare === 't.co' ||
    bare === 'twitter.com' ||
    bare.endsWith('.x.com') ||
    bare.endsWith('.twitter.com')
  ) {
    return 'x';
  }
  if (bare === 'linkedin.com' || bare === 'lnkd.in' || bare.endsWith('.linkedin.com')) {
    return 'linkedin';
  }
  if (bare === 'google.com' || bare.endsWith('.google.com') || /^google\.[a-z.]+$/.test(bare)) {
    return 'google';
  }
  if (bare === 'bing.com' || bare.endsWith('.bing.com')) return 'bing';
  if (bare === 'duckduckgo.com' || bare.endsWith('.duckduckgo.com')) return 'duckduckgo';
  if (
    bare === 'facebook.com' ||
    bare === 'fb.com' ||
    bare === 'm.facebook.com' ||
    bare.endsWith('.facebook.com')
  ) {
    return 'facebook';
  }
  if (bare === 'instagram.com' || bare.endsWith('.instagram.com')) return 'instagram';
  if (bare === 'reddit.com' || bare.endsWith('.reddit.com')) return 'reddit';
  if (bare === 'github.com' || bare.endsWith('.github.com')) return 'github';
  if (bare === 'youtube.com' || bare === 'youtu.be' || bare.endsWith('.youtube.com')) {
    return 'youtube';
  }
  if (bare === 'threads.net' || bare.endsWith('.threads.net')) return 'threads';
  return bare;
}

function referrerSource(referrer, siteHosts = []) {
  if (referrer == null || String(referrer).trim() === '') return 'direct';

  let host;
  try {
    host = new URL(String(referrer)).hostname.toLowerCase();
  } catch {
    return 'other';
  }

  const bare = host.replace(/^www\./, '');
  const own = new Set(
    (siteHosts || [])
      .filter(Boolean)
      .map((h) => String(h).toLowerCase().replace(/^www\./, ''))
  );
  if (own.has(bare) || [...own].some((h) => bare.endsWith('.' + h))) {
    return 'direct';
  }

  return labelFromHost(bare);
}

/** Fallback when referrer is stripped but the landing URL has utm_source. */
function utmSource(path) {
  if (!path || typeof path !== 'string' || !path.includes('utm_source=')) return null;
  try {
    const query = path.includes('?') ? path.slice(path.indexOf('?')).split('#')[0] : '';
    const value = new URLSearchParams(query).get('utm_source');
    if (!value) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'twitter' || raw === 'x') return 'x';
    if (raw === 'li' || raw === 'linkedin') return 'linkedin';
    if (raw === 'fb' || raw === 'facebook') return 'facebook';
    if (raw === 'ig' || raw === 'instagram') return 'instagram';
    if (raw === 'yt' || raw === 'youtube') return 'youtube';
    return raw.slice(0, 32);
  } catch {
    return null;
  }
}

function trafficSource({ referrer, path } = {}, siteHosts = []) {
  const fromRef = referrerSource(referrer, siteHosts);
  if (fromRef !== 'direct') return fromRef;
  return utmSource(path) || 'direct';
}

module.exports = { referrerSource, utmSource, trafficSource, labelFromHost };
