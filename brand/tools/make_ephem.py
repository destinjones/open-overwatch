# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""The Moon and the Sun as seen from Earth, 2026-2030, from JPL Horizons -> data/solar/ephem.json (+ a test fixture)

    python brand/tools/make_ephem.py

What for: eclipses (solar and lunar) and lunar occultations in the Solar System view (src/core/syzygy.js). The view's
own Moon (src/core/planets.js, Schlyter + the main perturbations) is ~0.3 degrees off, more than half the Moon's
width: enough to miss an occultation altogether and to put a solar eclipse's shadow on the wrong continent.

Horizons: geocentric (500@399) apparent (VEC_CORR LT+S) vectors, ICRF axes rotated to the ecliptic of J2000
(REF_PLANE ECLIPTIC), km, times in UT. The Moon every hour, the Sun every day.

Stored as Chebyshev series per segment (the Moon 4 days, degree 13; the Sun 32 days, degree 13), fitted by least squares
on the samples. Evaluation: src/core/syzygy.js chebEval. The fit is checked here on the samples and on 40 instants that
were never sampled (fetched separately: test/fixtures/horizons_ephem_check.json, which the tests use as well).

Raw Horizons answers are cached in brand/source/horizons/ephem/ (gitignored); requests are sequential, 1 s apart.
"""
import json, math, time, urllib.parse, urllib.request
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE.parent / 'source' / 'horizons' / 'ephem'
OUT = ROOT / 'data' / 'solar' / 'ephem.json'
FIX = ROOT / 'test' / 'fixtures' / 'horizons_ephem_check.json'
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
JD0 = 2461041.5           # 2026-01-01 00:00 UT
JD1 = 2462867.5           # 2031-01-01 00:00 UT
BODIES = {'moon': dict(cmd='301', step_h=1, seg_days=4, deg=13), 'sun': dict(cmd='10', step_h=24, seg_days=32, deg=13)}

_last = [0.0]


def horizons(params, name):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / name
    if f.exists():
        return f.read_text()
    q = dict(format='json', OBJ_DATA="'NO'", MAKE_EPHEM="'YES'", EPHEM_TYPE="'VECTORS'", CENTER="'500@399'",
             REF_SYSTEM="'ICRF'", REF_PLANE="'ECLIPTIC'", VEC_CORR="'LT+S'", OUT_UNITS="'KM-S'", VEC_TABLE="'1'",
             CSV_FORMAT="'YES'", VEC_LABELS="'NO'", TIME_TYPE="'UT'", **params)
    wait = 1.0 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    print('  horizons', name)
    req = urllib.request.Request(API + '?' + urllib.parse.urlencode(q), headers={'User-Agent': 'open-overwatch make_ephem.py'})
    with urllib.request.urlopen(req, timeout=180) as r:
        txt = json.loads(r.read().decode('utf-8'))['result']
    _last[0] = time.time()
    f.write_text(txt)
    return txt


def rows_of(txt):
    body = txt[txt.index('$$SOE') + 5:txt.index('$$EOE')]
    out = []
    for line in body.strip().splitlines():
        c = [x.strip() for x in line.split(',')]
        out.append((float(c[0]), float(c[2]), float(c[3]), float(c[4])))
    return out


def jd_iso(jd):
    t = (jd - 2440587.5) * 86400
    return time.strftime('%Y-%m-%d %H:%M', time.gmtime(round(t)))


def samples(key):
    b, rows = BODIES[key], []
    years = range(2026, 2031) if b['step_h'] < 24 else [None]
    for y in years:
        a, z = (f'{y}-01-01', f'{y + 1}-01-01') if y else ('2026-01-01', '2031-01-01')
        txt = horizons(dict(COMMAND=f"'{b['cmd']}'", START_TIME=f"'{a}'", STOP_TIME=f"'{z}'", STEP_SIZE=f"'{b['step_h']} h'"),
                       f"{key}_{a}_{z}_{b['step_h']}h.txt")
        r = rows_of(txt)
        if rows and abs(r[0][0] - rows[-1][0]) < 1e-6:
            r = r[1:]
        rows.extend(r)
    return np.array(rows)


def fit(key, S):
    b = BODIES[key]
    n_seg = int(round((JD1 - JD0) / b['seg_days']))
    segs, worst = [], 0.0
    for k in range(n_seg):
        a = JD0 + k * b['seg_days']; z = a + b['seg_days']
        m = (S[:, 0] >= a - 1e-6) & (S[:, 0] <= z + 1e-6)
        t = 2 * (S[m, 0] - a) / b['seg_days'] - 1
        V = np.polynomial.chebyshev.chebvander(t, b['deg'])
        seg = []
        for c in range(3):
            co, *_ = np.linalg.lstsq(V, S[m, 1 + c], rcond=None)
            co = np.round(co, 3)
            worst = max(worst, float(np.max(np.abs(V @ co - S[m, 1 + c]))))
            seg.append([float(x) for x in co])
        segs.append(seg)
    print(f'{key}: {n_seg} segments of {b["seg_days"]} d, degree {b["deg"]}; worst fit error on the samples {worst:.3f} km')
    return dict(t0=JD0, seg_days=b['seg_days'], deg=b['deg'], segs=segs)


def cheb(ser, jd):
    k = min(max(int((jd - ser['t0']) // ser['seg_days']), 0), len(ser['segs']) - 1)
    t = 2 * (jd - ser['t0'] - k * ser['seg_days']) / ser['seg_days'] - 1
    return [float(np.polynomial.chebyshev.chebval(t, co)) for co in ser['segs'][k]]


def main():
    out = {'source': 'JPL Horizons: geocentric apparent (LT+S) vectors, ecliptic J2000 axes, km; time argument JD (UT)',
           'made': time.strftime('%Y-%m-%d'), 'range': [JD0, JD1]}
    for key in BODIES:
        out[key] = fit(key, samples(key))
    # 40 instants never sampled (irregular minutes), for the check here and for the tests
    rng = np.random.default_rng(20261013)
    tl = sorted(float(np.round(x, 6)) for x in JD0 + 2 + rng.random(40) * (JD1 - JD0 - 4))
    tl = [round(round((x - 0.5) * 1440) / 1440 + 0.5, 6) + 7 / 1440 for x in tl]   # whole minutes + 7, off the hour grid
    fx = {'source': 'JPL Horizons, geocentric apparent (LT+S), ecliptic J2000, km, JD UT (TLIST)', 'moon': [], 'sun': []}
    for key in BODIES:
        txt = horizons(dict(COMMAND=f"'{BODIES[key]['cmd']}'", TLIST=' '.join(f"'{x:.6f}'" for x in tl), TLIST_TYPE="'JD'"),
                       f'{key}_check40.txt')
        worst = 0.0
        for r in rows_of(txt):
            fx[key].append([r[0], round(r[1], 3), round(r[2], 3), round(r[3], 3)])
            worst = max(worst, math.dist(cheb(out[key], r[0]), r[1:]))
        print(f'{key}: worst error at 40 unsampled instants {worst:.3f} km')
    OUT.write_text(json.dumps(out, separators=(',', ':')))
    FIX.write_text(json.dumps(fx, separators=(',', ':')))
    print(f'{OUT.name} {OUT.stat().st_size // 1024} KB, {FIX.name} {FIX.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
