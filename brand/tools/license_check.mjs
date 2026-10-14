// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// license_check.mjs — every package in the production dependency tree must carry a permissive licence.
//   node brand/tools/license_check.mjs [--dev]      exit code 1 on a copyleft, missing or unknown licence
// Reads the tree from package-lock.json and each licence from the installed node_modules/<name>/package.json (the
// lockfile's own field when a package isn't installed). --dev checks the dev dependencies (Playwright) as well.
// SPDX expressions work: "(MIT OR GPL-3.0)" passes on its MIT side, "(MIT AND GPL-3.0)" fails.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'CC0-1.0', 'BlueOak-1.0.0']);

// True when an SPDX expression is satisfied by the allowlist (OR: either side, AND: both, WITH: the base licence).
export function licenceOk(expr) {
  if (typeof expr !== 'string' || !expr.trim()) return false;
  const tokens = expr.replace(/[()]/g, ' $& ').trim().split(/\s+/);
  let i = 0;
  const atom = () => {
    const t = tokens[i++];
    if (t === '(') { const v = or(); i++; return v; }
    const ok = ALLOWED.has(t);
    if (tokens[i] === 'WITH') i += 2;   // an exception never makes a licence stricter
    return ok;
  };
  const and = () => { let v = atom(); while (tokens[i] === 'AND') { i++; v = atom() && v; } return v; };
  const or = () => { let v = and(); while (tokens[i] === 'OR') { i++; v = and() || v; } return v; };
  const v = or();
  return i === tokens.length && v;
}

// The licence a package.json declares: "license", or the old "licenses": [{ type }] form (all must pass).
export function declared(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) return pkg.licenses.map(l => l.type ?? l).join(' AND ');
  return null;
}

export function check(root, { dev = false } = {}) {
  const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
  const rows = [];
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (!path || (meta.dev && !dev) || meta.link) continue;
    const file = new URL(path + '/package.json', root);
    const pkg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : meta;
    const licence = declared(pkg);
    rows.push({ name: path.replace(/^.*node_modules\//, ''), version: pkg.version ?? meta.version, licence, ok: licenceOk(licence) });
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = check(new URL('../../', import.meta.url), { dev: process.argv.includes('--dev') });
  for (const r of rows) console.log(`${r.ok ? 'ok ' : 'BAD'}  ${r.name}@${r.version}  ${r.licence ?? '(no licence)'}`);
  const bad = rows.filter(r => !r.ok);
  console.log(bad.length ? `\n${bad.length} package(s) outside the allowlist: ${[...ALLOWED].join(', ')}` : `\n${rows.length} package(s), all permissive`);
  process.exit(bad.length ? 1 : 0);
}
