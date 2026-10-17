// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe's details card from the 2026-10-17 audit: close means stop (the near-miss HUD, a flyby's scale view, a launch
// replay and a re-entry corridor end with their card, however it closes), focus goes back, a closed card leaves the tab
// order, Look up no longer floods screen readers, dimmed controls keep their contrast, and the re-entry copy matches the
// cards. The card registry and the speech gate are DOM-free and run here; the globe's modules touch the DOM and Cesium,
// so their wiring is read from the source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardOwners } from '../src/core/cardowners.js';
import { speakGate, guideKind } from '../src/core/speakgate.js';
import { guide } from '../src/core/orientation.js';
import { WINDOW_FRACTION } from '../src/core/decay.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('globe.html'), css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const src = name => read(`src/globe/${name}.js`);

// ---- the card registry
test('card owners: an owner stops once, when its card closes', () => {
  const o = cardOwners(); let n = 0;
  o.own('data-cj', () => n++);
  assert.deepEqual(o.check(true, m => m === 'data-cj'), [], 'still up and still its card: keeps running');
  assert.equal(n, 0);
  assert.deepEqual(o.check(false, () => true), ['data-cj'], 'hidden (Esc, a globe click, the phone Layers button)');
  assert.equal(n, 1);
  o.check(false, () => true); o.check(true, () => false);
  assert.equal(n, 1, 'never twice');
  assert.equal(o.size, 0);
});

test('card owners: another card taking over stops the owner; the new owner is kept', () => {
  const o = cardOwners(), stopped = [];
  o.own('data-fb', () => stopped.push('fb'));
  o.own('data-as', () => stopped.push('as'));
  assert.deepEqual(o.check(true, m => m === 'data-as'), ['data-fb']);
  assert.deepEqual(stopped, ['fb']);
  assert.equal(o.size, 1);
});

test('card owners: the same marker again replaces the old stop; one that throws does not keep the rest running', () => {
  const o = cardOwners(), calls = [];
  o.own('data-re', () => calls.push('old'));
  o.own('data-re', () => calls.push('new'));
  o.own('data-cj', () => { throw new Error('boom'); });
  o.own('data-as', () => calls.push('as'));
  const warn = console.warn; console.warn = () => {};
  try { assert.deepEqual(o.check(false, () => false).sort(), ['data-as', 'data-cj', 'data-re']); } finally { console.warn = warn; }
  assert.deepEqual(calls, ['new', 'as']);
});

// ---- Look up's spoken "Find"
test('speech gate: the kind of an instruction is its words without the numbers', () => {
  assert.equal(guideKind('Jupiter: turn left 40°, up 12°'), 'Jupiter: turn left, up');
  assert.equal(guideKind('Jupiter: turn left 39°, up 11°'), guideKind('Jupiter: turn left 40°, up 12°'));
  assert.notEqual(guideKind('Jupiter: turn right 40°'), guideKind('Jupiter: turn left 40°'));
  assert.equal(guideKind('Moon: There it is!'), 'Moon: There it is!');
  assert.equal(guideKind(''), '');
});

test('speech gate: a turning phone is said once per kind, at most every 3 s, and the last change is not lost', () => {
  const g = speakGate({ minMs: 3000 });
  assert.equal(g.next('', 0), null);
  assert.equal(g.next('Mars: turn left 40°', 0), 'Mars: turn left 40°');
  for (let t = 16, a = 39; a > 5; t += 16, a--) assert.equal(g.next(`Mars: turn left ${a}°`, t), null, 'the numbers tick, nothing is said');
  assert.equal(g.next('Mars: There it is!', 1000), null, 'a new kind too soon waits');
  assert.equal(g.next('Mars: There it is!', 3000), 'Mars: There it is!', '...and is said once the wait is over');
  assert.equal(g.next('Mars: There it is!', 9000), null);
  g.reset();
  assert.equal(g.next('Mars: There it is!', 9001), 'Mars: There it is!', 'a new target: said again');
  // the real guide() wording, frame by frame while turning towards the target
  const h = speakGate(); let said = 0;
  for (let i = 0, az = 0; az <= 100; i++, az += 0.5) if (h.next('Vega: ' + guide(az, 20, 100, 20).text, i * 16)) said++;
  assert.ok(said >= 1 && said <= 3, `${said} announcements for one turn, not hundreds`);
});

