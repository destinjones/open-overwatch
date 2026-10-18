// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// sri.mjs — the supply-chain check of every page (src/core/sricheck.js), and the two chores it asks for.
//   node brand/tools/sri.mjs                 check every page; exit code 1 on a problem (CI: test/sri.test.mjs)
//   node brand/tools/sri.mjs --csp           after editing an inline <script>: rewrite each page's CSP hash list
//   node brand/tools/sri.mjs --fetch         download every pinned CDN file and compare it with the page's sha384
//   node brand/tools/sri.mjs --fetch --write ...and write the hashes (after bumping a version; add the integrity=""
//                                            and crossorigin="anonymous" attributes, or the import map entry, first)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkPage, EVAL_OK, cdnTags, importMaps, withCspHashes, cdnUrlsIn } from '../../src/core/sricheck.js';

const root = new URL('../../', import.meta.url);
export const PAGES = [...readdirSync(root).filter(f => f.endsWith('.html')).sort(), 'india/index.html', 'india/hi/index.html', 'teach/index.html', 'sky/index.html', 'sky/hi/index.html'];   // + the folder pages (sky/: the committed stand-ins; test/skypages.test.mjs checks the built ones)
const sha256 = t => createHash('sha256').update(t, 'utf8').digest('base64');
const sha384 = b => 'sha384-' + createHash('sha384').update(b).digest('base64');
const read = p => readFileSync(new URL(p, root), 'utf8');
const args = new Set(process.argv.slice(2));

if (args.has('--csp')) {
  for (const p of PAGES) {
    const html = read(p), out = withCspHashes(html, sha256);
    if (out !== html) { writeFileSync(new URL(p, root), out); console.log('updated', p); }
  }
}

if (args.has('--fetch')) {
  const urls = new Set();
  for (const p of PAGES) {
    const html = read(p);
    for (const t of cdnTags(html)) urls.add(t.url);
    for (const m of importMaps(html)) for (const u of [...Object.values(m.imports), ...Object.keys(m.integrity)]) if (!u.endsWith('/')) urls.add(u);
  }
  const real = new Map();
  for (const u of urls) {
    const r = await fetch(u); if (!r.ok) { console.log(`✗ ${u}: HTTP ${r.status}`); continue; }
    real.set(u, sha384(Buffer.from(await r.arrayBuffer())));
  }
  for (const p of PAGES) {
    let html = read(p); const before = html;
    for (const t of cdnTags(html)) {
      const want = real.get(t.url); if (!want) continue;
      if (t.attrs.integrity !== want) {
        console.log(`${args.has('--write') ? 'fixing' : '✗'} ${p}:${t.line} ${t.url}\n    page ${t.attrs.integrity || '(none)'}\n    file ${want}`);
        if (args.has('--write') && 'integrity' in t.attrs) html = html.replace(`integrity="${t.attrs.integrity}"`, `integrity="${want}"`);
      }
    }
    for (const m of importMaps(html)) for (const u of [...Object.values(m.imports), ...Object.keys(m.integrity)]) {
      const want = real.get(u); if (!want || m.integrity[u] === want) continue;
      console.log(`${args.has('--write') && m.integrity[u] ? 'fixing' : '✗'} ${p}:${m.line} import map ${u}\n    page ${m.integrity[u] || '(none: add "' + u + '": "' + want + '" to "integrity")'}\n    file ${want}`);
      if (args.has('--write') && m.integrity[u]) html = html.replace(`"${m.integrity[u]}"`, `"${want}"`);
    }
    if (html !== before) writeFileSync(new URL(p, root), html);
  }
  if (!args.has('--write')) console.log(`fetched ${real.size} of ${urls.size} files`);
}

// the check itself (after any rewrite above)
const sri = new Map(); let bad = 0;
for (const p of PAGES) {
  const html = read(p);
  for (const t of cdnTags(html)) if (t.attrs.integrity && !sri.has(t.url)) sri.set(t.url, t.attrs.integrity);
  for (const m of importMaps(html)) for (const [u, h] of Object.entries(m.integrity)) if (!sri.has(u)) sri.set(u, h);
}
for (const p of PAGES) {
  const errs = checkPage(read(p), { sha256, sri, evalOk: EVAL_OK.has(p) });
  console.log(`${errs.length ? '✗' : '✓'} ${p}${errs.length ? `: ${errs.length} problem${errs.length === 1 ? '' : 's'}` : ''}`);
  for (const e of errs) console.log(`    ${p}:${e.line}  [${e.rule}] ${e.what}`);
  bad += errs.length;
}
// library URLs in the code (dynamic imports, worker importScripts) must be pinned and hashed on some page
const walk = d => readdirSync(new URL(d, root), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}${e.name}/`) : e.name.endsWith('.js') ? [`${d}${e.name}`] : []);
for (const f of walk('src/')) for (const u of cdnUrlsIn(read(f))) {
  if (!sri.has(u)) { console.log(`✗ ${f}: ${u} is not pinned with integrity on any page (a tag, or an import map "integrity" entry)`); bad++; }
}
process.exit(bad ? 1 : 0);
