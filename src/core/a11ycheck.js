// A small accessibility check over a page's HTML, DOM-free (test/a11y.test.mjs runs it on every page in CI; the
// command line is brand/tools/a11y_check.mjs). It reads the markup the page ships with, not what scripts add later
// (src/app/a11y.js covers those at run time), and checks what can be checked from text:
//   errors: a page without lang or title; images without alt; buttons, links and form fields without a name (or a
//           button named only by a symbol such as « or ☰); duplicate ids; tabindex above 0; role="application" or
//           role="img" without a label; text colour tokens under 4.5:1 against the page background
//   warnings: a viewport that stops pinch zoom (the 3D and map views do it on purpose and handle pinch themselves)

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'template', 'textarea', 'title']);
const HAS_WORD = /[\p{L}\p{N}]/u;
// tags whose start closes an open one of the same kind, and blocks that close an open <p> (as browsers do)
const SELF_CLOSING = new Set(['p', 'li', 'dt', 'dd', 'option', 'tr', 'td', 'th']);
const CLOSES_P = new Set(['div', 'ul', 'ol', 'dl', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'table', 'form', 'header', 'footer', 'nav', 'main', 'aside', 'pre', 'blockquote', 'figure', 'article']);

/** Attributes of a start tag's inside ('a href="x" hidden'), names lower-cased. */
export function parseAttrs(s) {
  const out = {}, re = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

const decode = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (all, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : all; }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k] || all;
});

/**
 * A forgiving tree of the markup: { tag, attrs, children: [...nodes | strings], line }. Script and style bodies are kept
 * as one raw text child; unclosed tags close at their parent's end, like a browser.
 */
export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [], line: 1 }, stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'=<>`/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/gi;
  let last = 0, m, line = 1;
  const lineAt = i => { line += (html.slice(last, i).match(/\n/g) || []).length; return line; };
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push(decode(html.slice(last, m.index)));
    const ln = lineAt(m.index); last = m.index;
    if (m[1]) {   // an end tag: close up to the matching open element, if there is one
      const t = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === t) { stack.length = i; break; }
    } else if (m[2]) {
      const tag = m[2].toLowerCase(), node = { tag, attrs: parseAttrs(m[3] || ''), children: [], line: ln };
      let open = stack[stack.length - 1];
      if (stack.length > 1 && ((SELF_CLOSING.has(tag) && open.tag === tag) || (CLOSES_P.has(tag) && open.tag === 'p'))) { stack.pop(); open = stack[stack.length - 1]; }
      open.children.push(node);
      if (RAW.has(tag)) {
        const end = html.toLowerCase().indexOf('</' + tag, re.lastIndex), stop = end < 0 ? html.length : end;
        node.children.push(tag === 'title' || tag === 'textarea' ? decode(html.slice(re.lastIndex, stop)) : html.slice(re.lastIndex, stop));
        lineAt(stop); last = stop; re.lastIndex = stop;
        continue;
      }
      if (!VOID.has(tag) && !m[4]) stack.push(node);
    }
    line = ln; last = re.lastIndex;
  }
  if (last < html.length) stack[stack.length - 1].children.push(decode(html.slice(last)));
  return root;
}

export function* walk(node, parents = []) {
  for (const c of node.children || []) {
    if (typeof c === 'string') continue;
    yield [c, parents];
    if (!RAW.has(c.tag)) yield* walk(c, [...parents, c]);
  }
}

/** The text inside a node (not inside scripts, styles or aria-hidden parts), with img alt text, squashed. */
export function textOf(node) {
  let s = '';
  for (const c of node.children || []) {
    if (typeof c === 'string') s += c;
    else if (c.tag === 'script' || c.tag === 'style' || c.attrs['aria-hidden'] === 'true') continue;
    else if (c.tag === 'img') s += ' ' + (c.attrs.alt || '') + ' ';
    else if (c.tag === 'svg') s += ' ' + svgTitle(c) + ' ';
    else s += ' ' + textOf(c) + ' ';
  }
  return s.replace(/\s+/g, ' ').trim();
}
const svgTitle = svg => { if (svg.attrs['aria-label']) return svg.attrs['aria-label']; const t = (svg.children || []).find(c => c.tag === 'title'); return t ? textOf(t) : ''; };

