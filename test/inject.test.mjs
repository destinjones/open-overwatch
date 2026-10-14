// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { num, idArg, esc } from '../src/core/format.js';

test('num: text where a number should be becomes 0, numbers pass', () => {
  for (const evil of ['1);alert(1);//', 'NaN', '', null, undefined, {}, [], 'x', Infinity]) assert.equal(num(evil), 0, String(evil));
  assert.equal(num('12.5'), 12.5); assert.equal(num(-3), -3); assert.equal(num(0), 0);
  assert.equal(`flyTo(${num('1);alert(1);//')},${num(8)},9)`, 'flyTo(0,8,9)');
});

test('idArg: only word characters, dot, tilde and hyphen survive', () => {
  assert.equal(idArg("x');alert(1);//"), 'xalert1'); assert.equal(idArg('~4ca123'), '~4ca123'); assert.equal(idArg('A1-b.2_c'), 'A1-b.2_c'); assert.equal(idArg(null), '');
  assert.ok(!/['"()<>;\s&]/.test(idArg('"><img src=x onerror=alert(1)>')));
});

test('esc does the HTML part', () => {
  assert.equal(esc('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(esc(null), ''); assert.equal(esc(undefined), ''); assert.equal(esc(0), '0');   // the 2D map's escaper did this; it is the only one now
});

// The 2D map builds HTML from feed data, and anything an uploader can influence (a SondeHub balloon, an ADS-B hex) must not reach a
// handler unsanitised. Its HTML carries no inline handlers at all (the page's CSP has no 'unsafe-inline', so they would not run):
// buttons say data-do="action" with data-* arguments, one listener in main.js runs a fixed list of actions, and every ${...} in
// those arguments is wrapped in num(...) or idArg(...).
test('the 2D map: no inline handlers; data-do buttons name known actions and wrap what they interpolate', () => {
  const dir = new URL('../src/map/', import.meta.url); let seen = 0; const bad = [], acts = new Set();
  const main = readFileSync(new URL('main.js', dir), 'utf8'), table = main.match(/const ACTIONS = \{([\s\S]*?)\n\};/)[1];
  const known = new Set([...table.matchAll(/(?:^|[\s,{])'?([\w-]+)'?:\s*(?:\(|d\b)/g)].map(m => m[1]));
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    for (const m of text.matchAll(/\son[a-z]+\s*=\s*["']/gi)) bad.push(`${f}: inline handler ${m[0].trim()}`);
    for (const m of text.matchAll(/<[a-z]+\b[^<>]*\bdata-do="([^"]*)"[^<>]*>/g)) {
      acts.add(m[1]); if (!known.has(m[1])) bad.push(`${f}: data-do="${m[1]}" is not in main.js ACTIONS`);
      for (const a of m[0].matchAll(/\bdata-[\w-]+="([^"]*)"/g)) for (const e of a[1].matchAll(/\$\{([^}]*)\}/g)) { seen++; if (!/^\s*(num|idArg)\(/.test(e[1])) bad.push(`${f}: ${a[0]}`); }
    }
  }
  assert.ok(seen >= 10 && acts.has('fly') && acts.has('air-trail'), 'expected to find the existing buttons');
  assert.deepEqual(bad, []);
});
