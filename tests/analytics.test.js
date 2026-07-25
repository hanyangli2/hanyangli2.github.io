import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSIGHTS_SCRIPT = '/_vercel/insights/script.js';

function rootHtmlPages() {
  return readdirSync(root)
    .filter((name) => name.endsWith('.html'))
    .sort();
}

describe('Vercel Analytics coverage', () => {
  it('includes the insights script on every root HTML page', () => {
    const pages = rootHtmlPages();
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

  it('loads the insights script with defer on index.html', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    assert.match(
      html,
      /<script\s+defer\s+src="\/_vercel\/insights\/script\.js"><\/script>/
    );
  });
});
