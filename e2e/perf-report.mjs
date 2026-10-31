// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Turns the performance run's per-page results (e2e/.results/perf/<page>-<profile>.json, from e2e/perf.spec.mjs) into
// one report: perf-report.json (everything, plus the budget check) and perf-summary.md (the table, the worst offenders
// first with the script and the hottest functions behind each, the leaks, the budgets). Long-animation-frame script
// positions and CPU-profile lines are mapped to file:line in this checkout.
//   node e2e/perf-report.mjs [results-dir] [--budgets e2e/perf-budgets.json]
// Exits 1 when a budget is exceeded and the budget file says "enforce": true; otherwise it only warns.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const BUDGETS = flag('--budgets') || path.join(ROOT, 'e2e', 'perf-budgets.json');
const DIR = path.resolve(args[0] || path.join(ROOT, 'e2e', '.results', 'perf'));
const ORDER = ['landing', 'map', 'globe', 'solar', 'tonight', 'guide', 'india'];

const runs = existsSync(DIR) ? readdirSync(DIR).filter(f => /^[a-z]+-(desktop|phone)\.json$/.test(f)).map(f => JSON.parse(readFileSync(path.join(DIR, f), 'utf8'))) : [];
runs.sort((a, b) => ORDER.indexOf(a.page) - ORDER.indexOf(b.page) || a.profile.localeCompare(b.profile));
if (!runs.length) { console.error(`no results in ${DIR}`); process.exit(2); }

