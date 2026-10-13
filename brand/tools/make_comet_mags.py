# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""JPL Horizons' total magnitudes (T-mag) of a few comets -> test/fixtures/horizons_comet_mags.json

    python brand/tools/make_comet_mags.py

Horizons computes T-mag = M1 + 5 log10(delta) + k1 log10(r) from the comet's SBDB parameters, which is what
src/core/comets.js cometMagnitude does with data/solar/small_bodies.json's M1/K1; the test checks our geometry
(two-body orbits, Earth from the JPL approximate elements) and formula against Horizons' at three dates each.
Observer tables, geocentric (500@399), QUANTITIES 9 (T-mag, N-mag), 19 (r), 20 (delta). Cached in
brand/source/horizons/comet_mags/; requests 1 s apart.
"""
import json, time, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE.parent / 'source' / 'horizons' / 'comet_mags'
OUT = ROOT / 'test' / 'fixtures' / 'horizons_comet_mags.json'
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
# label prefix in small_bodies.json, Horizons command (current apparition)
COMETS = [('2P/', 'DES=2P;CAP;NOFRAG'), ('12P/', 'DES=12P;CAP;NOFRAG'), ('29P/', 'DES=29P;CAP;NOFRAG'),
          ('67P/', 'DES=67P;CAP;NOFRAG'), ('16P/', 'DES=16P;CAP;NOFRAG'), ('332P', 'DES=332P;CAP;NOFRAG'),
          ('C/2023 A3', 'DES=2023 A3;CAP'), ('C/2025 A6', 'DES=2025 A6;CAP')]
DATES = ['JD2461226.5', 'JD2461326.5', 'JD2461456.5']   # 2026-07-04, 2026-10-12, 2027-02-19 (0h UT)

_last = [0.0]


def horizons(cmd, name):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / name
    if f.exists():
        return f.read_text()
    q = dict(format='json', COMMAND=f"'{cmd}'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'", EPHEM_TYPE="'OBSERVER'", CENTER="'500@399'",
             QUANTITIES="'9,19,20'", CSV_FORMAT="'YES'", TIME_TYPE="'UT'", TLIST=' '.join(f"'{d[2:]}'" for d in DATES), TLIST_TYPE="'JD'")
    wait = 1.0 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    print('  horizons', cmd)
    req = urllib.request.Request(API + '?' + urllib.parse.urlencode(q), headers={'User-Agent': 'open-overwatch make_comet_mags.py'})
    with urllib.request.urlopen(req, timeout=120) as r:
        txt = json.loads(r.read().decode('utf-8'))['result']
    _last[0] = time.time()
    f.write_text(txt)
    return txt


def main():
    out = {'source': 'JPL Horizons observer tables (geocentric): T-mag, r (AU), delta (AU) at 0h UT', 'comets': []}
    for label, cmd in COMETS:
        txt = horizons(cmd, label.replace('/', '_').replace(' ', '_') + '.txt')
        if '$$SOE' not in txt:
            print('  no table for', label); continue
        head = [h.strip() for h in txt[:txt.index('$$SOE')].strip().splitlines()[-2].split(',')]
        rows = []
        for line in txt[txt.index('$$SOE') + 5:txt.index('$$EOE')].strip().splitlines():
            c = [x.strip() for x in line.split(',')]
            d = dict(zip(head, c))
            rows.append([DATES[len(rows)], float(d['T-mag']), float(d['r']), float(d['delta'])])
        out['comets'].append({'label': label, 'rows': rows})
        print(f'  {label:12s}', ' '.join(f'{r[1]:6.2f}' for r in rows))
    OUT.write_text(json.dumps(out, indent=1))
    print(OUT.name, OUT.stat().st_size, 'B')


if __name__ == '__main__':
    main()
