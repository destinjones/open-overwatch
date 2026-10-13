# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""JPL Horizons check positions for the Solar System view's comets and spacecraft -> test/fixtures/horizons_solar_2026-10-12.json

    python brand/tools/make_solar_fixture.py

Each entry is one Horizons state vector (heliocentric ecliptic J2000, AU, AU/day, TT/TDB) at one instant. The tests in
test/solar.test.mjs check our comet orbits (two-body from SBDB elements, src/core/comets.js) and our spacecraft track
interpolation (src/core/craft.js) against them. Spacecraft instants are chosen half-way between track samples, the worst
case for interpolation. Raw responses are cached in brand/source/horizons/ (gitignored); requests are 1 s apart.
"""
import datetime as dt, hashlib, json, os, re, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, 'brand', 'source', 'horizons')
OUT = os.path.join(ROOT, 'test', 'fixtures', 'horizons_solar_2026-10-12.json')
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
JD = 2461325.5           # 2026-10-12 00:00 TT

# label as in data/solar/small_bodies.json (prefix match), Horizons command
COMETS = [
    ('1P/Halley', 'DES=1P;CAP;NOFRAG'), ('2P/Encke', 'DES=2P;CAP;NOFRAG'),
    ('12P/Pons-Brooks', 'DES=12P;CAP;NOFRAG'), ('29P/Schwassmann-Wachmann', 'DES=29P;CAP;NOFRAG'),
    ('55P/Tempel-Tuttle', 'DES=55P;CAP;NOFRAG'), ('67P/Churyumov-Gerasimenko', 'DES=67P;CAP;NOFRAG'),
    ('109P/Swift-Tuttle', 'DES=109P;CAP;NOFRAG'), ('C/1995 O1', 'DES=1995 O1;CAP'),
    ('C/2020 F3', 'DES=2020 F3;CAP'), ('C/2023 A3', 'DES=2023 A3;CAP'), ('C/2025 A6', 'DES=2025 A6;CAP'),
    ('C/2025 N1', 'DES=2025 N1;CAP'),
]
# name as in data/solar/spacecraft.json, Horizons id, JD (half-way between samples)
CRAFT = [
    ('Voyager 1', -31, JD + 2.5), ('New Horizons', -98, JD + 2.5), ('Parker Solar Probe', -96, JD),
    ('Europa Clipper', -159, JD + 2.5), ('BepiColombo', -121, JD), ('James Webb Space Telescope', -170, JD + 2.5),
    ('Juno', -61, 2461002.0),          # 2025-11-23 12:00, half-way between 3-day samples, in Jupiter orbit
    ('Lucy', -49, JD + 2.5), ('Psyche', -255, JD + 2.5), ('Solar Orbiter', -144, JD + 2.5),
    ('Cassini', -82, 2453501.5),       # 2005-05-16 00:00, in Saturn orbit
    ('Rosetta', -226, 2457213.0),      # 2015-07-14 12:00, at comet 67P
]

_last = [0.0]


def vec(command, jd):
    params = dict(format='json', COMMAND=f"'{command}'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'", EPHEM_TYPE="'VECTORS'",
                  CENTER="'500@10'", REF_PLANE="'ECLIPTIC'", REF_SYSTEM="'ICRF'", VEC_TABLE="'2'",
                  OUT_UNITS="'AU-D'", CSV_FORMAT="'YES'", VEC_LABELS="'NO'", TLIST=f"'{jd}'", TIME_TYPE="'TT'")
    url = API + '?' + urllib.parse.urlencode(params)
    key = re.sub(r'[^0-9A-Za-z_-]', '_', f'vec_{command}_{jd}')
    path = os.path.join(CACHE, key + '_' + hashlib.sha1(url.encode()).hexdigest()[:8] + '.json')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    else:
        wait = 1.0 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        print('  horizons', command, jd)
        req = urllib.request.Request(url, headers={'User-Agent': 'open-overwatch make_solar_fixture.py'})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read().decode('utf-8'))
        _last[0] = time.time()
        os.makedirs(CACHE, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f)
    res = data.get('result') or ''
    if '$$SOE' not in res:
        raise SystemExit(f'{command}: {data.get("error") or res[:1500]}')
    p = [s.strip() for s in res.split('$$SOE', 1)[1].split('$$EOE', 1)[0].strip().split(',')]
    return [float(v) for v in p[2:8]]


def main():
    out = dict(source='JPL Horizons API (VECTORS, CENTER 500@10, ecliptic J2000, AU and AU/day)',
               fetched=dt.date.today().isoformat(), comets_jd=JD, comets={}, craft={})
    for label, cmd in COMETS:
        out['comets'][label] = vec(cmd, JD)
    for name, cid, jd in CRAFT:
        out['craft'][name] = dict(jd=jd, state=vec(str(cid), jd))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
