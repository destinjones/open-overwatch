// The accessibility check (src/core/a11ycheck.js): its rules on small pieces of markup, then every page the site ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkHtml, parseHtml, textOf, walk, contrast, rootTokens } from '../src/core/a11ycheck.js';

const page = (body, head = '', lang = ' lang="en"') => `<!doctype html><html${lang}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>T</title>${head}</head><body>${body}</body></html>`;
const rules = (html, opts) => checkHtml(html, opts).errors.map(e => e.rule);

test('a clean page passes', () => {
  assert.deepEqual(rules(page('<h1>Hi</h1><button>Go</button><a href="x">Link</a><label for="q">Find</label><input id="q"><img src="a.png" alt="">')), []);
});

test('the page itself: lang, title, viewport, zoom', () => {
  assert.ok(rules(page('', '', '')).includes('lang'));
  assert.ok(rules('<html lang="en"><head><meta name="viewport" content="width=device-width"></head><body></body></html>').includes('title'));
  const noZoom = page('').replace('initial-scale=1', 'initial-scale=1, maximum-scale=1, user-scalable=no');
  assert.ok(rules(noZoom).includes('zoom'), 'a reading page must let people zoom');
  assert.deepEqual(rules(noZoom, { zoomOk: true }), [], '...a map that handles pinch itself only gets a warning');
  assert.equal(checkHtml(noZoom, { zoomOk: true }).warnings[0].rule, 'zoom');
  assert.deepEqual(rules(page('').replace('initial-scale=1', 'initial-scale=1, maximum-scale=5')), [], 'maximum-scale=5 still zooms');
});

test('controls need names; a symbol is not a name', () => {
  assert.ok(rules(page('<button></button>')).includes('button-name'));
  assert.ok(rules(page('<button title="Pause">❚❚</button>')).includes('button-symbol'), 'the text wins over the title, and it is a symbol');
  assert.deepEqual(rules(page('<button title="Pause" aria-label="Pause">❚❚</button>')), []);
  assert.deepEqual(rules(page('<button><svg aria-hidden="true"></svg>Brief</button>')), []);
  assert.deepEqual(rules(page('<button><img src="x.png" alt="Close"></button>')), [], 'an image with alt names its button');
  assert.ok(rules(page('<button><svg></svg></button>')).includes('button-name'));
  assert.ok(rules(page('<a href="#"></a>')).includes('link-name'));
  assert.deepEqual(rules(page('<a href="#" aria-labelledby="t"></a><span id="t">Home</span>')), []);
  assert.deepEqual(rules(page('<div hidden><a href="#"></a></div>')), [], 'hidden parts are filled in by script before they show');
});

test('form fields need labels; a placeholder is not one', () => {
  assert.ok(rules(page('<input placeholder="Search">')).includes('field-label'));
  assert.deepEqual(rules(page('<label>Search <input></label>')), []);
  assert.deepEqual(rules(page('<input aria-label="Search">')), []);
  assert.deepEqual(rules(page('<input type="hidden"><input type="submit" value="Go">')), []);
  assert.ok(rules(page('<select id="s"></select>')).includes('field-label'));
});

test('images, ids, tabindex and roles', () => {
  assert.ok(rules(page('<img src="a.png">')).includes('img-alt'));
  assert.deepEqual(rules(page('<div aria-hidden="true"><img src="a.png"></div>')), [], 'hidden from screen readers anyway');
  assert.ok(rules(page('<p id="a"></p><p id="a"></p>')).includes('duplicate-id'));
  assert.ok(rules(page('<button tabindex="3">x y</button>')).includes('tabindex'));
  assert.deepEqual(rules(page('<button tabindex="-1">Go</button><div tabindex="0">x</div>')), []);
  assert.ok(rules(page('<div role="application"></div>')).includes('role-label'));
  assert.deepEqual(rules(page('<div role="application" aria-label="Map"></div>')), []);
});

test('contrast of the text colour tokens', () => {
  assert.equal(contrast('#000', '#fff').toFixed(1), '21.0');
  assert.equal(contrast('#777', '#fff').toFixed(2), '4.48');
  assert.deepEqual(rootTokens(':root{--bg:#04060a; --ink:#e6edf3} a{color:red} :root{--dim:#8b9bab}'), { '--bg': '#04060a', '--ink': '#e6edf3', '--dim': '#8b9bab' });
  assert.ok(rules(page('', '<style>:root{--bg:#04060a;--faint:#55667a}</style>')).includes('contrast'));
  assert.deepEqual(rules(page('', '<style>:root{--bg:#04060a;--faint:#738599;--accent:#123}</style>')), [], 'only text tokens are checked');
});

test('the parser copes with real markup: scripts, comments, unclosed tags, entities', () => {
  const t = parseHtml('<!-- <button></button> --><p>a &amp; b<p>c<script>if (a < b) document.write("<button>")</script><b>d</b>');
  const tags = [...walk(t)].map(([n]) => n.tag);
  assert.deepEqual(tags, ['p', 'p', 'script', 'b']);
  assert.equal(textOf(t.children[0]), 'a & b');
  assert.deepEqual(rules(page('<script>const s = "<img src=x>";</script><style>button:empty{}</style>')), [], 'markup inside scripts is not markup');
});

for (const [file, zoomOk] of [['index.html'], ['globe.html', true], ['open-overwatch.html', true], ['solar.html', true], ['tonight.html'], ['about.html'], ['guide.html'], ['offline.html']]) {
  test(`${file} passes the accessibility check`, () => {
    const { errors } = checkHtml(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { zoomOk });
    assert.deepEqual(errors.map(e => `${file}:${e.line} [${e.rule}] ${e.what}`), []);
  });
}

test('every page loads the shared shell (installable app, accessibility layer)', () => {
  for (const f of ['index.html', 'globe.html', 'open-overwatch.html', 'solar.html', 'tonight.html', 'about.html', 'guide.html'])
    assert.match(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), /<script type="module" src="src\/app\/shell\.js"><\/script>/, f);
});
