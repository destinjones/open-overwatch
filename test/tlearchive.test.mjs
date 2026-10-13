// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The site build's element-set archive (.github/build_site.py archive_tles), run in Python against a scratch folder:
// one snapshot a day, earlier days carried over from the previous build (cache or live site), 30 days kept, nothing made
// from a build whose downloads failed. Skipped when no Python is installed. The groups must match src/core/history.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVED_GROUPS, TLE_HISTORY_DAYS, parseHistoryIndex } from '../src/core/history.js';
import { parseTle } from '../src/core/tle.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const py = ['python3', 'python'].find(p => spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)']).status === 0);

test('tle archive: the build keeps the same groups and days as the browser expects', () => {
  const src = readFileSync(join(root, '.github/build_site.py'), 'utf8');
  const list = src.match(/TLE_ARCHIVED = \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(list, [...ARCHIVED_GROUPS]);
  assert.equal(+src.match(/TLE_HISTORY_DAYS = (\d+)/)[1], TLE_HISTORY_DAYS);
});

test('tle archive: a snapshot a day, carried over, pruned, never from a failed download', { skip: !py && 'no Python here' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'oo-tlearch-'));
  try {
    const script = `
import sys, os, json, importlib.util
spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(join(root, '.github/build_site.py'))}); b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
d = sys.argv[1]; tle = os.path.join(d, 'tle'); cache = os.path.join(d, 'cache'); os.makedirs(tle)
iss = open(${JSON.stringify(join(root, 'test/fixtures/stations.tle'))}).read()
for g in b.TLE_ARCHIVED[:12]: open(os.path.join(tle, g + '.txt'), 'w').write(iss)
open(os.path.join(tle, 'starlink.txt'), 'w').write(iss.replace('25544', '44713'))
live = {}   # the live site: an index with an old day (pruned) and one inside the window
live['data/tle/history/index.json'] = json.dumps({'days': [{'day': '2026-08-01', 'at': 1, 'n': 1}, {'day': '2026-10-10', 'at': 1791590400000, 'n': 3}, {'day': '../x', 'at': 1, 'n': 1}]}).encode()
live['data/tle/history/2026-10-10.txt'] = b'1 25544U 98067A   26283.0\\n2 25544\\n'
fetch = lambda rel: live.get(rel)
day = 1791849600   # 2026-10-13 00:00 UTC
r1 = b.archive_tles(tle, kept=[], now=day + 1800, fetch=fetch, cache=cache)
r2 = b.archive_tles(tle, kept=[], now=day + 6 * 3600, fetch=lambda rel: None, cache=cache)   # later the same day: from the cache, not remade
os.remove(os.path.join(tle, 'history', '2026-10-13.txt'))
tle2 = os.path.join(d, 'tle2'); os.makedirs(tle2)
r3 = b.archive_tles(tle2, kept=b.TLE_ARCHIVED, now=day + 86400 + 60, fetch=lambda rel: None, cache=cache)   # next day, CelesTrak down: no new day
print(json.dumps({'r1': r1, 'r2': r2, 'r3': r3, 'snap': open(os.path.join(tle, 'history', '2026-10-10.txt')).read(), 'cache': sorted(os.listdir(cache)),
  'today': open(os.path.join(cache, '2026-10-13.txt')).read()}))
`;
    const r = spawnSync(py, ['-c', script, dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepEqual(out.r1.days.map(d => d.day), ['2026-10-13', '2026-10-10'], 'today made, the old day pruned, the bad name ignored');
    assert.deepEqual(out.r1.groups, [...ARCHIVED_GROUPS]);
    assert.equal(out.r1.days[0].at, (1791849600 + 1800) * 1000);
    assert.equal(out.r1.days[0].n, 3, 'each satellite once, though twelve groups had it');
    assert.deepEqual(parseTle(out.today).map(t => t.id), ['25544', '48274', parseTle(out.today)[2].id]);
    assert.ok(!out.today.includes('ISS'), 'bare two-line sets: the names come from today\'s copy');
    assert.ok(!out.today.includes('44713'), 'Starlink is not archived');
    assert.equal(out.r2.days[0].at, out.r1.days[0].at, 'one snapshot a day');
    assert.deepEqual(out.r3.days.map(d => d.day), ['2026-10-13', '2026-10-10'], 'nothing new from a failed day; the earlier days kept from the cache');
    assert.deepEqual(out.cache, ['2026-10-10.txt', '2026-10-13.txt', 'index.json']);
    assert.deepEqual(parseHistoryIndex(out.r3).map(d => d.day), ['2026-10-10', '2026-10-13'], 'the browser reads what the build writes');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
