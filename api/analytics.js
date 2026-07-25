const { sanitizeEvent } = require('./_lib/sanitize');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ypsmbieyrilvruiivhdu.supabase.co';
// Same public anon key already embedded for doodles; override via env if rotated.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlwc21iaWV5cmlsdnJ1aWl2aGR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4MzgyMDUsImV4cCI6MjA2NTQxNDIwNX0.KIF9sokSNOhjCAQhUhopD9Wfl55TlN_NDcINWdALFSw';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANALYTICS_PASSWORD = process.env.ANALYTICS_PASSWORD || '';

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

async function supabase(path, { method = 'GET', key, body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=minimal' : 'count=exact',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

function authorized(req) {
  if (!ANALYTICS_PASSWORD) return false;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${ANALYTICS_PASSWORD}`) return true;
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('password') === ANALYTICS_PASSWORD;
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

  // Vercel may leave body undefined for some content-types; read raw if needed.
  if (body == null && typeof req.on === 'function') {
    body = await new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 8192) {
          reject(new Error('payload too large'));
        }
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

  const insert = await supabase('analytics_events', {
    method: 'POST',
    key: SUPABASE_ANON_KEY,
    body: event,
  });

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

  const url = new URL(req.url, 'http://localhost');
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const list = await supabase(
    `analytics_events?select=id,created_at,name,props,path,session_id&created_at=gte.${since}&order=created_at.desc&limit=2000`,
    { key: SUPABASE_SERVICE_ROLE_KEY }
  );

  if (!list.ok) {
    const text = await list.text();
    return json(res, 502, { error: 'query failed', detail: text.slice(0, 300) });
  }

  const rows = await list.json();
  const byName = {};
  const byPaper = {};
  const byEssay = {};
  const sessions = new Set();
  const daysMap = {};

  for (const row of rows) {
    byName[row.name] = (byName[row.name] || 0) + 1;
    if (row.session_id) sessions.add(row.session_id);

    const day = String(row.created_at).slice(0, 10);
    daysMap[day] = (daysMap[day] || 0) + 1;

    if (row.name === 'paper_open' && row.props && row.props.paper) {
      byPaper[row.props.paper] = (byPaper[row.props.paper] || 0) + 1;
    }
    if (row.name === 'essay_open' && row.props && row.props.slug) {
      byEssay[row.props.slug] = (byEssay[row.props.slug] || 0) + 1;
    }
  }

  return json(res, 200, {
    days,
    totalEvents: rows.length,
    uniqueSessions: sessions.size,
    byName,
    byPaper,
    byEssay,
    daily: daysMap,
    recent: rows.slice(0, 50),
  });
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
    return json(res, 500, { error: 'server error' });
  }
};
