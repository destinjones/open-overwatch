# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""The cities for the "What's in the sky tonight in <city>" pages: Wikidata (CC0) -> data/cities.json

    python brand/tools/make_cities.py [--cache PATH]

ONE SPARQL query to query.wikidata.org (polite User-Agent with the repo URL): every city (an instance of city, Q515, or
any subclass) with at least 500,000 people, its coordinates, population, country (ISO 3166-1 alpha-2 from the country's
P297), English and Hindi labels and the IANA ids (P6687) of the time zones it says it is in (P421). From that answer
the world's TOP largest cities (default 400) plus every Indian city of the answer are kept: 443 rows on 2026-10-17 (85 Indian).

The raw answer is cached outside the repo (default: <system temp>/open-overwatch/cities-wikidata.json; delete it, or
pass another --cache, to ask Wikidata again), so a rebuild of the file is reproducible from the same answer.

Time zone (IANA), by this rule, in order (tzdata's zone.tab: each zone's country and principal city):
  1. the country has one zone in zone.tab (India, China, Japan, France...): that zone;
  2. else one of Wikidata's P421 -> P6687 ids that zone.tab files under the same country (the nearest if several);
  3. else the zone.tab zone of the same country whose principal city is nearest, unless TZ_FIX (checked by hand) says
     otherwise.
  Left empty (null) when none applies; the page then gives its times in UTC and the live card shows the visitor's clock.
  Rule 3 alone is wrong near a zone border (Dallas is nearer Vincennes, Indiana, on Eastern time, than Chicago): Wikidata's
  P421 almost never carries an IANA id (Singapore did on 2026-10-17), so TZ_FIX holds the hand-checked answers.

