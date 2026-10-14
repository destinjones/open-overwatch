# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""Deep-sky objects for "what's up tonight": OpenNGC (pinned release) -> data/deepsky.json

    python -I make_deepsky.py [SOURCE_DIR]

OpenNGC (https://github.com/mattiaverga/OpenNGC, CC-BY-SA-4.0) is the NGC/IC catalogue with modern positions,
magnitudes, sizes and Messier numbers, plus an addendum of famous objects outside NGC/IC (the Pleiades, M40, the
Hyades, the LMC...). The release is pinned by TAG and each CSV by its SHA-256: if upstream changes a file, this script
stops instead of quietly building something different. To move to a new release, change TAG and the hashes together
and read the release notes.

SOURCE_DIR holds NGC.csv and addendum.csv (default brand/source/openngc/<TAG>/, downloaded there from the tag when
missing; that folder is not committed). Kept: every Messier object, and NGC/IC/addendum objects of deep-sky types
(no single stars, doubles or "Other") brighter than MAG_LIMIT (V, or B when there is no V), plus those with a common
name but no magnitude (big nebulae such as the North America Nebula). Duplicate and non-existent entries are dropped.
"""
import csv, hashlib, json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / 'data' / 'deepsky.json'
TAG = 'v20260501'
FILES = {
    'NGC.csv': '840fe0c9ee1332e551b2e722a0e92726cd7b157914a3d2177602832aadd3aa9e',
    'addendum.csv': '1d8f0914e643ada325a5a94d88d8fefad6a4937a2f77cc34f21483af22b11983',
}
URL = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/{tag}/database_files/{name}'
MAG_LIMIT = 12.5
SKIP_TYPES = {'Dup', 'NonEx', '*', '**', 'Other', 'Nova'}   # Messier objects of these types (M40, a double) stay
FIELDS = ['id', 'm', 'type', 'ra', 'dec', 'mag', 'band', 'maj', 'min', 'name', 'con']


def fetch(folder):
    folder.mkdir(parents=True, exist_ok=True)
    for name, sha in FILES.items():
        f = folder / name
        if not f.exists():
            print('downloading', name, 'from OpenNGC', TAG)
            with urllib.request.urlopen(URL.format(tag=TAG, name=name), timeout=60) as r: f.write_bytes(r.read())
        got = hashlib.sha256(f.read_bytes()).hexdigest()
        if got != sha:
            sys.exit(f'{f}: SHA-256 {got} is not the pinned {sha} for OpenNGC {TAG}. Upstream changed: stop and check.')


def angle(s, hours):
    """'hh:mm:ss.s' or '+dd:mm:ss.s' -> degrees."""
    sign = -1 if s.startswith('-') else 1
    h, m, x = (float(p) for p in s.lstrip('+-').split(':'))
    return sign * (h + m / 60 + x / 3600) * (15 if hours else 1)


def num(s):
    return float(s) if s.strip() else None


def ident(name):
    """'NGC0224' -> 'NGC 224', 'IC0434' -> 'IC 434', 'Mel022' -> 'Mel 22', 'ESO056-115' -> 'ESO 56-115'."""
    m = re.match(r'^([A-Za-z]+)0*(\d.*)$', name)
    return f'{m[1]} {m[2]}' if m else name


def rows(folder):
    for name in FILES:
        with open(folder / name, encoding='utf-8', newline='') as f:
            for r in csv.DictReader(f, delimiter=';'):
                r['_addendum'] = name == 'addendum.csv'
                yield r


def keep(r):
    if r['Type'] in ('Dup', 'NonEx') or not r['RA'] or not r['Dec']: return False
    if r['M']: return True
    if r['Type'] in SKIP_TYPES: return False
    if not (r['_addendum'] or r['Name'].startswith(('NGC', 'IC'))): return False
    mag = num(r['V-Mag']) if r['V-Mag'] else num(r['B-Mag'])
    return mag <= MAG_LIMIT if mag is not None else bool(r['Common names'])


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / 'source' / 'openngc' / TAG
    fetch(folder)
    out = []
    for r in rows(folder):
        if not keep(r): continue
        band = 'V' if r['V-Mag'] else ('B' if r['B-Mag'] else None)
        mag = num(r['V-Mag'] or r['B-Mag'] or '')
        maj, mn = num(r['MajAx']), num(r['MinAx'])
        out.append([ident(r['Name']), int(r['M']) if r['M'] else None, r['Type'], round(angle(r['RA'], True), 4), round(angle(r['Dec'], False), 4),
                    mag, band, maj, mn, r['Common names'].split(',')[0].strip() or None, r['Const'] or None])
    out.sort(key=lambda o: (o[1] is None, o[1] or 0, o[5] if o[5] is not None else 99))
    doc = {
        'licence': 'CC-BY-SA-4.0',
        'note': f'CC-BY-SA-4.0, derived from OpenNGC {TAG} (https://github.com/mattiaverga/OpenNGC, Mattia Verga and contributors). '
                'This file is a selection and reformatting of that catalogue; it keeps the CC-BY-SA-4.0 licence, not the site\'s MIT licence.',
        'source': {'repo': 'https://github.com/mattiaverga/OpenNGC', 'tag': TAG, 'sha256': FILES},
        'selection': f'Messier objects, and NGC/IC/addendum deep-sky objects to magnitude {MAG_LIMIT} (V, else B) or with a common name; '
                     'no single or double stars, duplicates or non-existent entries',
        'units': {'ra': 'deg J2000', 'dec': 'deg J2000', 'mag': 'mag (band V or B)', 'maj': 'arcmin', 'min': 'arcmin'},
        'fields': FIELDS,
        'rows': out,
    }
    OUT.write_text(json.dumps(doc, separators=(',', ':'), ensure_ascii=False).replace('],[', '],\n['), encoding='utf-8')
    ms = sum(1 for o in out if o[1])
    print(f'{OUT.name}: {len(out)} objects ({ms} Messier), {OUT.stat().st_size / 1e3:.0f} KB')


if __name__ == '__main__':
    main()
