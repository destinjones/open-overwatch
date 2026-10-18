# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""The world's volcanoes for the globe: Wikidata (CC0) -> data/volcanoes.json

    python make_volcanoes.py        (the answer is cached in brand/source/volcanoes.json with its query; delete it to refresh)

Every item on Wikidata that is a volcano (or any kind of volcano) with coordinates: name, position, summit height, country, type
(stratovolcano, shield volcano...), Wikidata id. "Extinct" is kept as a type so the globe can dim those. Rows are arrays, columns in `cols`.
Heights are Wikidata's normalised values (psn:, always metres) of the best-rank statements: the plain wdt: value keeps the
unit it was entered in, and some summits are in feet (Mount Blackburn came out as "16,390 m"). A height entered without a
unit has no normalised value and stays empty (Gunung Barujari). Of several positions or heights one is chosen by value,
not by row order, so a re-run on the same answer gives the same file. A cache from another query is asked again.
"""
import json, re, subprocess, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RAW = HERE.parent / 'source' / 'volcanoes.json'
Q = '''SELECT ?v ?vLabel ?coord ?elev ?countryLabel ?typeLabel WHERE {
  ?v wdt:P31 ?type . ?type wdt:P279* wd:Q8072 . ?v wdt:P625 ?coord .
  OPTIONAL { ?v p:P2044 ?es . ?es a wikibase:BestRank ; psn:P2044/wikibase:quantityAmount ?elev . }
  OPTIONAL { ?v wdt:P17 ?country . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}'''


def fetch():
    if RAW.exists():
        c = json.loads(RAW.read_text(encoding='utf-8'))
        if isinstance(c, dict) and c.get('query') == Q: return c['bindings']
        print('the cached answer is from another query: asking Wikidata again')
    for attempt in range(3):
        r = subprocess.run(['curl', '-sSL', '--fail', '-m', '170', '-G', 'https://query.wikidata.org/sparql', '--data-urlencode', 'query=' + Q, '-H', 'Accept: application/sparql-results+json', '-A', 'open-overwatch/0.9 (https://github.com/destinjones/open-overwatch)'], capture_output=True)
        if r.returncode == 0:
            d = json.loads(r.stdout)['results']['bindings']; RAW.parent.mkdir(parents=True, exist_ok=True); RAW.write_text(json.dumps({'query': Q, 'bindings': d}), encoding='utf-8'); return d
        print('attempt', attempt + 1, 'failed', r.stderr.decode()[:70]); time.sleep(30)
    raise SystemExit('Wikidata kept failing; run again later')


def main():
    best = {}
    for r in fetch():
        vid = r['v']['value'].rsplit('/', 1)[1]; name = r['vLabel']['value']
        if re.fullmatch(r'Q\d+', name): continue
        m = re.match(r'Point\(([-\d.eE+]+) ([-\d.eE+]+)\)', r['coord']['value'])
        if not m: continue
        b = best.setdefault(vid, {'name': name, 'lon': None, 'lat': None, 'elev': None, 'country': '', 'types': []})
        lat, lon = round(float(m.group(2)), 3), round(float(m.group(1)), 3)
        if b['lat'] is None or (lat, lon) < (b['lat'], b['lon']): b['lat'], b['lon'] = lat, lon   # of several positions the smallest (lat, lon): SPARQL's row order isn't stable
        if r.get('elev'):   # metres; of several best-rank heights the highest, so a re-run gives the same file
            try: b['elev'] = max(b['elev'] or -1e9, round(float(r['elev']['value'])))
            except ValueError: pass
        if r.get('countryLabel') and not b['country']: b['country'] = r['countryLabel']['value']
        t = r.get('typeLabel', {}).get('value')
        if t and t not in b['types']: b['types'].append(t)
    rows = []
    for vid, b in best.items():
        types = [t for t in b['types'] if t != 'volcano'] or ['volcano']
        types.sort(key=lambda t: (t == 'extinct volcano', t))   # a more specific, living type first
        rows.append([b['name'], b['lat'], b['lon'], b['elev'], b['country'], types[0], vid])
    rows.sort(key=lambda r: -(r[3] or 0))
    out = {'source': 'Wikidata (CC0)', 'updated': time.strftime('%Y-%m-%d'), 'count': len(rows), 'cols': ['name', 'lat', 'lon', 'elevationM', 'country', 'type', 'wiki'], 'rows': rows}
    (ROOT / 'data' / 'volcanoes.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(rows)} volcanoes ({sum(1 for r in rows if r[3])} with a height, {sum(1 for r in rows if "extinct" in r[5])} extinct); {(ROOT / "data" / "volcanoes.json").stat().st_size / 1e3:.0f} kB')


if __name__ == '__main__':
    main()
