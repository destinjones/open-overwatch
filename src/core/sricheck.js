// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Supply-chain check over a page's HTML, DOM-free (test/sri.test.mjs runs it on every page in CI; the command line,
// which also refreshes hashes, is brand/tools/sri.mjs). What it enforces:
//   - every <script src> and <link rel=stylesheet> on a CDN names an exact version and carries integrity="sha384-…"
//     with crossorigin="anonymous"; every exact URL in an import map has an entry in the map's "integrity"
//   - every page has a Content-Security-Policy <meta> before its first script or stylesheet, with object-src 'none',
//     base-uri 'self', no 'unsafe-eval' (but on EVAL_OK pages), and the CDN origins its tags load from in script-src / style-src
//   - every inline script's sha256 is in script-src, unless the page opts into 'unsafe-inline' (then it must list no
//     hashes: a hash makes browsers ignore 'unsafe-inline', and the page's onclick= attributes would stop working)
// Hashing is passed in (Node's crypto in the test and the tool) so this file stays free of Node and of the DOM.
import { parseAttrs } from './a11ycheck.js';

export const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'];
/** Pages that may allow 'unsafe-eval': CesiumJS's Viewer widgets run on Knockout, which reads (0,eval)("this") as it
 *  loads and compiles every data-bind with new Function. */
export const EVAL_OK = new Set(['globe.html']);
const CDN_URL = /https:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)\/[^\s"'`)<>]+/g;
/** An exact version: npm@1.2.3 (jsDelivr, unpkg) or cdnjs /ajax/libs/name/1.2.3/. Ranges, tags and @latest fail. */
export const EXACT = /@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/|\/ajax\/libs\/[^/]+\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\//;
export const isCdn = url => { try { return CDN_HOSTS.includes(new URL(url).hostname); } catch (e) { return false; } };
export const isExact = url => EXACT.test(new URL(url).pathname + '/');
/** Inline script text the way a browser hashes it: the HTML parser turns CR LF and lone CR into LF. */
export const scriptText = s => s.replace(/\r\n?/g, '\n');

const lineAt = (html, i) => html.slice(0, i).split('\n').length;

/** Every <script> with its attributes, text, line and offset. */
export function scripts(html) {
  const out = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) out.push({ attrs: parseAttrs(m[1]), text: m[2], line: lineAt(html, m.index), at: m.index });
  return out;
}
/** Scripts the browser runs from the page's own text (the CSP decides): classic, module and import maps, not data blocks. */
export function inlineScripts(html) {
  return scripts(html).filter(s => !('src' in s.attrs) && ['', 'text/javascript', 'module', 'importmap'].includes((s.attrs.type || '').toLowerCase()));
}
/** CDN <script src> and <link rel=stylesheet|modulepreload|preload> tags. */
export function cdnTags(html) {
  const out = [];
  for (const s of scripts(html)) if (isCdn(s.attrs.src)) out.push({ tag: 'script', url: s.attrs.src, attrs: s.attrs, line: s.line });
  const re = /<link\b([^>]*)>/gi; let m;
  while ((m = re.exec(html))) {
    const a = parseAttrs(m[1]);
    if (/\b(stylesheet|modulepreload|preload)\b/i.test(a.rel || '') && isCdn(a.href)) out.push({ tag: 'link', url: a.href, attrs: a, line: lineAt(html, m.index) });
  }
  return out;
}
/** The page's import maps, parsed ({ imports, integrity, line }); a map that is not JSON comes back with error. */
export function importMaps(html) {
  return scripts(html).filter(s => (s.attrs.type || '').toLowerCase() === 'importmap').map(s => {
    try { const j = JSON.parse(s.text); return { imports: j.imports || {}, integrity: j.integrity || {}, line: s.line }; }
    catch (e) { return { imports: {}, integrity: {}, line: s.line, error: e.message }; }
  });
}
/** The CSP <meta>: { policy, at, line } or null. */
export function cspMeta(html) {
  const re = /<meta\b([^>]*)>/gi; let m;
  while ((m = re.exec(html))) {
    const a = parseAttrs(m[1]);
    if ((a['http-equiv'] || '').toLowerCase() === 'content-security-policy') return { policy: a.content || '', at: m.index, line: lineAt(html, m.index) };
  }
  return null;
}
/** "a b; c d" -> Map { a => ['b'], c => ['d'] } (directive names lower-cased; the first of a repeated one wins, as in browsers). */
export function parseCsp(policy) {
  const out = new Map();
  for (const part of policy.split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), vals);
  }
  return out;
}
/** The sources a fetch of this kind falls back to (script-src -> default-src). */
const sources = (csp, dir) => csp.get(dir) || csp.get('default-src') || [];
const allows = (list, url) => { const o = new URL(url).origin; return list.includes(o) || list.includes(o + '/'); };

/**
 * Problems on one page: [{ rule, line, what }]. `sha256(text)` returns base64; `sri` (optional) maps URL -> the
 * expected "sha384-…" so the same file carries the same hash on every page; `evalOk` lets the page allow 'unsafe-eval'.
 */
