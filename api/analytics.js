const { sanitizeEvent } = require('./_lib/sanitize');
const { deviceFromUa, osFromUa, geoFromHeaders } = require('./_lib/ua');
const { trafficSource } = require('./_lib/referrer');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ypsmbieyrilvruiivhdu.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlwc21iaWV5cmlsdnJ1aWl2aGR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4MzgyMDUsImV4cCI6MjA2NTQxNDIwNX0.KIF9sokSNOhjCAQhUhopD9Wfl55TlN_NDcINWdALFSw').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ANALYTICS_PASSWORD = (process.env.ANALYTICS_PASSWORD || '').trim();
const SITE_HOSTS = ['harryliwastaken.com', 'harryli.xyz', 'www.harryliwastaken.com', 'www.harryli.xyz'];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function bump(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

async function supabaseInsert(event) {
  const post = (body) =>
    fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });

  const res = await post(event);
  if (res.ok) return res;

  const text = await res.text();
  // Migration not applied yet — retry without geo/device columns.
  if (text.includes('42703') || text.includes('does not exist')) {
    const { country, city, device, os, ...base } = event;
    return post(base);
  }

  return {
    ok: false,
    status: res.status,
    async text() {
      return text;
    },
  };
}

async function supabaseSelect(sinceIso, { limit = 2000, offset = 0 } = {}) {
  const run = async (select) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/analytics_events`);
    url.searchParams.set('select', select);
    url.searchParams.set('created_at', `gte.${sinceIso}`);
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(limit));
    if (offset > 0) url.searchParams.set('offset', String(offset));
    return fetch(url, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  };

  const full = 'id,created_at,name,props,path,session_id,referrer,country,city,device,os';
  const res = await run(full);
  if (res.ok) return res;

  const text = await res.text();
  if (text.includes('42703') || text.includes('does not exist')) {
    return run('id,created_at,name,props,path,session_id,referrer');
  }

  return {
    ok: false,
    status: res.status,
    async text() {
      return text;
    },
  };
}

function authorized(req) {
  if (!ANALYTICS_PASSWORD) return false;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${ANALYTICS_PASSWORD}`) return true;
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get('password') === ANALYTICS_PASSWORD;
  } catch {
    return false;
  }
}

function mapRecent(rows) {
  return rows.map((row) => ({
    ...row,
    source: trafficSource(row, SITE_HOSTS),
  }));
}

function summarize(rows, opts = {}) {
  const recentLimit = Math.min(100, Math.max(1, Number(opts.recentLimit) || 40));
  const recentOffset = Math.max(0, Number(opts.recentOffset) || 0);
  const byName = {};
  const byPaper = {};
  const byEssay = {};
  const countrySessions = {};
  const citySessions = {};
  const deviceSessions = {};
  const osSessions = {};
  const referrerSessions = {};
  const pathSessions = {};
  const outboundSessions = {};
  const essayOpenSessions = {};
  const essayMaxDepth = {};
  const sessions = new Set();
  const daysMap = {};

  for (const row of rows) {
    bump(byName, row.name);
    if (row.session_id) sessions.add(row.session_id);

    const day = String(row.created_at).slice(0, 10);
    daysMap[day] = (daysMap[day] || 0) + 1;

    const visitor = row.session_id || `event:${row.id}`;
    const addVisitor = (map, key) => {
      const label = key || 'unknown';
      (map[label] ||= new Set()).add(visitor);
    };
    addVisitor(countrySessions, row.country);
    const cityLabel = row.city
      ? (row.country ? `${row.city}, ${row.country}` : row.city)
      : (row.country || 'unknown');
    addVisitor(citySessions, cityLabel);
    addVisitor(deviceSessions, row.device);
    addVisitor(osSessions, row.os);
    addVisitor(referrerSessions, trafficSource(row, SITE_HOSTS));

    if (row.name === 'page_view' && row.path) {
      const landing = String(row.path).split('#')[0] || '/';
      addVisitor(pathSessions, landing);
    }

    if (row.name === 'paper_open' && row.props && row.props.paper) {
      bump(byPaper, row.props.paper);
    }
    if (row.name === 'essay_open' && row.props && row.props.slug) {
      bump(byEssay, row.props.slug);
      addVisitor(essayOpenSessions, row.props.slug);
    }
    if (row.name === 'essay_scroll' && row.props && row.props.slug) {
      const slug = row.props.slug;
      const depth = Number(row.props.depth) || 0;
      essayMaxDepth[slug] ||= {};
      essayMaxDepth[slug][visitor] = Math.max(essayMaxDepth[slug][visitor] || 0, depth);
    }
    if (row.name === 'outbound_click' && row.props) {
      const key = row.props.label || row.props.host || 'unknown';
      addVisitor(outboundSessions, key);
    }
  }

  const sessionCounts = (map) =>
    Object.fromEntries(
      Object.entries(map).map(([key, values]) => [key, values.size])
    );

  const essayDepth = {};
  const essayDepthAvg = {};
  const allEssaySlugs = new Set([
    ...Object.keys(essayOpenSessions),
    ...Object.keys(essayMaxDepth),
  ]);
  for (const slug of allEssaySlugs) {
    const opens = (essayOpenSessions[slug] && essayOpenSessions[slug].size) || 0;
    const depthMap = essayMaxDepth[slug] || {};
    // Include openers with no scroll events as 0% depth.
    const openers = essayOpenSessions[slug] || new Set();
    const depths = [];
    for (const visitor of openers) {
      depths.push(depthMap[visitor] || 0);
    }
    for (const visitor of Object.keys(depthMap)) {
      if (!openers.has(visitor)) depths.push(depthMap[visitor]);
    }
    const avg = depths.length
      ? Math.round(depths.reduce((s, n) => s + n, 0) / depths.length)
      : 0;
    const finished = depths.filter((d) => d >= 100).length;
    const reached50 = depths.filter((d) => d >= 50).length;
    essayDepth[slug] = {
      opens: opens || depths.length,
      avgMaxDepth: avg,
      reached50,
      finished,
    };
    essayDepthAvg[slug] = avg;
  }

  return {
    totalEvents: rows.length,
    uniqueSessions: sessions.size,
    byName,
    byPaper,
    byEssay,
    byCountry: sessionCounts(countrySessions),
    byCity: sessionCounts(citySessions),
    byDevice: sessionCounts(deviceSessions),
    byOs: sessionCounts(osSessions),
    byReferrer: sessionCounts(referrerSessions),
    byLanding: sessionCounts(pathSessions),
    byOutbound: sessionCounts(outboundSessions),
    essayDepth,
    essayDepthAvg,
    daily: daysMap,
    recent: mapRecent(rows.slice(recentOffset, recentOffset + recentLimit)),
    recentOffset,
    recentLimit,
    recentTotal: rows.length,
    recentHasMore: recentOffset + recentLimit < rows.length,
  };
}