Population: the largest best-rank P1082 value (Wikidata's figure for the city as it defines it, so a Chinese
prefecture-level city counts its whole prefecture). One place, several items, merged into the city's own item with the
larger population: a metropolitan area or municipality and its city ("Greater Mexico City" and "Mexico City", "City of
Cape Town" and "Cape Town": the same name once "Greater", "Metro", "City of", "metropolitan area"... are taken off,
within 50 km), or two centres under 3 km apart. Items named as a province, state or region are left out, and a few
names are put right by hand (NAME_FIX). The world list takes at most PER_COUNTRY cities from one country (China's
prefecture-level cities would otherwise fill most of it); every Indian city of the answer is kept besides.
Slugs are ASCII (diacritics dropped): pune, new-york-city, sao-paulo; a name two cities share goes to the larger, the
other gets its country code (hyderabad, hyderabad-pk).
"""
import argparse, json, math, re, subprocess, sys, tempfile, time, unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / 'data' / 'cities.json'
CACHE = Path(tempfile.gettempdir()) / 'open-overwatch' / 'cities-wikidata.json'
UA = 'open-overwatch/0.9 (https://github.com/destinjones/open-overwatch; city sky pages, one query)'
MIN_POP = 500000
TOP = 400
PER_COUNTRY = 60
# Wikidata's label is the municipality's; the page should carry the name people search for (or drop a non-city)
NAME_FIX = {'eThekwini Metropolitan Municipality': 'Durban', 'City of Tshwane Metropolitan Municipality': 'Pretoria',
            'City of Ekurhuleni Metropolitan Municipality': 'Ekurhuleni', 'Nelson Mandela Bay Metropolitan Municipality': 'Nelson Mandela Bay',
            'Madrid city': 'Madrid', 'Metropolis of Lyon': 'Lyon', 'Katowice urban area': 'Katowice',
            # a region's population on an item without "province" in its name, or two countries' metropolitan area
            'El Paso–Juárez': None, 'Dong Nai': None, 'Bac Ninh': None, 'Quang Ninh': None, 'Veracruz': None, 'Masvingo': None}
# Rule 3 (the nearest zone.tab city of the country) checked by hand on 2026-10-17 for every city in a country with more
# than one zone: these were wrong (Dallas is not on Indiana's Eastern time, Kazan not on Ulyanovsk's) or named a
# small zone with the same clock (Munich: Busingen) where the usual one reads better. Rebuilds print the rule-3 picks.
TZ_FIX = {'Dallas': 'America/Chicago', 'Houston': 'America/Chicago', 'San Antonio': 'America/Chicago', 'Calgary': 'America/Edmonton',
          'Kazan': 'Europe/Moscow', 'Nizhny Novgorod': 'Europe/Moscow', 'Krasnodar': 'Europe/Moscow', 'Rostov-on-Don': 'Europe/Moscow',
          'Goiânia': 'America/Sao_Paulo', 'Guadalajara': 'America/Mexico_City', 'Zapopan': 'America/Mexico_City',
          'Munich': 'Europe/Berlin', 'Cologne': 'Europe/Berlin', 'Shymkent': 'Asia/Almaty', 'Astana': 'Asia/Almaty',
          'Medan': 'Asia/Jakarta', 'Batam': 'Asia/Jakarta', 'Ürümqi': 'Asia/Shanghai', 'Urumqi': 'Asia/Shanghai'}
NOT_A_CITY = re.compile(r'\b(province|state of|region|governorate|oblast)\b', re.I)
AREA = re.compile(r'^(greater|metro|city of|kota)\s+|\s+(metropolitan area|metropolitan municipality|metropolitan region|urban area|agglomeration|metropolis|city)$', re.I)


def core(name):
    """'Greater Mexico City' -> 'mexico', 'City of Cape Town' -> 'cape town': what a city and its area share."""
    s = name
    for _ in range(3):
        s = AREA.sub('', s).strip()
    return s.lower()


def area_like(name):
    """A metropolitan area or a municipality, not the city itself."""
    return bool(re.search(r'^(greater|metro|city of|kota)\s|\s(metropolitan|municipality|urban area|agglomeration)\b', name, re.I))


Q = '''SELECT ?c ?en ?hi ?pop ?coord ?iso ?iana WHERE {
  { SELECT DISTINCT ?c WHERE { ?c wdt:P1082 ?p0 . FILTER(?p0 >= %d) } }
  ?c wdt:P31/wdt:P279* wd:Q515 .
  FILTER NOT EXISTS { ?c wdt:P576 ?ended . }
  ?c wdt:P1082 ?pop ; wdt:P625 ?coord ; wdt:P17 ?country .
  ?country wdt:P297 ?iso .
  OPTIONAL { ?c rdfs:label ?en . FILTER(lang(?en) = "en") }
  OPTIONAL { ?c rdfs:label ?hi . FILTER(lang(?hi) = "hi") }
  OPTIONAL { ?c wdt:P421 ?tz . ?tz wdt:P6687 ?iana . }
}''' % MIN_POP


def fetch(cache):
    if cache.exists():
        return json.loads(cache.read_text(encoding='utf-8'))
    for attempt in range(3):
        r = subprocess.run(['curl', '-sSL', '--fail', '-m', '170', '-G', 'https://query.wikidata.org/sparql', '--data-urlencode', 'query=' + Q,
                            '-H', 'Accept: application/sparql-results+json', '-A', UA], capture_output=True)
        if r.returncode == 0:
            d = json.loads(r.stdout)['results']['bindings']
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({'asked': time.strftime('%Y-%m-%d', time.gmtime()), 'query': Q, 'bindings': d}), encoding='utf-8')
            return json.loads(cache.read_text(encoding='utf-8'))
        print('attempt', attempt + 1, 'failed', r.stderr.decode()[:120])
        time.sleep(30)
    raise SystemExit('Wikidata kept failing; run again later')


def zone_tab():
    """zone.tab rows: [(country, lat, lon, zone)], from the tzdata package (pip install tzdata) or the system's zoneinfo."""
    paths = []
    try:
        import tzdata
        paths.append(Path(tzdata.__file__).parent / 'zoneinfo' / 'zone.tab')
    except ImportError:
        pass
    paths += [Path('/usr/share/zoneinfo/zone.tab'), Path('/usr/lib/python3/dist-packages/tzdata/zoneinfo/zone.tab')]
    path = next((p for p in paths if p.exists()), None)
    if not path:
        raise SystemExit('zone.tab not found: pip install tzdata')

    def dms(s, deg):   # ISO 6709: +DDMM[SS] / +DDDMM[SS]
        sign = -1 if s[0] == '-' else 1
        d, rest = int(s[1:1 + deg]), s[1 + deg:]
        m = int(rest[:2]); sec = int(rest[2:4]) if len(rest) >= 4 else 0
        return sign * (d + m / 60 + sec / 3600)

    rows = []
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        cc, coord, zone = line.split('\t')[:3]
        m = re.fullmatch(r'([+-]\d+)([+-]\d+)', coord)
        rows.append((cc, dms(m.group(1), 2), dms(m.group(2), 3), zone))
    return rows


def km(a, b, c, d):
    p1, p2, dl = math.radians(a), math.radians(c), math.radians(d - b)
    return 6371 * math.acos(max(-1, min(1, math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl))))


def pick_zone(cc, lat, lon, wikidata_ids, zones):
    """(zone or None, rule number) by the rule in the docstring."""
    mine = [z for z in zones if z[0] == cc]
    if len({z[3] for z in mine}) == 1:
        return mine[0][3], 1
    near = lambda zs: min(zs, key=lambda z: km(lat, lon, z[1], z[2]))[3]
    named = [z for z in mine if z[3] in wikidata_ids]
    if named:
        return near(named), 2
    if mine:
        return near(mine), 3
    return None, 0