// ---- file:line for a script URL and a character position (long animation frames) or a line (CPU profiles) ----
const texts = new Map();
function local(url) {
  try { const u = new URL(url); if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null; return decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html'; } catch (e) { return null; }
}
function short(url) {
  const l = local(url); if (l) return l;
  try { const u = new URL(url); return u.hostname + u.pathname.replace(/^(.{0,20}).*(.{30})$/, '$1…$2'); } catch (e) { return url || '(no url)'; }
}
function lineOf(url, pos) {
  const rel = local(url); if (!rel || pos == null || pos < 0) return short(url);
  const file = path.join(ROOT, rel);
  if (!texts.has(file)) texts.set(file, existsSync(file) ? readFileSync(file, 'utf8') : null);
  const t = texts.get(file); if (t == null) return rel;
  const before = t.slice(0, pos), line = before.split('\n').length;
  return `${rel}:${line}`;
}
const own = url => { const l = local(url); return !!l && !/\/vendor\//.test(l); };
const fmtFn = f => `${f.fn || '(anonymous)'} ${own(f.url) ? local(f.url) : short(f.url)}:${f.line}`;

/** The script that ran in a window's worst long animation frames, as "invoker → file:line fn". */
function loafCulprits(ph) {
  const out = [];
  for (const fr of ph.loaf?.top || []) for (const s of fr.scripts || []) {
    if (s.d < 20) continue;
    out.push({ ms: Math.round(s.d), where: `${lineOf(s.url, s.pos)}${s.fn ? ' ' + s.fn : ''}`, invoker: s.inv || s.type || '', forcedLayoutMs: Math.round(s.forced || 0) });
  }
  const seen = new Set();
  return out.sort((a, b) => b.ms - a.ms).filter(o => !seen.has(o.where) && seen.add(o.where)).slice(0, 3);
}
/** The hottest functions of the same window in the profiled pass: the page's own code first, then anything. */
function hot(run, name) {
  const p = name === 'Boot' ? run.cpuProfile?.boot : run.cpuProfile?.phases?.[name];
  if (!p) return { own: [], all: [] };
  const fns = p.top.filter(f => f.ms >= 5);
  return { own: fns.filter(f => own(f.url)).slice(0, 3).map(f => `${fmtFn(f)} (${f.ms} ms)`), all: fns.slice(0, 3).map(f => `${fmtFn(f)} (${f.ms} ms, ${f.pct}%)`) };
}

// ---- the numbers per run, as the budgets name them ----
function metrics(r) {
  const ph = r.phases || [];
  const max = k => Math.max(0, ...ph.map(k));
  return {
    readyMs: r.boot?.readyMs ?? null,
    fcpMs: r.boot?.fcpMs ?? null,
    bootTbtMs: r.boot?.window?.longTasks.tbtMs ?? null,
    bootLongestTaskMs: r.boot?.window?.longTasks.maxMs ?? null,
    bootRequests: r.boot?.requests ?? null,
    bootMB: r.boot?.MB ?? null,
    worstP95Ms: ph.length ? max(p => p.frames.p95) : null,
    worstP99Ms: ph.length ? max(p => p.frames.p99) : null,
    framesOver100: ph.length ? ph.reduce((s, p) => s + p.frames.over100, 0) : null,
    longestTaskMs: ph.length ? max(p => p.longTasks.maxMs) : null,
    interactionTbtMs: ph.length ? ph.reduce((s, p) => s + p.longTasks.tbtMs, 0) : null,
    cls: Math.round(((r.boot?.window?.cls.total || 0) + ph.reduce((s, p) => s + p.cls.total, 0)) * 1e4) / 1e4,
    idleHeapGrowthMB: r.leak?.idle?.heapMB ?? null,
    loopHeapGrowthMB: r.leak?.loop?.heapMB ?? null,
    loopNodesGrowth: r.leak?.loop?.nodes ?? null,
  };
}

// ---- budgets ----
const budgets = existsSync(BUDGETS) ? JSON.parse(readFileSync(BUDGETS, 'utf8')) : { enforce: false, default: {} };
const budgetFor = (page, profile) => ({ ...(budgets.default?.[profile] || {}), ...(budgets.pages?.[page]?.[profile] || {}) });
const violations = [];
for (const r of runs) {
  const m = metrics(r), b = budgetFor(r.page, r.profile);
  for (const [k, limit] of Object.entries(b)) if (m[k] != null && m[k] > limit) violations.push({ page: r.page, profile: r.profile, metric: k, value: m[k], budget: limit });
}

// ---- the worst offenders: every measured window, scored ----
const windows = [];
for (const r of runs) {
  if (r.boot?.window) windows.push({ r, name: 'Boot', ph: r.boot.window, wallMs: r.boot.readyMs });
  for (const p of r.phases || []) windows.push({ r, name: p.name, ph: p, wallMs: p.wallMs, error: p.error });
}
const score = w => w.ph.longTasks.tbtMs + 100 * w.ph.frames.over100 + 5 * w.ph.frames.over33 + 1000 * w.ph.cls.total;
windows.sort((a, b) => score(b) - score(a));
const offenders = windows.filter(w => score(w) > 0).slice(0, 25).map(w => ({
  page: w.r.page, profile: w.r.profile, window: w.name, score: Math.round(score(w)), error: w.error || null,
  frames: w.ph.frames, longTasks: { n: w.ph.longTasks.n, tbtMs: w.ph.longTasks.tbtMs, maxMs: w.ph.longTasks.maxMs, attribution: [...new Set(w.ph.longTasks.top.map(t => t.attribution).filter(Boolean))] },
  cls: w.ph.cls, scripts: loafCulprits(w.ph), hottest: hot(w.r, w.name),
}));

const report = { generated: new Date().toISOString(), commit: runs[0].commit, enforce: !!budgets.enforce, runs: runs.map(r => ({ page: r.page, profile: r.profile, env: r.env, metrics: metrics(r), pageErrors: r.pageErrors?.length || 0, errors: (r.phases || []).filter(p => p.error).map(p => `${p.name}: ${p.error}`) })), offenders, violations, raw: runs };
writeFileSync(path.join(DIR, 'perf-report.json'), JSON.stringify(report, null, 1));

// ---- markdown ----
const n = (x, d = 0) => x == null ? '–' : typeof x === 'number' ? x.toLocaleString('en-US', { maximumFractionDigits: d }) : x;
const s = x => x == null ? '–' : `${n(x / 1000, 1)} s`;
const md = [];
md.push(`# Performance run ${report.generated.slice(0, 10)}${report.commit ? ` · ${report.commit.slice(0, 7)}` : ''}`, '');
md.push(`Headless Chromium, software WebGL (SwiftShader), feeds stubbed, a full-size synthetic satellite catalogue. Phone = Pixel 7 screen and touch with the CPU slowed 4×. Budgets: **${budgets.enforce ? 'enforced' : 'warn only'}**.`, '');
md.push('| Page · profile | Ready | FCP | Boot TBT | Boot req · MB | Worst p95 / p99 frame | Frames > 100 ms | Longest task | Interaction TBT | CLS | Heap idle / loop (MB) | Nodes loop |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of runs) {
  const m = metrics(r);
  md.push(`| ${r.page} · ${r.profile} | ${s(m.readyMs)} | ${s(m.fcpMs)} | ${n(m.bootTbtMs)} ms | ${n(m.bootRequests)} · ${n(m.bootMB, 1)} | ${n(m.worstP95Ms)} / ${n(m.worstP99Ms)} ms | ${n(m.framesOver100)} | ${n(m.longestTaskMs)} ms | ${n(m.interactionTbtMs)} ms | ${n(m.cls, 3)} | ${n(m.idleHeapGrowthMB, 1)} / ${n(m.loopHeapGrowthMB, 1)} | ${n(m.loopNodesGrowth)} |`);
}
md.push('', '## Worst offenders', '', 'Scored as blocking time + 100 × frames over 100 ms + 5 × frames over 33 ms + 1000 × layout shift.', '');
offenders.slice(0, 20).forEach((o, i) => {
  md.push(`${i + 1}. **${o.page} · ${o.profile} · ${o.window}**: p50/p95/p99 ${o.frames.p50}/${o.frames.p95}/${o.frames.p99} ms, worst frame ${n(o.frames.max)} ms, ${o.frames.over100} frames > 100 ms, ${o.frames.over33} > 33 ms; ${o.longTasks.n} long tasks (TBT ${n(o.longTasks.tbtMs)} ms, longest ${n(o.longTasks.maxMs)} ms)${o.cls.total ? `; CLS ${o.cls.total}` : ''}${o.error ? `; step error: ${o.error}` : ''}`);
  if (o.scripts.length) md.push(`   - long-frame scripts: ${o.scripts.map(c => `${c.where} [${c.invoker}] ${c.ms} ms${c.forcedLayoutMs ? `, forced layout ${c.forcedLayoutMs} ms` : ''}`).join('; ')}`);
  if (o.hottest.own.length) md.push(`   - hottest own code: ${o.hottest.own.join('; ')}`);
  if (o.hottest.all.length) md.push(`   - hottest overall: ${o.hottest.all.join('; ')}`);
  if (o.cls.top?.length && o.cls.total) md.push(`   - shifted: ${o.cls.top.map(c => `${c.v} ${c.src.join(' ')}`).join('; ')}`);
});
md.push('', '## Leaks (after garbage collection)', '', '| Page · profile | Heap at start | Idle growth | Loop growth (rounds) | DOM nodes idle / loop | Listeners loop |', '|---|---|---|---|---|---|');
for (const r of runs) if (r.leak?.start) md.push(`| ${r.page} · ${r.profile} | ${r.leak.start.heapMB} MB | ${r.leak.idle.heapMB} MB / ${r.leak.idleS} s | ${r.leak.loop.heapMB} MB / ${r.leak.loopS} s (${r.leak.loop.rounds}) | ${r.leak.idle.nodes} / ${r.leak.loop.nodes} | ${r.leak.loop.listeners} |`);
md.push('', `## Budgets (${budgets.enforce ? 'enforced: the job fails' : 'warn only'})`, '');
if (!violations.length) md.push('Every run is inside its budgets.');
else { md.push('| Page · profile | Metric | Value | Budget |', '|---|---|---|---|'); for (const v of violations) md.push(`| ${v.page} · ${v.profile} | ${v.metric} | ${n(v.value, 2)} | ${n(v.budget, 2)} |`); }
const errs = report.runs.filter(r => r.errors.length);
if (errs.length) { md.push('', '## Steps that could not run', ''); for (const r of errs) for (const e of r.errors) md.push(`- ${r.page} · ${r.profile}: ${e}`); }
writeFileSync(path.join(DIR, 'perf-summary.md'), md.join('\n') + '\n');

console.log(md.join('\n'));
for (const v of violations.slice(0, 20)) console.log(`::${budgets.enforce ? 'error' : 'warning'} title=perf budget::${v.page} ${v.profile}: ${v.metric} ${v.value} > ${v.budget}`);
if (budgets.enforce && violations.length) process.exit(1);