function enrichEvent(event, req) {
  const { country, city } = geoFromHeaders(req.headers || {});
  return {
    ...event,
    country: country ? String(country).slice(0, 8) : null,
    city: city ? String(city).slice(0, 64) : null,
    device: deviceFromUa(event.ua),
    os: osFromUa(event.ua),
  };
}

async function handlePost(req, res) {
  if (!SUPABASE_ANON_KEY) {
    return json(res, 500, { error: 'SUPABASE_ANON_KEY not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'invalid json' });
    }
  }

  if (body == null && typeof req.on === 'function') {
    body = await new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 8192) reject(new Error('payload too large'));
      });
      req.on('end', () => {
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    }).catch(() => null);
    if (body == null) return json(res, 400, { error: 'invalid json' });
  }

  const { event, error } = sanitizeEvent(body);
  if (error) return json(res, 400, { error });

  const insert = await supabaseInsert(enrichEvent(event, req));
  if (!insert.ok) {
    const text = await insert.text();
    return json(res, 502, { error: 'insert failed', detail: text.slice(0, 300) });
  }

  res.statusCode = 204;
  return res.end();
}

async function handleGet(req, res) {
  if (!authorized(req)) {
    return json(res, 401, { error: 'unauthorized' });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  }

  let days = 30;
  let offset = 0;
  let limit = 40;
  try {
    const url = new URL(req.url, 'http://localhost');
    days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 30)));
    offset = Math.max(0, Number(url.searchParams.get('offset') || 0) || 0);
    limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 40) || 40));
  } catch {
    days = 30;
    offset = 0;
    limit = 40;
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  // Load-more requests only need the next page of recent events.
  const selectOpts = offset > 0
    ? { limit: limit + 1, offset }
    : { limit: 2000, offset: 0 };
  const list = await supabaseSelect(since, selectOpts);
  const text = await list.text();

  if (!list.ok) {
    return json(res, 502, {
      error: 'query failed',
      detail: text.slice(0, 300),
      hint: 'Check SUPABASE_SERVICE_ROLE_KEY is the service_role secret from the wavelet project',
    });
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    return json(res, 502, { error: 'invalid supabase response', detail: text.slice(0, 300) });
  }

  if (!Array.isArray(rows)) {
    return json(res, 502, { error: 'unexpected supabase response', detail: text.slice(0, 300) });
  }

  if (offset > 0) {
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return json(res, 200, {
      days,
      recent: mapRecent(page),
      recentOffset: offset,
      recentLimit: limit,
      recentHasMore: hasMore,
    });
  }

  return json(res, 200, { days, ...summarize(rows, { recentOffset: 0, recentLimit: limit }) });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'GET') return await handleGet(req, res);
    return json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return json(res, 500, {
      error: 'server error',
      detail: String(err && err.message ? err.message : err).slice(0, 200),
    });
  }
};

module.exports.summarize = summarize;
module.exports.mapRecent = mapRecent;
module.exports.enrichEvent = enrichEvent;
