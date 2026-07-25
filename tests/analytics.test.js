import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeEvent } = require('../api/_lib/sanitize.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('sanitizeEvent', () => {
  it('accepts allowlisted events and props', () => {
    const { event, error } = sanitizeEvent({
      name: 'essay_open',
      props: { slug: 'the-carousel', evil: 'nope' },
      session_id: 'abc',
      path: '/',
    });
    assert.equal(error, undefined);
    assert.deepEqual(event, {
      name: 'essay_open',
      props: { slug: 'the-carousel' },
      session_id: 'abc',
      path: '/',
      referrer: null,
      ua: null,
    });
  });

  it('rejects unknown events', () => {
    const { error } = sanitizeEvent({ name: 'hack_the_planet' });
    assert.equal(error, 'unknown event');
  });
});

describe('first-party analytics wiring', () => {
  it('has collector API and private viewer', () => {
    assert.ok(existsSync(join(root, 'api/analytics.js')));
    assert.ok(existsSync(join(root, 'analytics.html')));
    assert.ok(existsSync(join(root, 'supabase/migrations/20260725214601_analytics_events.sql')));
  });

  it('desk page loads track.js and fires core events', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    assert.match(html, /assets\/track\.js/);
    assert.match(html, /track\(\s*['"]page_view['"]/);
    assert.match(html, /track\(\s*['"]paper_open['"]/);
    assert.match(html, /track\(\s*['"]essay_open['"]/);
    assert.match(html, /track\(\s*['"]doodle_submit['"]/);
  });
});

describe('ua helpers', () => {
  it('classifies device and os', () => {
    const { deviceFromUa, osFromUa, geoFromHeaders } = require('../api/_lib/ua.js');
    assert.equal(deviceFromUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'mobile');
    assert.equal(osFromUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'ios');
    assert.equal(deviceFromUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'desktop');
    assert.equal(osFromUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
    assert.deepEqual(
      geoFromHeaders({ 'x-vercel-ip-country': 'US', 'x-vercel-ip-city': 'Boston' }),
      { country: 'US', city: 'Boston' }
    );
    assert.deepEqual(
      geoFromHeaders({ 'x-vercel-ip-country': 'US', 'x-vercel-ip-city': 'New%20York' }),
      { country: 'US', city: 'New York' }
    );
  });
});

describe('referrerSource', () => {
  it('labels common traffic sources', () => {
    const { referrerSource, trafficSource } = require('../api/_lib/referrer.js');
    assert.equal(referrerSource(null), 'direct');
    assert.equal(referrerSource(''), 'direct');
    assert.equal(referrerSource('https://t.co/abc'), 'x');
    assert.equal(referrerSource('https://x.com/someone/status/1'), 'x');
    assert.equal(referrerSource('https://www.linkedin.com/feed/'), 'linkedin');
    assert.equal(referrerSource('https://www.google.com/search?q=harry'), 'google');
    assert.equal(referrerSource('https://www.reddit.com/r/webdev/'), 'reddit');
    assert.equal(referrerSource('https://github.com/hanyangli2'), 'github');
    assert.equal(
      referrerSource('https://harryliwastaken.com/', ['harryliwastaken.com', 'harryli.xyz']),
      'direct'
    );
    assert.equal(referrerSource('https://news.ycombinator.com/item?id=1'), 'news.ycombinator.com');
    assert.equal(
      trafficSource({ referrer: null, path: '/?utm_source=linkedin#writings' }),
      'linkedin'
    );
    assert.equal(
      trafficSource({ referrer: null, path: '/?utm_source=twitter' }),
      'x'
    );
  });
});

describe('summarize', () => {
  it('aggregates papers, essays, city, device, and referrer', () => {
    const { summarize } = require('../api/analytics.js');
    const out = summarize([
      {
        name: 'page_view',
        created_at: '2026-07-25T00:00:00Z',
        session_id: 'a',
        props: {},
        path: '/',
        country: 'US',
        city: 'Boston',
        device: 'mobile',
        os: 'ios',
        referrer: 'https://t.co/abc',
      },
      {
        name: 'paper_open',
        created_at: '2026-07-25T00:00:00Z',
        session_id: 'a',
        props: { paper: 'writings' },
        path: '/#writings',
        country: 'US',
        city: 'Boston',
        device: 'mobile',
        os: 'ios',
        referrer: 'https://t.co/abc',
      },
      {
        name: 'essay_open',
        created_at: '2026-07-25T00:00:00Z',
        session_id: 'b',
        props: { slug: 'surveiled' },
        path: '/#writings/surveiled',
        country: 'CA',
        city: 'Toronto',
        device: 'desktop',
        os: 'mac',
        referrer: 'https://www.linkedin.com/in/foo',
      },
      {
        name: 'page_view',
        created_at: '2026-07-25T00:00:00Z',
        session_id: 'c',
        props: {},
        path: '/?utm_source=x',
        country: 'US',
        city: null,
        device: 'desktop',
        os: 'mac',
        referrer: null,
      },
    ]);
    assert.equal(out.totalEvents, 4);
    assert.equal(out.uniqueSessions, 3);
    assert.equal(out.byPaper.writings, 1);
    assert.equal(out.byEssay.surveiled, 1);
    assert.equal(out.byCity['Boston, US'], 1);
    assert.equal(out.byCity['Toronto, CA'], 1);
    assert.equal(out.byCity.US, 1);
    assert.equal(out.byDevice.mobile, 1);
    assert.equal(out.byOs.mac, 2);
    assert.equal(out.byReferrer.x, 2);
    assert.equal(out.byReferrer.linkedin, 1);
    assert.equal(out.byLanding['/'], 1);
    assert.equal(out.byLanding['/?utm_source=x'], 1);
  });
});

describe('dashboard visuals', () => {
  it('uses a line chart and shows geo/device/referrer sections', () => {
    const html = readFileSync(join(root, 'analytics.html'), 'utf8');
    assert.match(html, /stroke-linejoin="round"/);
    assert.match(html, /city-bars/);
    assert.match(html, /landing-bars/);
    assert.match(html, /device-bars/);
    assert.match(html, /os-bars/);
    assert.match(html, /referrer-bars/);
  });
});
