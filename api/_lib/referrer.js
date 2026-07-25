/**
 * Map a raw document.referrer URL to a short traffic source label.
 */

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

module.exports = { referrerSource };