/** WCAG relative luminance and contrast. Colours: #rgb, #rrggbb. */
export function luminance(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = h.replace(/./g, c => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const ch = i => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// text colour tokens, by the names the pages use; checked against --bg (and --panel-2 / --panel-solid when solid)
const TEXT_TOKEN = /^--(ink|ink-dim|ink-faint|dim|faint|muted|mute|text|text-dim|sub)$/;
const BG_TOKEN = /^--(bg|panel-solid|panel-2)$/;

/** The custom properties set in :root rules of the page's own <style> blocks. */
export function rootTokens(css) {
  const out = {};
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out[d[1]] = d[2].trim();
  return out;
}

/**
 * Check a page. Returns { errors: [{ rule, line, what }], warnings: [...] }.
 * opts.zoomOk: the page handles pinch itself (globe, map, solar): a viewport that blocks zoom is a warning, not an error.
 */
export function checkHtml(html, opts = {}) {
  const errors = [], warnings = [], tree = parseHtml(html), ids = new Map(), labelFor = new Set();
  const err = (rule, node, what) => errors.push({ rule, line: node ? node.line : 0, what });
  const warn = (rule, node, what) => warnings.push({ rule, line: node ? node.line : 0, what });
  const all = [...walk(tree)];
  for (const [n] of all) if (n.tag === 'label' && n.attrs.for) labelFor.add(n.attrs.for);
  const byId = id => all.find(([n]) => n.attrs.id === id)?.[0];
  const labelledBy = n => (n.attrs['aria-labelledby'] || '').split(/\s+/).filter(Boolean).map(id => byId(id)).filter(Boolean).map(textOf).join(' ').trim();
  const name = n => (n.attrs['aria-label'] || '').trim() || labelledBy(n) || textOf(n) || (n.attrs.title || '').trim();
  const hidden = parents => parents.some(p => p.attrs['aria-hidden'] === 'true' || 'hidden' in p.attrs || p.tag === 'template' || p.tag === 'noscript');   // hidden parts are filled in by script before they show
  const desc = (n) => `<${n.tag}${n.attrs.id ? ' id="' + n.attrs.id + '"' : ''}${n.attrs.class ? ' class="' + n.attrs.class + '"' : ''}>`;

  const htmlEl = all.find(([n]) => n.tag === 'html')?.[0];
  if (!htmlEl || !htmlEl.attrs.lang) err('lang', htmlEl, '<html> has no lang');
  const title = all.find(([n]) => n.tag === 'title')?.[0];
  if (!title || !textOf(title)) err('title', title, 'the page has no <title>');
  const vp = all.find(([n]) => n.tag === 'meta' && n.attrs.name === 'viewport')?.[0];
  if (!vp) err('viewport', null, 'no viewport meta');
  else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0*)?\b(?!\.\d*[1-9])/i.test(vp.attrs.content || ''))
    (opts.zoomOk ? warn : err)('zoom', vp, 'the viewport stops pinch zoom' + (opts.zoomOk ? ' (this view handles pinch itself)' : ''));

  for (const [n, parents] of all) {
    const a = n.attrs, inHidden = hidden(parents) || a['aria-hidden'] === 'true' || 'hidden' in a;
    if (a.id) { if (ids.has(a.id)) err('duplicate-id', n, `id "${a.id}" is used twice (first on line ${ids.get(a.id)})`); else ids.set(a.id, n.line); }
    if (a.tabindex && +a.tabindex > 0) err('tabindex', n, `${desc(n)} has tabindex ${a.tabindex}: it jumps the reading order`);
    if (inHidden) continue;
    if (n.tag === 'img' && !('alt' in a)) err('img-alt', n, `${desc(n)} src="${a.src || ''}" has no alt (use alt="" if it is decoration)`);
    if ((a.role === 'application' || a.role === 'img' || a.role === 'region' || a.role === 'dialog') && !a['aria-label'] && !a['aria-labelledby'])
      err('role-label', n, `${desc(n)} role="${a.role}" has no aria-label`);
    if (n.tag === 'button' || a.role === 'button') {
      const nm = name(n);
      if (!nm) err('button-name', n, `${desc(n)} has no name`);
      else if (!HAS_WORD.test(nm)) err('button-symbol', n, `${desc(n)} is named only "${nm}": give it an aria-label`);
    }
    if (n.tag === 'a' && 'href' in a) {
      const nm = name(n);
      if (!nm) err('link-name', n, `${desc(n)} href="${a.href}" has no name`);
    }
    if ((n.tag === 'input' && !/^(hidden|submit|button|reset|image)$/i.test(a.type || '')) || n.tag === 'select' || n.tag === 'textarea') {
      const labelled = a['aria-label'] || a['aria-labelledby'] || (a.id && labelFor.has(a.id)) || parents.some(p => p.tag === 'label') || a.title;
      if (!labelled) err('field-label', n, `${desc(n)}${a.placeholder ? ' (placeholder "' + a.placeholder + '" is not a label)' : ''} has no label`);
    }
  }

  const css = all.filter(([n]) => n.tag === 'style').map(([n]) => n.children.join('')).join('\n');
  const tok = rootTokens(css), bgs = Object.keys(tok).filter(k => BG_TOKEN.test(k) && luminance(tok[k]) !== null);
  for (const [k, v] of Object.entries(tok)) {
    if (!TEXT_TOKEN.test(k) || luminance(v) === null) continue;
    for (const b of bgs) {
      const c = contrast(v, tok[b]);
      if (c < 4.5) err('contrast', null, `text colour ${k} ${v} on ${b} ${tok[b]} is ${c.toFixed(2)}:1 (needs 4.5:1)`);
    }
  }
  return { errors, warnings };
}
