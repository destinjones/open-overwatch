"""Build data/airports.json for the globe's airport boards from OurAirports (public domain).

Keeps large and medium airports that have scheduled service or an IATA code (about 4,500), as compact rows:
[icao, iata, name, city, country code, lat, lon, elevation ft, size (2 large, 1 medium)].

    python brand/tools/make_airports.py [path/to/airports.csv]

Without a path it downloads https://davidmegginson.github.io/ourairports-data/airports.csv (about 12 MB) into a
temporary folder first. Standard library only.
"""
import csv, datetime, io, json, os, sys, tempfile, urllib.request

SRC = "https://davidmegginson.github.io/ourairports-data/airports.csv"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "airports.json")


def rows(text):
    for r in csv.DictReader(io.StringIO(text)):
        kind = r.get("type")
        if kind not in ("large_airport", "medium_airport"):
            continue
        iata = (r.get("iata_code") or "").strip().upper()
        sched = r.get("scheduled_service") == "yes"
        if not (iata or sched):
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
        yield [code, iata if len(iata) == 3 else "", (r.get("name") or code).strip()[:90], (r.get("municipality") or "").strip()[:60],
               (r.get("iso_country") or "").strip()[:2], lat, lon, elev, 2 if kind == "large_airport" else 1]


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            text = f.read()
    else:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "airports.csv")
            req = urllib.request.Request(SRC, headers={"User-Agent": "open-overwatch make_airports.py"})
            with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
                f.write(r.read())
            with open(path, encoding="utf-8") as f:
                text = f.read()
    out = sorted(rows(text), key=lambda r: (-r[8], r[0]))
    seen, uniq = set(), []
    for r in out:
        if r[0] in seen:
            continue
        seen.add(r[0])
        uniq.append(r)
    doc = {"source": "OurAirports (ourairports.com), public domain", "updated": datetime.date.today().isoformat(),
           "cols": ["icao", "iata", "name", "city", "cc", "lat", "lon", "elevFt", "size"], "airports": uniq}
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"{len(uniq)} airports ({sum(1 for r in uniq if r[8] == 2)} large) -> {os.path.normpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
