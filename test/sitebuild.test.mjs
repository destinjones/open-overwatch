// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The site build's fallbacks (.github/build_site.py), run in Python with the network replaced by a fake (nothing is fetched,
// least of all CelesTrak): a GDELT failure keeps the live site's news copy, a partial run fills the gaps from it, a kept TLE
// group shows its elements' real age, and the sitemap is dated from git. Skipped when no Python is installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tleEpochMs } from '../src/core/tle.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const py = ['python3', 'python'].find(p => spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)']).status === 0);

// the module with sleep and urlopen faked: LIVE is the live site's files, ANSWER(url) a source's answer (None: it fails)
const prelude = `
import sys, os, io, json, time, urllib.request, importlib.util
time.sleep = lambda s: None
LIVE, ANSWER, ASKED = {}, (lambda url: None), []
class Resp(io.BytesIO): pass
def urlopen(req, timeout=None):
    url = req.full_url if hasattr(req, 'full_url') else req
    ASKED.append(url)
    if url.startswith(b.SITE):
        if url[len(b.SITE):] in LIVE: return Resp(LIVE[url[len(b.SITE):]])
        raise OSError('404')
    a = ANSWER(url)
    if a is None: raise OSError('refused')
    return Resp(a)
urllib.request.urlopen = urlopen
spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(join(root, '.github/build_site.py'))}); b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
d = sys.argv[1]
`;
const run = (body) => {
  const dir = mkdtempSync(join(tmpdir(), 'oo-sitebuild-'));
  try {
    const r = spawnSync(py, ['-c', prelude + body, dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n');
    return { out: JSON.parse(lines.pop()), log: lines.join('\n') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('news: GDELT refusing every request keeps the live site\'s copy byte for byte', { skip: !py && 'no Python here' }, () => {
  const { out } = run(`
facts = {'countries': {'AA': {'name': 'Aland', 'gdp': 3}, 'BB': {'name': 'Bland', 'gdp': 2}, 'CC': {'name': 'Cland', 'gdp': 1}}}
cp = os.path.join(d, 'countries.json'); json.dump(facts, open(cp, 'w'))
LIVE['data/news.json'] = b'{"t":1,"countries":{"AA":[]}}'
b.mirror_news(os.path.join(d, 'a', 'news.json'), cp)
del LIVE['data/news.json']
b.mirror_news(os.path.join(d, 'b', 'news.json'), cp)
b.mirror_news(os.path.join(d, 'c', 'news.json'), os.path.join(d, 'missing.json'))
print(json.dumps({'a': open(os.path.join(d, 'a', 'news.json')).read(), 'b': os.path.exists(os.path.join(d, 'b', 'news.json')), 'gdelt': sum('gdeltproject' in u for u in ASKED)}))
`);
  assert.equal(out.a, '{"t":1,"countries":{"AA":[]}}');
  assert.equal(out.b, false, 'no live copy either: nothing to keep');
  assert.equal(out.gdelt, 6, 'three failures in a row end each run');
});

test('news: a partial run keeps the fresh countries and fills the failed ones from the live copy, up to 3 days old', { skip: !py && 'no Python here' }, () => {
  const { out } = run(`
facts = {'countries': {k: {'name': k + 'land', 'gdp': g} for k, g in (('AA', 9), ('BB', 8), ('CC', 7), ('DD', 6), ('EE', 5))}}
cp = os.path.join(d, 'countries.json'); json.dump(facts, open(cp, 'w'))
now = int(time.time() * 1000)
art = {'title': 'Fresh', 'url': 'https://example.org/a', 'domain': 'example.org', 'seendate': '20261017T000000Z'}
ANSWER = lambda url: json.dumps({'articles': [art]}).encode() if 'AAland' in url else None
LIVE['data/news.json'] = json.dumps({'t': now - 3600e3, 'countries': {'AA': [{'title': 'Old'}], 'BB': [{'title': 'B'}], 'CC': [{'title': 'C'}], 'DD': [{'title': 'D'}], 'ZZ': [{'title': 'gone'}]},
  'kept': {'DD': now - 5 * 86400e3, 'CC': now - 7200e3}}).encode()
p = os.path.join(d, 'news.json'); b.mirror_news(p, cp)
print(json.dumps({'doc': json.load(open(p)), 'now': now}))
`);
  const { doc, now } = out;
  assert.deepEqual(Object.keys(doc.countries).sort(), ['AA', 'BB', 'CC'], 'AA fresh, BB and CC kept, DD too old, ZZ no longer a target');
  assert.equal(doc.countries.AA[0].title, 'Fresh');
  assert.deepEqual(Object.keys(doc.kept).sort(), ['BB', 'CC']);
  assert.ok(Math.abs(doc.kept.BB - (now - 3600e3)) < 1000, 'BB keeps the old copy\'s time');
  assert.ok(Math.abs(doc.kept.CC - (now - 7200e3)) < 1000, 'CC keeps the time it was first fetched');
  assert.ok(doc.t >= now);
});

test('tle: a kept group records its newest element epoch and warns when it is over 48 h old', { skip: !py && 'no Python here' }, () => {
  const iss = readFileSync(join(root, 'test/fixtures/stations.tle'), 'utf8');
  const { out, log } = run(`
iss = open(${JSON.stringify(join(root, 'test/fixtures/stations.tle'))}).read()
LIVE['data/tle/stations.txt'] = iss.encode()
ANSWER = lambda url: iss.encode() if 'GROUP=visual&' in url else None
idx = b.mirror_tles(os.path.join(d, 'tle'))
print(json.dumps({'idx': idx, 'file': json.load(open(os.path.join(d, 'tle', 'index.json')))}))
`);
  const newest = Math.max(...iss.split('\n').filter(l => l.startsWith('1 ')).map(tleEpochMs));
  const isoS = new Date(Math.floor(newest / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  assert.deepEqual(out.idx, out.file);
  assert.equal(out.idx.groups.stations, 3);
  assert.deepEqual(out.idx.kept, ['stations']);
  assert.equal(out.idx.epochs.stations, isoS, 'the same epoch the browser computes');
  assert.equal(out.idx.epochs.visual, isoS);
  assert.equal(out.idx.oldest, isoS);
  assert.deepEqual(Object.keys(out.idx.epochs).sort(), ['stations', 'visual'], 'groups with no copy at all have no epoch');
  assert.match(log, /::warning::tle stations: the kept copy's newest elements are from /);
  assert.doesNotMatch(log, /::warning::tle visual/, 'a fresh download is not warned about');
});

test('sitemap: every lastmod is the day its page last changed in git', { skip: !py && 'no Python here' }, () => {
  const { out } = run(`
p = os.path.join(d, 'sitemap.xml')
open(p, 'w').write(open(${JSON.stringify(join(root, 'sitemap.xml'))}).read())
asked = []
n = b.date_sitemap(p, lambda page: (asked.append(page), '' if page == 'solar.html' else '2027-01-0' + str(len(asked)))[1])
fake = open(p).read()
open(p, 'w').write(open(${JSON.stringify(join(root, 'sitemap.xml'))}).read())
b.date_sitemap(p)
print(json.dumps({'n': n, 'asked': asked, 'fake': fake, 'real': open(p).read()}))
`);
  assert.deepEqual(out.asked, ['index.html', 'india/index.html', 'about.html', 'guide.html', 'tonight.html', 'globe.html', 'solar.html', 'open-overwatch.html']);
  assert.equal(out.n, 7, 'a page git knows nothing about keeps its date');
  assert.match(out.fake, /open-overwatch\/<\/loc><lastmod>2027-01-01<\/lastmod>/);
  assert.match(out.fake, /india\/<\/loc><lastmod>2027-01-02<\/lastmod>/);
  const repo = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  assert.equal(out.fake.match(/solar\.html<\/loc><lastmod>([^<]+)/)[1], repo.match(/solar\.html<\/loc><lastmod>([^<]+)/)[1]);
  const day = (...paths) => execFileSync('git', ['log', '-1', '--format=%cs', '--', ...paths], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(out.real.match(/globe\.html<\/loc><lastmod>([^<]+)/)[1], day('globe.html', 'src', 'data'), 'an app page also counts its modules and data');
  assert.equal(out.real.match(/about\.html<\/loc><lastmod>([^<]+)/)[1], day('about.html'), 'a plain page counts only itself');
});
