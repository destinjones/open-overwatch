// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The landing pages (index.html, india/, tonight.html, 404.html, README.md) as people and search engines first meet them:
// the share and search text promises only what the website shows (it leads with the zoom, satellites, storms, quakes
// and Tonight; live aircraft only come with the free download), no number on them goes stale, phones are spared bytes
// and frames nobody asked for, the phone nav and the landmarks are there, and the 404 page fixes the obvious typos
// without looping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cdnTags, inlineScripts } from '../src/core/sricheck.js';
import { parseAttrs } from '../src/core/a11ycheck.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const head = html => html.slice(0, html.indexOf('</head>'));
const DOWNLOAD = 'Live aircraft come with the free download.';
const PLANES = /\b(aircraft|planes?|flights?)\b/i;
/** The text a search result or a link preview shows: description metas, og/twitter descriptions, the image alt, JSON-LD. */
function blurbs(html) {
  const out = [];
  for (const m of head(html).matchAll(/<meta\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1]), k = a.name || a.property || '';
    if (/^(description|og:description|twitter:description|og:image:alt)$/.test(k)) out.push([k, a.content || '']);
  }
  for (const m of head(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const walk = o => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) k === 'description' ? out.push(['ld+json', v]) : walk(v); };
    walk(JSON.parse(m[1]));
  }
  return out;
}

test('search and share text leads with what the website shows; aircraft only with the download', () => {
  for (const p of ['index.html', 'about.html', 'guide.html']) {
    const b = blurbs(read(p));
    assert.ok(b.length >= 3, p);
    for (const [k, t] of b) {
      assert.doesNotMatch(t, /^(live )?(aircraft|planes)/i, `${p} ${k} leads with aircraft`);
      if (/aircraft|planes|military flights/i.test(t)) assert.ok(t.includes(DOWNLOAD), `${p} ${k} promises aircraft without the download: ${t}`);
    }
  }
  const idx = blurbs(read('index.html')).map(([, t]) => t).join(' ');
  for (const w of ['satellites', 'weather', 'storms', '3D Earth']) assert.ok(idx.includes(w), w);
  const readme = read('README.md'), lead = readme.slice(readme.indexOf('**From'), readme.indexOf('**▶'));
  assert.doesNotMatch(lead, /aircraft over your street/);
  assert.ok(lead.includes(DOWNLOAD), 'the README lead says where aircraft are');
  assert.match(readme, /\*\*2D ops map:\*\* ships[^\n]*\n[^\n]*free download/);
  // the install sheet (description, screenshot labels) and the app's shortcuts: the installed app is the website
  const app = JSON.parse(read('manifest.webmanifest'));
  assert.ok(app.screenshots?.length && app.shortcuts?.length, 'the manifest has screenshots and shortcuts to check');
  for (const t of [app.description, ...app.screenshots.map(s => s.label), ...app.shortcuts.map(s => s.name)]) assert.doesNotMatch(t, PLANES, 'the installed app is the website: ' + t);
});

test('the hero leads with the zoom, not with planes', () => {
  const index = read('index.html');
  const hero = index.slice(index.indexOf('<header class="hero"'), index.indexOf('</header>', index.indexOf('<header class="hero"')));
  const h1 = hero.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, '');
  assert.match(h1, /cosmic web/i);
  assert.doesNotMatch(h1, PLANES);
  const lede = hero.match(/<p class="lede[^"]*">([\s\S]*?)<\/p>/)[1];
  assert.doesNotMatch(lede, PLANES, 'the lede lists what the browser draws');
  for (const [, alt] of hero.matchAll(/<img\b[^>]*\balt="([^"]*)"/g)) assert.doesNotMatch(alt, PLANES, `the hero picture promises flights: ${alt}`);
  const note = hero.match(/<p class="cta-note[^"]*">([\s\S]*?)<\/p>/)[1];
  assert.match(note, /planes come with the <a href="#get">free download<\/a>/);
  assert.doesNotMatch(hero, /11,737|data-n="11737"/, 'the old plane count is not the hook');
  // the first proof numbers and the first clip are things the website shows
  const firstStat = index.match(/<div class="stat rv"><b data-n="\d+"[^>]*>0<\/b><span>([^<]+)<\/span>/)[1];
  assert.equal(firstStat, 'satellites');
  assert.equal(index.match(/<button class="tab" role="tab" data-clip="([^"]+)"/)[1], 'space');
  for (const m of index.matchAll(/<span class="d">([^<]*)<\/span>/g)) if (PLANES.test(m[1]) || /transponders/.test(m[1])) assert.match(m[1], /download/, m[1]);
  for (const [, c] of index.matchAll(/<span class="chip"[^>]*>([^<]*)<\/span>/g)) if (PLANES.test(c) || /squawk/i.test(c)) assert.match(c, /free download/, c);
  // the README says the same on GitHub
  const readme = read('README.md'), intro = readme.slice(readme.indexOf('**From'), readme.indexOf('\n\n', readme.indexOf('**From')));
  assert.ok(intro.length > 100, 'the README opens with the zoom');
  for (const s of intro.split(/(?<=\.)\s/)) if (PLANES.test(s)) assert.match(s, /download/, s);
});