export function checkPage(html, { sha256, sri = null, evalOk = false } = {}) {
  const errs = [], err = (rule, line, what) => errs.push({ rule, line, what });
  for (const t of cdnTags(html)) {
    if (!isExact(t.url)) err('version', t.line, `${t.url} does not name an exact version`);
    if (!/^sha(384|512)-[A-Za-z0-9+/]+={0,2}$/.test(t.attrs.integrity || '')) err('integrity', t.line, `${t.url} has no sha384 integrity attribute`);
    else if (sri && sri.has(t.url) && sri.get(t.url) !== t.attrs.integrity) err('integrity', t.line, `${t.url} carries a different hash than elsewhere`);
    if (t.attrs.crossorigin !== 'anonymous') err('crossorigin', t.line, `${t.url} needs crossorigin="anonymous" (integrity is not checked without CORS)`);
  }
  for (const map of importMaps(html)) {
    if (map.error) { err('importmap', map.line, `import map is not JSON: ${map.error}`); continue; }
    for (const url of Object.values(map.imports)) if (isCdn(url) && !isExact(url)) err('version', map.line, `${url} does not name an exact version`);
    for (const url of Object.values(map.imports)) if (isCdn(url) && !url.endsWith('/') && !map.integrity[url]) err('integrity', map.line, `import map: ${url} has no integrity entry`);
    for (const [url, h] of Object.entries(map.integrity)) {
      if (!isExact(url)) err('version', map.line, `${url} does not name an exact version`);
      if (!/^sha(384|512)-[A-Za-z0-9+/]+={0,2}$/.test(h)) err('integrity', map.line, `import map: ${url} has a malformed hash`);
      else if (sri && sri.has(url) && sri.get(url) !== h) err('integrity', map.line, `import map: ${url} carries a different hash than elsewhere`);
    }
  }

  const meta = cspMeta(html);
  if (!meta) { err('csp', 1, 'no Content-Security-Policy <meta>'); return errs; }
  const firstLoad = html.search(/<script\b|<link\b[^>]*rel=["']?stylesheet/i);
  if (firstLoad >= 0 && firstLoad < meta.at) err('csp', meta.line, 'the CSP <meta> must come before the first script or stylesheet (it only governs what follows it)');
  const csp = parseCsp(meta.policy);
  if ((csp.get('object-src') || []).join(' ') !== "'none'") err('csp', meta.line, "object-src must be 'none'");
  if (!(csp.get('base-uri') || []).length || (csp.get('base-uri') || []).some(s => s !== "'self'" && s !== "'none'")) err('csp', meta.line, "base-uri must be 'self'");
  const scriptSrc = sources(csp, 'script-src');
  if (scriptSrc.includes("'unsafe-eval'") && !evalOk) err('csp', meta.line, "script-src must not allow 'unsafe-eval'");
  if (scriptSrc.some(s => s === '*' || s === 'https:' || s === 'http:' || s === 'data:' || s === 'blob:')) err('csp', meta.line, 'script-src must name its CDN origins, not a whole scheme');
  for (const t of cdnTags(html)) {
    const list = sources(csp, t.tag === 'script' || /modulepreload/.test(t.attrs.rel || '') ? 'script-src' : 'style-src');
    if (!allows(list, t.url)) err('csp', t.line, `${new URL(t.url).origin} is not in the CSP for ${t.url}`);
  }
  for (const map of importMaps(html)) for (const url of [...Object.values(map.imports), ...Object.keys(map.integrity)])
    if (isCdn(url) && !allows(scriptSrc, url)) err('csp', map.line, `${new URL(url).origin} is not in script-src for ${url}`);
  const hashes = scriptSrc.filter(s => /^'sha(256|384|512)-/.test(s));
  if (scriptSrc.includes("'unsafe-inline'")) {
    if (hashes.length) err('csp', meta.line, "script-src lists hashes and 'unsafe-inline': browsers ignore 'unsafe-inline' when a hash is present");
  } else if (sha256) {
    const want = new Set();
    for (const s of inlineScripts(html)) {
      const h = `'sha256-${sha256(scriptText(s.text))}'`; want.add(h);
      if (!hashes.includes(h)) err('csp-hash', s.line, `inline script's ${h} is not in script-src (node brand/tools/sri.mjs --csp updates them)`);
    }
    for (const h of hashes) if (!want.has(h)) err('csp-hash', meta.line, `script-src lists ${h}, which matches no inline script (node brand/tools/sri.mjs --csp)`);
  }
  return errs;
}

/** Every CDN URL a source file names (string literals: dynamic imports, importScripts in worker source, constants). */
export const cdnUrlsIn = text => [...new Set(text.match(CDN_URL) || [])];

/** The page with script-src's hash list replaced by the hashes of its inline scripts (a page on 'unsafe-inline' is left alone). */
export function withCspHashes(html, sha256) {
  const meta = cspMeta(html); if (!meta) return html;
  const csp = parseCsp(meta.policy), src = csp.get('script-src');
  if (!src || src.includes("'unsafe-inline'")) return html;
  const hashes = [...new Set(inlineScripts(html).map(s => `'sha256-${sha256(scriptText(s.text))}'`))];
  const kept = src.filter(s => !/^'sha(256|384|512)-/.test(s));
  const policy = meta.policy.replace(/script-src[^;]*/, ['script-src', ...kept, ...hashes].join(' '));
  return html.replace(meta.policy, policy);
}
