// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The performance report (e2e/perf-report.mjs) run on small made-up results: page errors reach the summary with the pass
// and window they fell in, and a page whose renderer gave up fails the job whatever the budgets say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../e2e/perf-report.mjs', import.meta.url));
const STOPPED = 'console.error: An error occurred while rendering.  Rendering has stopped.\nRangeError: Invalid array length\n    at x (y.js:1:2)';
const WINDOW = { frames: { p50: 16.7, p95: 16.7, p99: 16.7, max: 17, over100: 0, over33: 0 }, longTasks: { n: 0, tbtMs: 0, maxMs: 0, top: [] }, cls: { total: 0, top: [] }, loaf: { top: [] } };
const run = (extra = {}) => ({ page: 'globe', profile: 'desktop', commit: 'abcdef0', phases: [{ name: 'Zoom in', wallMs: 1000, error: null, ...WINDOW }], leak: {}, cpuProfile: null, pageErrors: [], ...extra });
const failing = (pass, phase, n = 4) => Array.from({ length: n }, () => ({ pass, phase, message: STOPPED }));

/** The report over these runs: its exit code, summary, console output and JSON. */
function report(runs, budgets = { enforce: false, default: {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'oo-perf-'));
  try {
    for (const r of runs) writeFileSync(join(dir, `${r.page}-${r.profile}.json`), JSON.stringify(r));
    const file = join(dir, 'budgets'); writeFileSync(file, JSON.stringify(budgets));
    const p = spawnSync(process.execPath, [SCRIPT, dir, '--budgets', file], { encoding: 'utf8' });
    return { code: p.status, out: p.stdout, err: p.stderr, md: readFileSync(join(dir, 'perf-summary.md'), 'utf8'), json: JSON.parse(readFileSync(join(dir, 'perf-report.json'), 'utf8')) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('perf report: a clean run has no page errors section and passes', () => {
  const r = report([run()]);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.md, /## Page errors|renderer died/i);
  assert.equal(r.json.runs[0].framesValid, true);
});

test('perf report: page errors are listed with their pass, window and count, and a recovered failure does not fail the job', () => {
  const r = report([run({ pageErrorLog: [...failing('measured', 'Zoom in', 2), { pass: 'profiled', phase: 'Boot', message: 'uncaught: boom | bang' }] })]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.md, /\| globe · desktop \| measured \| Zoom in \| 2 \| An error occurred while rendering\. Rendering has stopped\. \|/);
  assert.match(r.md, /\| globe · desktop \| profiled \| Boot \| 1 \| boom \\\| bang \|/, 'the stack and the prefix are dropped, a pipe is escaped');
  assert.match(r.out, /^::warning title=page error::globe desktop · Zoom in: 2 × /m);
  assert.deepEqual(r.json.runs[0].rendererDied, []);
});

test('perf report: a renderer that died in the measured pass fails the job and marks its frames, whatever enforce says', () => {
  const r = report([run({ pageErrorLog: failing('measured', 'Zoom in') })]);
  assert.equal(r.code, 1);
  assert.match(r.md, /\*\*The renderer died: globe · desktop\*\*, 4 render failures in the measured pass, at "Zoom in"/);
  assert.match(r.md, /^\| globe · desktop † \|/m);
  assert.match(r.out, /^::error title=renderer died::globe desktop/m);
  assert.equal(r.json.runs[0].framesValid, false);
});

test('perf report: failures on the two pages are not added up, and a death in the profiled pass leaves the frames valid', () => {
  assert.equal(report([run({ pageErrorLog: [...failing('measured', 'Zoom in', 3), ...failing('profiled', 'Zoom in', 3)] })]).code, 0, 'two separate pages, each recovered');
  const r = report([run({ pageErrorLog: failing('profiled', 'Zoom out') })]);
  assert.equal(r.code, 1);
  assert.match(r.md, /in the profiled pass, at "Zoom out": the hottest functions/);
  assert.doesNotMatch(r.md, /†/);
  assert.equal(r.json.runs[0].framesValid, true);
});

test("perf report: the leak windows are the measured page, main.js's warning counts too, and older reports still work", () => {
  assert.equal(report([run({ pageErrorLog: [...failing('measured', 'Zoom in', 2), ...failing('leak', 'Idle and loop', 2)] })]).code, 1);
  assert.equal(report([run({ pageErrorLog: Array.from({ length: 4 }, () => ({ pass: 'measured', phase: 'Zoom in', message: 'console.warn: render failed RangeError' })) })]).code, 1);
  const old = report([run({ pageErrors: Array(4).fill(STOPPED) })]);
  assert.equal(old.code, 1);
  assert.match(old.md, /in a pass this report cannot name/);
});

test('perf report: failOnDeadRenderer false only warns; the leak loop and profiled pass errors are listed', () => {
  const r = report([run({ pageErrorLog: failing('measured', 'Zoom in'), leak: { loop: { error: 'loop broke' } }, cpuProfile: { error: 'profile broke', phases: {} } })], { enforce: false, failOnDeadRenderer: false, default: {} });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^::warning title=renderer died::/m);
  assert.match(r.md, /Leak loop: loop broke/);
  assert.match(r.md, /Profiled pass: profile broke/);
});

test('perf report: the shipped budgets fail on a dead renderer, separately from enforce', () => {
  const b = JSON.parse(readFileSync(new URL('../e2e/perf-budgets.json', import.meta.url), 'utf8'));
  assert.equal(b.failOnDeadRenderer, true);
});
