const { sanitizeEvent } = require('./_lib/sanitize');
const { deviceFromUa, osFromUa, geoFromHeaders } = require('./_lib/ua');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ypsmbieyrilvruiivhdu.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlwc21iaWV5cmlsdnJ1aWl2aGR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4MzgyMDUsImV4cCI6MjA2NTQxNDIwNX0.KIF9sokSNOhjCAQhUhopD9Wfl55TlN_NDcINWdALFSw').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ANALYTICS_PASSWORD = (process.env.ANALYTICS_PASSWORD || '').trim();

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
  return fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(event),
  });
}

async function supabaseSelect(sinceIso) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/analytics_events`);
  url.searchParams.set(
    'select',
    'id,created_at,name,props,path,session_id,country,city,device,os'
  );
  url.searchParams.set('created_at', `gte.${sinceIso}`);
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '2000');

  return fetch(url, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
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

function summarize(rows) {
  const byName = {};
  const byPaper = {};
  const byEssay = {};
  const byCountry = {};
  const byDevice = {};
  const byOs = {};
  const sessions = new Set();
  const daysMap = {};

  for (const row of rows) {
    bump(byName, row.name);
    if (row.session_id) sessions.add(row.session_id);

    const day = String(row.created_at).slice(0, 10);
    daysMap[day] = (daysMap[day] || 0) + 1;

    bump(byCountry, row.country || 'unknown');
    bump(byDevice, row.device || 'unknown');
    bump(byOs, row.os || 'unknown');

    if (row.name === 'paper_open' && row.props && row.props.paper) {
      bump(byPaper, row.props.paper);
    }
    if (row.name === 'essay_open' && row.props && row.props.slug) {
      bump(byEssay, row.props.slug);
    }
  }

  return {
    totalEvents: rows.length,
    uniqueSessions: sessions.size,
    byName,
    byPaper,
    byEssay,
    byCountry,
    byDevice,
    byOs,
    daily: daysMap,
    recent: rows.slice(0, 50),
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
  try {
    const url = new URL(req.url, 'http://localhost');
    days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 30)));
  } catch {
    days = 30;
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const list = await supabaseSelect(since);
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

  return json(res, 200, { days, ...summarize(rows) });
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
module.exports.enrichEvent = enrichEvent;