test('look-up mode: only "what you tapped" is a live region; Find speaks through OOApp.announce', () => {
  const lookup = html.match(/<div id="lookup"[^>]*>/)[0];
  assert.doesNotMatch(lookup, /aria-live/, 'the whole overlay was a live region');
  assert.doesNotMatch(html, /<div id="luDir"[^>]*aria-live/);
  assert.doesNotMatch(html, /<div id="luGo"[^>]*aria-live/);
  assert.match(html, /<div id="luInfo"[^>]*aria-live="polite"/);
  const lu = src('lookup');
  assert.match(lu, /goSpeech\.next\(goText, performance\.now\(\)\)[^\n]*OOApp\?\.announce/);
  assert.match(lu, /\$\('#luFind'\)\.onchange = e => \{ S\.find = e\.target\.value; goSpeech\.reset\(\)/);
});

// ---- close means stop
test('ui.js: the card is watched, owners are stopped on any close or replacement, focus returns', () => {
  const ui = src('ui');
  assert.match(ui, /hooks\.onCardClosed = \(marker, stop\) => owners\.own\(marker, stop\)/);
  assert.match(ui, /owners\.check\(shown, m => !!cardEl\.querySelector\(`\[\$\{m\}\]`\)\)/);
  assert.match(ui, /\.observe\(cardEl, \{ attributes: true, attributeFilter: \['class'\], childList: true \}\)/);
  assert.match(ui, /opener = a && a !== document\.body && !cardEl\.contains\(a\) \? a : null/, 'the opener is recorded when the card opens');
  assert.match(ui, /if \(a && cardEl\.contains\(a\)\) back\?\.focus\(/, 'focus goes back only when the card held it');
  assert.match(ui, /: \$\('#globe'\);/, 'the globe when the opener is gone');
  assert.match(ui, /export function closeCard\(\) \{[^\n]*classList\.remove\('show'\); syncCard\(\); \}/, 'closeCard stops the owners at once (Look up reads the camera lock right after)');
  assert.match(ui, /new MutationObserver\(syncCard\)\.observe\(cardEl/, 'the observer stays as the backstop');
  assert.doesNotMatch(read('globe.html'), /<section id="card"[^>]*aria-live/, 'the card ticks every 100 ms (near-miss HUD, launch replay): a11y.js says each selection once instead');
});

test('near-miss HUD: marked, guarded like eclipses.js, and stopped when its card goes', () => {
  const cj = src('conjunctions');
  assert.match(cj, /<div class="k" data-cj /);
  assert.match(cj, /if \(!first && \(!card\.classList\.contains\('show'\) \|\| !card\.querySelector\('\[data-cj\]'\)\)\) \{ this\.stop\(!card\.classList\.contains\('show'\)\); return; \}/, 'replaced: the new card keeps its clock; hidden: back to live');
  assert.ok(cj.indexOf("querySelector('[data-cj]')") < cj.indexOf('card.innerHTML = html'), 'the guard runs before the HUD writes the card');
  assert.match(cj, /hooks\.onCardClosed\?\.\('data-cj', \(\) => this\.stop\(!\$\('#card'\)\.classList\.contains\('show'\)\)\)/, 'the owner goes live only on a hidden card');
  assert.doesNotMatch(cj, /this\.stop\(true\); return;/);
});

test('flyby scale view: rings, countdown and the hand-off hold end with the card', () => {
  const fb = src('flybys');
  assert.match(fb, /<div class="k" data-fb /);
  assert.match(fb, /hooks\.onCardClosed\?\.\('data-fb', \(\) => this\.end\(\)\)/);
  assert.match(fb, /if \(!card\.classList\.contains\('show'\) \|\| !card\.querySelector\('\[data-fb\]'\)\) \{ this\.end\(\); return; \}/);
  assert.match(fb, /end\(\) \{ clearInterval\(this\.tick\); this\.tick = 0; this\.clearRings\(\); \}/);
  assert.match(fb, /state\.noHandoff = false/, 'noHandoff is released, not left on for the session');
  assert.match(fb, /h > HOLD_M && h > peak \* 0\.9/, '...once the camera is back inside the hand-off distance, or the user zooms in at all');
  assert.match(fb, /scale\(r\) \{[^\n]*\n\s+this\.removeRings\(\)/, 'a new scale view clears the old hold without releasing the hand-off');
});

test('launch replay: stops on a hidden card, on Esc and on another card; a second stop keeps other camera locks', () => {
  const as = src('ascent');
  assert.match(as, /<div class="k" data-as /);
  assert.match(as, /if \(!el\('asT'\) \|\| !\$\('#card'\)\.classList\.contains\('show'\)\) \{ this\.stop\(\); return; \}/);
  assert.match(as, /hooks\.onCardClosed\?\.\('data-as', \(\) => this\.stop\(\)\)/);
  assert.match(as, /if \(was\) ctrl\.enableInputs = true;/);
  assert.match(src('ui'), /if \(e\.key === 'Escape'\) \{ if \(Follow\.obj\) Follow\.stop\(\); else closeCard\(\); \}/, 'Esc closes the card, which stops the owners');
});

test('re-entry corridor: unselected when its card goes', () => {
  const re = src('reentry');
  assert.match(re, /<div class="k" data-re /);
  assert.match(re, /hooks\.onCardClosed\?\.\('data-re', \(\) => \{ if \(this\.sel === p\) this\.unselect\(\); \}\)/);
});

// ---- tab order, contrast, copy
test('a closed card is hidden once it has slid out, on desktop and phone', () => {
  assert.match(css, /#card:not\(\.show\)\{visibility:hidden;transition:transform \.35s [^;]*,visibility 0s \.35s\}/);
  const phone = css.match(/#card\{left:10px;right:10px;[^}]*\}/)[0];
  assert.doesNotMatch(phone, /transition|visibility/, 'the phone rule keeps the shared transition');
});

test('dimmed controls carry no opacity; dim rows say why in words', () => {
  const rule = sel => [...css.matchAll(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g'))].map(m => m[1]).join(';');
  for (const sel of ['.wx-sets .chipbtn', '.wx-sets .chipbtn.on', '.cj.dim']) assert.doesNotMatch(rule(sel), /opacity/, sel);
  assert.match(rule('.wx-sets .chipbtn'), /dashed/, 'the off state is an outline');
  assert.match(rule('.cj.dim b,.cj.dim span'), /color:var\(--faint\)/);
  assert.match(src('conjunctions'), /\$\{have\(r\) \? '' : ' · \(not loaded\)'\}/);
  assert.match(src('weather'), /data-set="\$\{id\}" aria-pressed="\$\{!!s\.on\}"/);
  assert.match(src('weather'), /b\.setAttribute\('aria-pressed', String\(s\.on\)\)/);
});

test('re-entry copy: usually ±25%, wider when the two drag estimates disagree (globe and map)', () => {
  assert.equal(WINDOW_FRACTION, 0.25);
  for (const f of ['src/globe/reentry.js', 'src/map/reentry.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /(windows|window is) ±25%/, f);
    assert.match(s, /usually ±\$\{Math\.round\(WINDOW_FRACTION \* 100\)\}%[^`]*wider when the two drag estimates disagree/, f);
  }
  assert.match(src('reentry'), /of the time it has left \(the upper air swells and shrinks with the Sun\), wider when the two drag estimates disagree\./, 'the Sun explains the window, not the disagreement');
});

test('the phone time bar keeps its zone; the fold button looks like its heading', () => {
  assert.match(src('ui'), /NARROW\.matches \? iso\.slice\(5, 16\)\.replace\('T', ' '\) \+ ' UTC'/);
  assert.match(css, /#card h3\.fold>button\.foldbtn\{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:left;width:100%/);
});
