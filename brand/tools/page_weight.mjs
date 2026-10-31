// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// page_weight.mjs — what each content page costs on first load, worked out from the files (no browser): the HTML, the
// same-origin stylesheets, the module scripts with their static imports, the fonts it preloads, and the images it fetches
// before any scroll (<img> without loading="lazy", the first <source> of a <picture>, video posters). Lazy images, videos
// and dynamic imports are listed apart: they only load on scroll or on a tap. Raw bytes and gzip (what Pages sends).
//   node brand/tools/page_weight.mjs              a table
//   node brand/tools/page_weight.mjs --json       the same as JSON (to compare a before and an after)
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, relative } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const PAGES = ['index.html', 'about.html', 'guide.html', 'teach/index.html', 'india/index.html', 'india/hi/index.html', '404.html', 'offline.html', 'sky/index.html'];

const gz = b => gzipSync(b, { level: 9 }).length;
const local = (from, url) => {
  if (!url || /^(?:[a-z]+:|\/\/|#)/i.test(url)) return null;
  const p = url.startsWith('/open-overwatch/') ? join(root, url.slice('/open-overwatch/'.length)) : join(dirname(from), url.split(/[?#]/)[0]);
  return existsSync(p) && statSync(p).isFile() ? normalize(p) : null;
};
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? (m[2] ?? m[3] ?? m[4]) : null; };

/** A module and everything it imports statically, once each. */
function moduleTree(file, seen) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of src.matchAll(/(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"()]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const p = local(file, m[1]); if (p) moduleTree(p, seen);
  }
}

export function weigh(page) {
  const file = join(root, page), html = readFileSync(file, 'utf8');
  const out = { page, html: { raw: Buffer.byteLength(html), gz: gz(html) }, css: [], js: [], fonts: [], img: [], lazy: [], later: [] };
  const add = (list, p) => { if (p && !list.includes(p)) list.push(p); };
  for (const t of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (attr(t, 'rel') || '').toLowerCase(), p = local(file, attr(t, 'href'));
    if (rel === 'stylesheet') add(out.css, p);
    else if (rel === 'preload' && attr(t, 'as') === 'font') add(out.fonts, p);
    else if (rel === 'preload' && attr(t, 'as') === 'image') add(out.img, p);
  }
  const mods = new Set();
  for (const t of html.match(/<script\b[^>]*\ssrc=[^>]*>/gi) || []) { const p = local(file, attr(t, 'src')); if (p) moduleTree(p, mods); }
  for (const p of mods) {
    add(out.js, p);
    if (/src[\\/]app[\\/]shell\.js$/.test(p)) add(out.css, join(dirname(p), 'shell.css'));   // shell.js adds it unless the page links it
  }
  const body = html.replace(/<template\b[\s\S]*?<\/template>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  for (const pic of body.match(/<picture\b[\s\S]*?<\/picture>/gi) || []) {
    const s = pic.match(/<source\b[^>]*>/i), i = pic.match(/<img\b[^>]*>/i);
    const lazy = i && /loading\s*=\s*["']?lazy/i.test(i[0]);
    const src = s ? (attr(s[0], 'srcset') || '').trim().split(/\s+/)[0] : i && attr(i[0], 'src');
    add(lazy ? out.lazy : out.img, local(file, src));
  }
  for (const t of body.replace(/<picture\b[\s\S]*?<\/picture>/gi, '').match(/<img\b[^>]*>/gi) || []) {
    add(/loading\s*=\s*["']?lazy/i.test(t) ? out.lazy : out.img, local(file, attr(t, 'src')));
  }
  for (const t of body.match(/<video\b[^>]*>/gi) || []) add(out.img, local(file, attr(t, 'poster')));
  for (const t of body.match(/<(?:source|iframe)\b[^>]*>/gi) || []) add(out.later, local(file, attr(t, 'src')));
  // fonts: the latin files of the families the page's CSS names (fonts.css downloads a face only when text uses it), and
  // the Devanagari one where the page has Hindi and its own styles set that face; preloading changes when they arrive, not whether
  if (out.css.some(p => /fonts\.css$/.test(p))) {
    const css = (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('') + out.css.filter(p => !/fonts\.css$/.test(p)).map(p => readFileSync(p, 'utf8')).join('');
    const fdir = join(root, 'brand/fonts');
    const want = [];
    if (/Barlow/.test(css)) want.push('barlow-400-latin', 'barlow-500-latin', 'barlow-600-latin');
    if (/Big Shoulders/.test(css)) want.push('big-shoulders-display-var-latin');
    if (/IBM Plex Mono/.test(css)) want.push('ibm-plex-mono-400-latin', 'ibm-plex-mono-500-latin');
    if (/Noto Sans Devanagari/.test((html.match(/<style[\s\S]*?<\/style>/gi) || []).join('')) && /[ऀ-ॿ]/.test(html)) want.push('noto-sans-devanagari-var-devanagari');
    for (const w of want) add(out.fonts, join(fdir, w + '.woff2'));
  }
  const size = p => readFileSync(p);
  const sum = list => list.reduce((a, p) => { const b = size(p); a.raw += b.length; a.gz += /\.(?:css|js|mjs|svg|html)$/.test(p) ? gz(b) : b.length; return a; }, { raw: 0, gz: 0 });
  const rel = list => list.map(p => relative(root, p).replace(/\\/g, '/'));
  const t = { html: out.html, css: sum(out.css), js: sum(out.js), fonts: sum(out.fonts), img: sum(out.img) };
  t.total = Object.values(t).reduce((a, v) => ({ raw: a.raw + v.raw, gz: a.gz + v.gz }), { raw: 0, gz: 0 });
  return { page, totals: t, lazy: sum(out.lazy), files: { css: rel(out.css), js: rel(out.js), fonts: rel(out.fonts), img: rel(out.img), lazy: rel(out.lazy) } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const rows = PAGES.filter(p => existsSync(join(root, p))).map(weigh);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
  const kb = n => (n / 1024).toFixed(1).padStart(7);
  console.log('first load, KB (gzip for text; images and fonts as stored)');
  console.log('page'.padEnd(22) + ['html', 'css', 'js', 'fonts', 'images', 'TOTAL', 'lazy'].map(s => s.padStart(8)).join(''));
  for (const r of rows) {
    const t = r.totals;
    console.log(r.page.padEnd(22) + [t.html.gz, t.css.gz, t.js.gz, t.fonts.gz, t.img.gz, t.total.gz, r.lazy.gz].map(n => ' ' + kb(n)).join(''));
  }
  console.log('\nfonts: the latin files of the families each page uses (and Devanagari where its Hindi asks for it); 404 and offline use system fonts.');
}