test('no hand-kept numbers that age: the release count comes from versions.json, the test count is not a number', () => {
  const index = read('index.html');
  assert.doesNotMatch(index, /Fourteen releases|By 6 October it was/);
  const script = index.slice(index.indexOf("fetch('versions.json'"));
  assert.match(script, /\$\('#relHead'\)\.textContent = `\$\{vs\.length\} release/, 'the heading counts every release, online or zipped');
  assert.match(script, /\$\('#relNow'\)\.textContent = `The newest, \$\{vs\[0\]\.tag\}/);
  assert.match(index, /<h2 class="rv" id="relHead">[^<]+<\/h2>/);
  assert.match(index, /<span id="relNow"><\/span>/);
  assert.doesNotMatch(read('about.html'), /<b>[\d,]+<\/b><span>automated tests/, 'about.html: the test count changes every week');
});

test('model-viewer loads at an idle moment after load, pinned and hashed, never on Save-Data by itself; models only on a tap', () => {
  const html = read('index.html');
  assert.doesNotMatch(head(html), /<script[^>]*model-viewer/, 'no 3D library in the head');
  const tpl = html.match(/<template id="mvLib">([\s\S]*?)<\/template>/);
  assert.ok(tpl, 'the tag waits in <template id="mvLib">');
  const [tag] = cdnTags(tpl[1]);
  assert.match(tag.url, /@google\/model-viewer@\d+\.\d+\.\d+\//);
  assert.match(tag.attrs.integrity, /^sha384-/);
  assert.equal(tag.attrs.crossorigin, 'anonymous');
  const js = inlineScripts(html).map(s => s.text).join('\n');
  assert.match(js, /\$\('#mvLib'\)\.content\.querySelector\('script'\)/);
  assert.match(js, /s\.integrity = t\.getAttribute\('integrity'\)/);
  assert.match(js, /s\.crossOrigin = 'anonymous'/);
  assert.match(js, /if \(slowNet\)[^\n]*\nelse whenIdle\(loadMv\);/, 'the library at an idle moment, not on a slow or Save-Data connection');
  assert.match(js, /requestIdleCallback\(fn, \{ timeout: 4000 \}\)/);
  assert.doesNotMatch(html, /<model-viewer\b[^>]*\ssrc=/, 'no model in the markup: it waits for a tap');
  assert.match(html, /<button class="mv-poster" id="mvPoster" type="button">/);
  assert.match(js, /if \(live\) mv\.src = glb\(k\);/);
  assert.match(js, /mv\.toggleAttribute\('auto-rotate', e\.isIntersecting\)/, 'no spinning off screen');
});

test('the phone demos wait for a tap on phones and slow or Save-Data connections', () => {
  for (const [p, js] of [['index.html', inlineScripts(read('index.html')).map(s => s.text).join('\n')], ['india/india.js', read('india/india.js')]]) {
    assert.match(js, /conn\.saveData \|\| \/2g\|3g\/\.test\(conn\.effectiveType/, p);
    assert.match(js, /started = !\(slowNet \|\| matchMedia\('\(max-width:760px\)'\)\.matches\)/, p);
    assert.match(js, /if \(e\.isIntersecting\) \{ if \(!started\) return;/, `${p}: no clip before the tap`);
  }
  for (const p of ['index.html', 'india/index.html']) assert.match(read(p), /<button class="play" id="phonePlay" type="button" aria-label="[^"]+" hidden>/, p);
});

test('lighter on phones: the scan line moves by transform and pauses off screen; no grain, no blurs under 760px', () => {
  const html = read('index.html');
  assert.match(html, /@keyframes scan\{from\{transform:translateY\(-100%\)\}to\{transform:translateY\([^)]+\)\)?\}\}/);
  assert.doesNotMatch(html, /@keyframes scan\{[^}]*top:/);
  assert.match(html, /\.hero\.off \.scan\{animation:none\}/);
  assert.match(inlineScripts(html).map(s => s.text).join('\n'), /\$\('#top'\)\.classList\.toggle\('off', !e\.isIntersecting\)/);
  const phone = html.slice(html.lastIndexOf('@media (max-width:760px){'));
  assert.match(phone, /body::after\{display:none\}/);
  assert.match(phone, /nav\.solid,\.feed,\.ways article\{backdrop-filter:none\}/);
  assert.match(read('india/index.html'), /@media \(max-width:760px\)\{\s*nav\.solid,\.feed\{backdrop-filter:none\}/);
});

test('a menu button on phones opens the same links', () => {
  for (const [p, js] of [['index.html', inlineScripts(read('index.html')).map(s => s.text).join('\n')], ['india/index.html', read('india/india.js')]]) {
    const html = read(p);
    assert.match(html, /<div class="links" id="navLinks">/, p);
    assert.match(html, /<button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="navLinks" aria-label="Menu">/, p);
    assert.match(html, /nav\.open \.links\{display:flex/, p);
    assert.match(js, /menuBtn\.setAttribute\('aria-expanded', String\(open\)\)/, p);
    assert.match(js, /e\.key === 'Escape'/, p);
  }
});

test('landmarks: Tonight has a main and an h1, the India page a main, and the India page a skip link', () => {
  const tn = read('tonight.html');
  assert.match(tn, /<main id="main">\s*<h1 class="vh">Tonight above you<\/h1>\s*<section id="card"/);
  assert.match(tn, /\.vh\{position:absolute;width:1px;height:1px/);
  for (const p of ['india/index.html', 'index.html']) {
    const html = read(p);
    assert.match(html, /<main id="main">\s*<header class="hero" id="top">/, p);
    assert.ok(html.indexOf('</main>') < html.indexOf('<footer>'), p);
  }
  assert.match(read('src/app/a11y.js'), /india\(\) \{ skipLink\('main, #top h1, h1', 'Skip to the content'\); \}/);
});

/** Runs 404.html's script at a path; returns where it sent the browser (or null) and what it wrote on the page. */
function notFound(pathname, search = '', hash = '') {
  const [script] = inlineScripts(read('404.html'));
  const out = { to: null, text: null };
  const location = { pathname, search, hash, replace: u => { out.to = u; } };
  const document = { getElementById: id => id === 'what' ? { set textContent(t) { out.text = t; } } : null };
  new Function('location', 'document', script.text)(location, document);
  return out;
}

test('404.html: trailing punctuation and /india are fixed once, other paths stay with the links', () => {
  assert.equal(notFound('/open-overwatch/globe.html.').to, '/open-overwatch/globe.html');
  assert.equal(notFound('/open-overwatch/tonight.html),').to, '/open-overwatch/tonight.html');
  assert.equal(notFound('/open-overwatch/globe.html%22').to, '/open-overwatch/globe.html');
  assert.equal(notFound('/open-overwatch/globe.html%20', '?embed=1', '#c=1,2').to, '/open-overwatch/globe.html?embed=1#c=1,2');
  assert.equal(notFound('/open-overwatch/globe.html%E2%80%9D').to, '/open-overwatch/globe.html', 'a curly quote from a phone keyboard');
  assert.equal(notFound('/open-overwatch/tonight.html%E2%80%A6%E2%80%8B').to, '/open-overwatch/tonight.html', 'an ellipsis and a zero-width space');
  assert.equal(notFound('/open-overwatch/India').to, '/open-overwatch/india/');
  assert.equal(notFound('/open-overwatch/india!').to, '/open-overwatch/india/');
  for (const p of ['/open-overwatch/globe.html', '/open-overwatch/india/', '/open-overwatch/nothing-here.html', '/open-overwatch/', '/']) {
    const r = notFound(p);
    assert.equal(r.to, null, `${p}: a fixed path is left alone, so a missing page never loops`);
    assert.ok(r.text.includes(p), p);
  }
  assert.equal(notFound('/open-overwatch/x%E0%A4').to, null, 'a broken escape does not throw');
  assert.equal(notFound('/open-overwatch/%E0%A4%AD.').to, '/open-overwatch/%E0%A4%AD', 'non-ASCII paths go back encoded');
  const page = read('404.html');
  assert.match(page, /<meta name="robots" content="noindex">/);
  for (const [, url] of page.matchAll(/(?:href|src)="([^"]+)"/g)) assert.match(url, /^\/open-overwatch\//, `${url}: GitHub serves this page at any depth`);
  assert.doesNotMatch(read('sw.js'), /404/, 'the worker never saves the 404 page');
});
