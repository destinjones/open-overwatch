"""Build data/airports.json, or with --runways data/runways.json, for the globe's airport boards from OurAirports
(public domain).

Airports: large and medium airports that have scheduled service or an IATA code (about 4,500), as compact rows
[icao, iata, name, city, country code, lat, lon, elevation ft, size (2 large, 1 medium)].
Runways: the open runways of those airports with both thresholds known, as rows
[icao, low end ident, high end ident, low lat, low lon, high lat, high lon, length ft, surface].

    python brand/tools/make_airports.py [path/to/airports.csv]
    python brand/tools/make_airports.py --runways [path/to/runways.csv]   (for the airports already in airports.json)

Without a path it downloads the CSV from https://davidmegginson.github.io/ourairports-data/ (airports ~12 MB,
runways ~3.5 MB) into a temporary folder first. Standard library only.
"""
import csv, datetime, io, json, os, sys, tempfile, urllib.request

BASE = "https://davidmegginson.github.io/ourairports-data/"
DATA = os.path.join(os.path.dirname(__file__), "..", "..", "data")
SOURCE = "OurAirports (ourairports.com), public domain"


def fetch(name, path=None):
    if path:
        with open(path, encoding="utf-8") as f:
            return f.read()
    with tempfile.TemporaryDirectory() as tmp:
        dest = os.path.join(tmp, name)
        req = urllib.request.Request(BASE + name, headers={"User-Agent": "open-overwatch make_airports.py"})
        with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
            f.write(r.read())
        with open(dest, encoding="utf-8") as f:
            return f.read()


def airport_rows(text):
    """Yields (ourairports ident, row)."""
    for r in csv.DictReader(io.StringIO(text)):
        kind = r.get("type")
        if kind not in ("large_airport", "medium_airport"):
            continue
        iata = (r.get("iata_code") or "").strip().upper()
        if not (iata or r.get("scheduled_service") == "yes"):
            continue
        code = (r.get("icao_code") or r.get("gps_code") or r.get("ident") or "").strip().upper()
        if not code or len(code) > 4 or not code.isalnum():
            continue
        try:
            lat, lon = round(float(r["latitude_deg"]), 4), round(float(r["longitude_deg"]), 4)
        except (KeyError, ValueError):
            continue
        try:
            elev = int(float(r.get("elevation_ft") or 0))
        except ValueError:
            elev = 0
        yield (r.get("ident") or "").strip().upper(), [code, iata if len(iata) == 3 else "", (r.get("name") or code).strip()[:90],
                                                       (r.get("municipality") or "").strip()[:60], (r.get("iso_country") or "").strip()[:2], lat, lon, elev,
                                                       2 if kind == "large_airport" else 1]


def runway_rows(text, codes):
    """codes: OurAirports ident -> our code. Yields runway rows of those airports."""
    for r in csv.DictReader(io.StringIO(text)):
        code = codes.get((r.get("airport_ident") or "").strip().upper())
        if not code or r.get("closed") == "1":
            continue
        try:
            ends = [round(float(r[k]), 5) for k in ("le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg")]
        except (KeyError, ValueError):
            continue
        try:
            length = int(float(r.get("length_ft") or 0)) or None
        except ValueError:
            length = None
        yield [code, (r.get("le_ident") or "").strip()[:4], (r.get("he_ident") or "").strip()[:4], *ends, length, (r.get("surface") or "").strip()[:12]]


def write(name, doc):
    out = os.path.join(DATA, name)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    today = datetime.date.today().isoformat()
    if "--runways" in sys.argv:   # runways.csv names airports by OurAirports ident, which is the ICAO code for these
        with open(os.path.join(DATA, "airports.json"), encoding="utf-8") as f:
            codes = {r[0]: r[0] for r in json.load(f)["airports"]}
        rws = list(runway_rows(fetch("runways.csv", args[0] if args else None), codes))
        out = write("runways.json", {"source": SOURCE, "updated": today, "cols": ["icao", "le", "he", "leLat", "leLon", "heLat", "heLon", "lengthFt", "surface"], "runways": rws})
        print(f"{len(rws)} runways at {len({r[0] for r in rws})} of {len(codes)} airports -> {os.path.normpath(out)} ({os.path.getsize(out) // 1024} KB)")
        return
    pairs = sorted(airport_rows(fetch("airports.csv", args[0] if args else None)), key=lambda p: (-p[1][8], p[1][0]))
    seen, uniq = set(), []
    for _, row in pairs:
        if row[0] in seen:
            continue
        seen.add(row[0])
        uniq.append(row)
    out = write("airports.json", {"source": SOURCE, "updated": today, "cols": ["icao", "iata", "name", "city", "cc", "lat", "lon", "elevFt", "size"], "airports": uniq})
    print(f"{len(uniq)} airports ({sum(1 for r in uniq if r[8] == 2)} large) -> {os.path.normpath(out)} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
