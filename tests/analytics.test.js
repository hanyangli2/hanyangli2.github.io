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

describe('summarize', () => {
  it('aggregates papers and essays', () => {
    const { summarize } = require('../api/analytics.js');
    const out = summarize([
      { name: 'page_view', created_at: '2026-07-25T00:00:00Z', session_id: 'a', props: {} },
      { name: 'paper_open', created_at: '2026-07-25T00:00:00Z', session_id: 'a', props: { paper: 'writings' } },
      { name: 'essay_open', created_at: '2026-07-25T00:00:00Z', session_id: 'b', props: { slug: 'surveiled' } },
    ]);
    assert.equal(out.totalEvents, 3);
    assert.equal(out.uniqueSessions, 2);
    assert.equal(out.byPaper.writings, 1);
    assert.equal(out.byEssay.surveiled, 1);
  });
});