def slug_of(name):
    s = name.replace('ß', 'ss').replace('ø', 'o').replace('Ø', 'O').replace('ł', 'l').replace('Ł', 'L').replace('đ', 'd').replace('Đ', 'D').replace('ı', 'i').replace('æ', 'ae').replace('œ', 'oe')
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def build(bindings, zones, top=TOP):
    """The cached answer's rows -> the kept cities, most populous first: dicts with slug, en, hi, cc, lat, lon, pop, tz, qid."""
    items = {}
    for r in bindings:
        qid = r['c']['value'].rsplit('/', 1)[1]
        m = re.match(r'Point\(([-\d.eE+]+) ([-\d.eE+]+)\)', r['coord']['value'])
        en = r.get('en', {}).get('value')
        if en in NAME_FIX:
            en = NAME_FIX[en]
        if not m or not en or re.fullmatch(r'Q\d+', en) or NOT_A_CITY.search(en):
            continue
        try:
            pop = int(float(r['pop']['value']))
        except ValueError:
            continue
        it = items.setdefault(qid, {'qid': qid, 'en': en, 'hi': None, 'pop': 0, 'cc': set(), 'coord': set(), 'iana': set()})
        it['pop'] = max(it['pop'], pop)
        it['cc'].add(r['iso']['value'].upper())
        it['coord'].add((float(m.group(2)), float(m.group(1))))
        if r.get('hi'):
            it['hi'] = r['hi']['value']
        if r.get('iana'):
            it['iana'].add(r['iana']['value'])
    cities = []
    for it in items.values():
        if it['pop'] < MIN_POP:
            continue
        lat, lon = sorted(it['coord'])[0]   # several coordinates: any is the centre to a few km; sorted for a stable pick
        cc = sorted(it['cc'])[0]
        cities.append({'qid': it['qid'], 'en': it['en'], 'hi': it['hi'], 'cc': cc, 'lat': round(lat, 3), 'lon': round(lon, 3), 'pop': it['pop'], 'iana': it['iana']})
    # the city's own item first (then the larger), so an area folds into its city
    cities.sort(key=lambda c: (area_like(c['en']), -c['pop'], c['qid']))
    kept = []
    for c in cities:
        same = next((k for k in kept if km(c['lat'], c['lon'], k['lat'], k['lon']) < 3 or
                     (core(c['en']) == core(k['en']) and km(c['lat'], c['lon'], k['lat'], k['lon']) < 50)), None)
        if same:
            same['pop'] = max(same['pop'], c['pop'])
            continue
        kept.append(c)
    kept.sort(key=lambda c: (-c['pop'], c['qid']))
    world, per = [], {}
    for c in kept:
        if len(world) < top and per.get(c['cc'], 0) < PER_COUNTRY:
            world.append(c['qid'])
            per[c['cc']] = per.get(c['cc'], 0) + 1
    world = set(world)
    chosen = [c for c in kept if c['qid'] in world or c['cc'] == 'IN']
    rules, picks = [0, 0, 0, 0, 0], []
    seen = set()
    for c in chosen:   # most populous first, so the larger city keeps the plain slug
        c['tz'], rule = pick_zone(c['cc'], c['lat'], c['lon'], c.pop('iana'), zones)
        if rule == 3 and c['en'] in TZ_FIX:
            c['tz'], rule = TZ_FIX[c['en']], 4
        rules[rule] += 1
        if rule == 3:
            picks.append(f"{c['en']} ({c['cc']}): {c['tz']}")
        s = slug_of(c['en']) or c['qid'].lower()
        if s in seen:
            s = f"{s}-{c['cc'].lower()}"
        if s in seen:
            s = f"{s}-{c['qid'].lower()}"
        seen.add(s)
        c['slug'] = s
        if c['cc'] != 'IN':
            c['hi'] = None   # Hindi names are only needed for the Indian pages
    return chosen, rules, picks


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--cache', type=Path, default=CACHE, help=f'the raw Wikidata answer (default {CACHE})')
    ap.add_argument('--top', type=int, default=TOP)
    a = ap.parse_args()
    raw = fetch(a.cache)
    cities, rules, picks = build(raw['bindings'], zone_tab(), a.top)
    cols = ['slug', 'en', 'hi', 'cc', 'lat', 'lon', 'pop', 'tz', 'qid']
    out = {'source': 'Wikidata (CC0 1.0), one SPARQL query by brand/tools/make_cities.py', 'asked': raw['asked'],
           'note': f'the {a.top} most populous cities of the answer (population >= {MIN_POP:,}; at most {PER_COUNTRY} from one country) plus every Indian one; tz: IANA by the rule in make_cities.py (null: unknown)',
           'count': len(cities), 'cols': cols, 'rows': [[c[k] for k in cols] for c in cities]}
    text = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(text.replace('],[', '],\n['), encoding='utf-8')   # a row per line: small diffs on a rebuild
    india = sum(1 for c in cities if c['cc'] == 'IN')
    print(f"{len(cities)} cities ({india} Indian, {sum(1 for c in cities if c['hi'])} with a Hindi name); time zones by rule 1/2/3/fix: "
          f"{rules[1]}/{rules[2]}/{rules[3]}/{rules[4]}, none: {rules[0]}; {OUT.stat().st_size / 1e3:.0f} kB", file=sys.stderr)
    print('rule 3 (nearest zone.tab city; check the ones near a zone border, then TZ_FIX):', *picks, sep='\n  ', file=sys.stderr)


if __name__ == '__main__':
    main()
