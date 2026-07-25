import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackEvent } from '../assets/track.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSIGHTS_SCRIPT = '/_vercel/insights/script.js';

describe('Vercel Analytics coverage', () => {
  it('includes the insights script on every root HTML page', () => {
    const pages = readdirSync(root).filter((name) => name.endsWith('.html')).sort();
    assert.ok(pages.includes('index.html'), 'expected index.html to exist');

    const missing = pages.filter((name) => {
      const html = readFileSync(join(root, name), 'utf8');
      return !html.includes(INSIGHTS_SCRIPT);
    });

    assert.deepEqual(
      missing,
      [],
      `missing ${INSIGHTS_SCRIPT} in: ${missing.join(', ')}`
    );
  });

  it('bootstraps the va queue before the insights script on index.html', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const vaIdx = html.indexOf('window.va');
    const scriptIdx = html.indexOf(`src="${INSIGHTS_SCRIPT}"`);
    assert.ok(vaIdx !== -1, 'expected window.va bootstrap');
    assert.ok(scriptIdx !== -1, 'expected insights script');
    assert.ok(vaIdx < scriptIdx, 'va queue must be defined before insights script');
  });
});

describe('trackEvent helper', () => {
  beforeEach(() => {
    globalThis.window = globalThis;
    delete globalThis.va;
  });

  it('queues a named event through window.va', () => {
    const calls = [];
    globalThis.va = (...args) => calls.push(args);
    trackEvent('paper_open', { paper: 'writings' });
    assert.deepEqual(calls, [
      ['event', { name: 'paper_open', data: { paper: 'writings' } }],
    ]);
  });

  it('no-ops when va is missing', () => {
    assert.doesNotThrow(() => trackEvent('essay_open', { slug: 'surveiled' }));
  });
});

describe('desk custom events in index.html', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');

  it('loads assets/track.js on the desk page', () => {
    assert.match(html, /<script[^>]+src=["']assets\/track\.js["']/);
  });

  it('tracks paper opens', () => {
    assert.match(html, /track\(\s*['"]paper_open['"]/);
  });

  it('tracks essay opens', () => {
    assert.match(html, /track\(\s*['"]essay_open['"]/);
  });

  it('tracks successful doodle submits', () => {
    assert.match(html, /track\(\s*['"]doodle_submit['"]/);
  });
});
