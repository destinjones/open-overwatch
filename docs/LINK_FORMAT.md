# Share-link format

Everything a globe link carries lives in the URL **hash** of `globe.html` (the part after `#`), so nothing is stored on a
server and nothing about the view is sent to one. This page describes the format in full, for anyone who builds links:
the globe's own Share button, embeds, `tonight.html`, the landing page and the MCP server (`mcp/place.mjs`) all use it.

The code is `src/core/viewlink.js` (pure functions, tested in `test/viewlink.test.mjs`); the globe applies a decoded
link in `src/globe/share.js` (`Share.restore`). The drawing field is encoded in `src/core/measure.js`
(`encodeDrawing` / `decodeDrawing`), Director scenes in `src/core/scene.js`.

```
https://destinjones.github.io/open-overwatch/globe.html#c=-0.1278,51.5074,3500,30,-45&l=stations,air,quakes,terrain
```

## Contents

- [The parameters at a glance](#the-parameters-at-a-glance)
- [Two kinds of link](#two-kinds-of-link)
- [Each parameter](#each-parameter): `c` · `l` · `a` · `x` · `w` · `t` · `k` · `f` · `s` · `o` · `d` · `go` · `id` · `embed` · `scene`
- [What happens on arrival](#what-happens-on-arrival)
- [A hash that changes in an open page](#a-hash-that-changes-in-an-open-page)
- [Building links from code](#building-links-from-code)
- [Other pages](#other-pages): the Solar System view's own links
- [Checklist](#checklist)

## The parameters at a glance

Parameters are `key=value` pairs joined with `&`, read with `URLSearchParams`, so their order doesn't matter. The
globe's own encoder escapes commas as `%2C` (that is what `URLSearchParams.toString()` does); plain commas decode the
same way, and the examples here use them for readability.

| Key | Value | Example | Meaning |
|---|---|---|---|
| `c` | `lon,lat,height,heading,pitch` | `c=139.6917,35.6895,4500000,0,-90` | the camera. **Required for a view link** |
| `l` | layer ids | `l=stations,quakes,storms` | exactly these layers on, every other one off |
| `a` | layer ids | `a=quakes,storms` | switch these on, leave the others as the visitor has them |
| `x` | layer ids | `x=starlink,debris` | switch these off, leave the others |
| `w` | weather source ids and model tokens | `w=ir,radar,wind,ecmwf` | open weather mode with these sources (and model) |
| `t` | `julianDate,rate` | `t=2461326.25,60` | set the clock to that moment, running at that rate |
| `k` | ISO 3166-1 alpha-2 | `k=JP` | open that country's card and outline |
| `f` | callsign | `f=BAW123` | look for that flight |
| `s` | NORAD catalogue number | `s=25544` | select a satellite and follow it |
| `o` | `sensor.h.d` | `o=flir.h.d` | the Ops look: sensor, HUD, detection boxes |
| `d` | drawing | `d=pvrzH4prniD*QmlnIEJlbg` | the draw-and-measure shapes |
| `go` | panel name | `go=tonight` | open a panel (links **without** `c` only) |
| `id` | item id | `go=launches&id=abc-123` | one launch or eclipse in that panel |
| `embed` | `1` | `embed=1&c=…` | embed mode, for an `<iframe>` |
| `scene` | base64url | `scene=djE7…` | a Director scene (takes precedence over a view) |

## Two kinds of link

`decodeView(hash)` returns a view only when the hash has a usable `c`. Everything else is decided by that:

1. **A view link** has `c=`. The camera goes there and every other parameter applies on top. `go` and `id` are ignored
   in a view link (the flight in `f` still works).
2. **A panel link** has no `c=`. `decodeExtras(hash)` then reads only `go`, `id` and `f`: it opens a panel, optionally at
   one item, and/or looks for a flight, and leaves the camera alone. This is what the landing page and `tonight.html`
   use, because they don't know where the visitor's camera should be.

A hash shorter than 4 characters, or one whose `c` fails the checks below, is not a view link.

## Each parameter

### `c` — the camera

`c=lon,lat,height,heading,pitch`

| Field | Unit | Written as | Accepted |
|---|---|---|---|
| `lon` | degrees east | 4 decimals (~11 m) | −180 to 180 |
| `lat` | degrees north | 4 decimals | −90 to 90 |
| `height` | metres above the ellipsoid | whole metres | 0 to 10,000,000,000 (the camera goes no lower than 150 m when applied) |
| `heading` | degrees clockwise from north | 1 decimal | any number; missing or not a number: 0 |
| `pitch` | degrees, −90 is straight down | 1 decimal | any number; missing or not a number: −90 |

The first three fields must be numbers inside their ranges or the whole link is refused (`decodeView` returns `null`).
`heading` and `pitch` are optional: `c=10,20,3000` is a straight-down view of that point from 3 km.

The camera's own position is what is stored, not the point it looks at. For a tilted view of a place, move the camera
back from the place along the reverse heading (`mcp/place.mjs` `frame()` does this: `back = height / tan(-pitch)`).
Rough heights: 3,500 m a street, 1.4 million m a continent, 20 million m the whole Earth, 160 million m the
geostationary belt. The globe's camera stops at 600 million m; beyond about 300 million m the Solar System view takes over.

```
#c=-0.1278,51.5074,3500,30,-45        London from 3.5 km, facing NNE, tilted 45°
#c=-40,0,160000000                     the geostationary ring, straight down
```

### `l` — exactly these layers

`l=id,id,id` turns on the listed layers and **turns every other layer off**. Ids are the `id` fields of `LAYERS` in
`src/globe/layers.js`:

`stations` `visual` `gnss` `geo` `weather` `starlink` `active` `debris` `launches` `air` `mil` `airq` `smoke` `airports`
`quakes` `transit` `buoys` `dart` `tides` `sst` `ships` `bikes` `traffic` `storms` `fires` `radio` `lighthouses` `sun` `terrain` `buildings` `cams` `cctv`
`alpr` `milareas` `photoreal` `volcanoes` `companies` `aurora` `clouds` `night` `labels`

What each one shows is in the [user guide](../guide.html#layers). Each id must match `[a-z0-9_-]{1,24}` (case-insensitive)
or it is dropped; at most 60 are read; ids the globe doesn't have are ignored. An empty `l=` turns every layer off.

The globe's Share button always writes `l`, because it knows the sender's layers. A link made somewhere else should use
`a` and `x` instead (below), so the visitor's own choices survive.

### `a` and `x` — layers on and off, the rest as they are

`a=quakes,storms` switches those on; `x=starlink` switches that off; every layer not named stays as the visitor has it.
Same id rules as `l`. They apply after `l` if both are present, and a layer named in both ends up off (`x` wins).
The MCP server writes only `a` and `x`.

### `w` — weather mode

`w=ir,radar` opens weather mode with exactly those sources on (the others off), after the camera is placed. Ids are the
keys of `Weather.sets` in `src/globe/weather.js`:

| Id | Source |
|---|---|
| `ir` | clouds: GOES-East, GOES-West and Himawari infrared via NASA GIBS (forecast: the model's cloud cover) |
| `radar` | rain radar from RainViewer (forecast: the model's rain rate) |
| `rain` | rain from space, NASA IMERG |
| `lightning` | lightning, NOAA nowCOAST (the Americas and the Pacific) |
| `wind` | 10 m wind from the model |
| `temp` | 2 m temperature from the model |
| `pres` | pressure: isobars with highs and lows (H, L) |
| `gust` | wind gusts |
| `wave` | ocean waves (NOAA WAVEWATCH III with GFS, ECMWF's wave model with ECMWF) |

The same list can also carry the forecast model (`Weather.shareTokens()` / `fromTokens()`), mixed in with the source ids:

| Token | Meaning |
|---|---|
| `ecmwf` | forecast from ECMWF IFS (0.25°) instead of NOAA GFS (1°, the default, written as no token) |
| `compare` | both models side by side, with a slider between them |

`w=ir,radar,wind,pres,ecmwf,compare` is a valid list. Unknown ids are ignored.

Weather mode shows the whole Earth: when it opens from lower than a global view it flies out, so a link with `w`
does not keep a close-up camera (the MCP server keeps weather links at 3,000 km or higher). `w=` with no ids opens
weather mode with every source off.

### `t` — the clock

`t=julianDate,rate`. The Julian Date (UTC, days; 5 decimals ≈ 1 s) must be between 2,000,000 and 3,000,000 or `t` is
ignored. `rate` is simulated seconds per real second: `1` real time, `0` paused, `60` a minute a second, `-3600` an hour
a second backwards; missing or not a number: 1. Without `t` the globe is live.

A Julian Date from a Unix time in milliseconds: `jd = ms / 86400000 + 2440587.5` (`jdFromMs` in `src/core/time.js`).

```
#c=-95,30,9000000&t=2461326.25,60     2026-10-12 18:00 UTC, a minute a second
```

Moving the clock away from live hides aircraft (there is no record of where they were); satellites, the Sun, the Moon
and the weather follow it.

### `k` — a country

`k=JP`: two **upper-case** letters, the ISO 3166-1 alpha-2 code. The country's card opens and its border lights up once
the borders have loaded. Lower case is refused. Codes the globe has no border for are ignored.

### `f` — a flight

`f=BAW123`: 2 to 8 letters and digits, upper-cased on arrival. The globe's flight finder looks for that callsign. It
works in view links and panel links. On the website it searches the aircraft it has and otherwise offers adsb.lol's map;
the download version asks adsb.lol and keeps refreshing.

### `s` — a satellite to follow

`s=25544`: a NORAD catalogue number, 1 to 9 digits (leading zeros are dropped: `0025544` is `25544`). Once the
satellites have loaded, the globe selects it and follows it if it has a 3D model, otherwise flies to it. The satellite
must be in one of the loaded CelesTrak groups; turn on its layer with `a` if it might be off (the MCP server adds the
group's layer itself).

### `o` — the Ops look

`o=sensor.h.d`, dot-separated: the sensor first, then `h` for the tactical HUD and `d` for detection boxes, each
optional.

| Sensor | Look | Key |
|---|---|---|
| `normal` | normal colour | 1 |
| `nvg` | night vision | 2 |
| `flir` | thermal, white hot | 3 |
| `flirbh` | thermal, black hot | 4 |
| `iron` | thermal, ironbow | 5 |
| `crt` | old monitor | 6 |
| `noir` | black and white | 7 |

The list is `SENSORS` in `src/core/voicecmd.js`. An unknown sensor reads as `normal`. The encoder leaves `o` out when
the look is normal with no HUD and no boxes. Examples: `o=nvg`, `o=flir.h.d`, `o=normal.h`.

### `d` — the drawing

The draw-and-measure shapes, written by `encodeDrawing` in `src/core/measure.js`. Shapes are joined by `.`; each is:

| Part | Meaning |
|---|---|
| kind letter | `p` pin (1 point), `l` line (2+), `a` area (3+, not closed: the first point is not repeated), `d` distance arrow (exactly 2), `D` a distance arrow whose road route is asked for again on arrival (OSRM) |
| points | each point's longitude then latitude as **differences** from the previous point (the first from 0,0), in millionths of a degree (~0.1 m), each written as a zigzag varint in the base64url alphabet |
| `*name` (optional) | the shape's name: UTF-8, base64url without padding; up to 60 characters |

A country outline is `o` and its upper-case ISO code: `oFR`.

The number encoding is the one in Google's polyline format, with a different alphabet: zigzag the integer
(`z = v < 0 ? -2v - 1 : 2v`), then write 5 bits at a time, least significant first, as `B64[c + 32]` while more follow
and `B64[c]` for the last, where `B64` is `A–Z a–z 0–9 - _`. Every character is one `URLSearchParams` leaves alone.

Worked example: a pin named "Big Ben" at −0.1246, 51.5007.

```
lon -0.1246 → -124600 → zigzag 249199 → 5-bit groups 15, 11, 19, 7 → v r z H
lat 51.5007 → 51500700 (from 0) → zigzag 103001400 → 4prniD
name "Big Ben" → base64url → QmlnIEJlbg
shape: p vrzH 4prniD *QmlnIEJlbg  →  pvrzH4prniD*QmlnIEJlbg
```

With a distance by road from Paris to Berlin and France's outline added:

```
#c=2.35,48.86,1200000,0,-90&d=pvrzH4prniD*QmlnIEJlbg.DwkyvEwh_l9CgwziVwiz_G.oFR
```

Limits and checks (`decodeDrawing`): the field is at most 9,000 characters (the encoder leaves `d` out entirely when
the drawing would not fit; the Share button says so); at most 200 parts and 512 points in all; a number longer than
7 characters, a point outside ±180/±90, or a point count that doesn't fit the kind drops that shape only; names lose
control and direction-changing characters and are shown as text; a repeated outline is kept once. Outlines need the
country borders, which load on arrival.

### `go` — open a panel (panel links only)

`go=name` with one of the names in `GO` (`src/core/viewlink.js`):

| `go=` | Opens |
|---|---|
| `tonight` | Tonight above you |
| `flight` | Find a flight |
| `search` | Search |
| `launches` | the launch list |
| `crew` | people in space |
| `eclipses` | the solar eclipses |
| `flybys` | asteroid and comet flybys |
| `conj` | near misses (close approaches in orbit) |
| `now` | Earth now, the dashboard |

Anything else is ignored. Look up is deliberately not in the list: it needs a tap first (phones ask for motion sensors
only after one). `go` is read only when the hash has no `c`.

### `id` — one item in the panel

With `go=launches`, a Launch Library 2 launch id opens the list at that launch; with `go=eclipses`, an eclipse's date
(`YYYY-MM-DD`, as in `data/eclipses.json`) does the same. 1 to 40 characters from `[A-Za-z0-9_.-]`; anything else is ignored. `tonight.html` hands launches and
eclipses over to the globe this way.

```
#go=launches&id=<Launch Library 2 id>
#go=eclipses&id=2027-08-02
```

### `embed` — embed mode

`embed=1` anywhere in the address (the hash or the query) puts the globe in embed mode (`src/globe/env.js` `EMBED`):
no toasts about location or reminders, no Ops rail, no "Tonight" nudge, and an "Open Overwatch ↗" link (top right) that
opens the full site at the current view. When the link has been applied, an embedded globe posts
`{ type: 'oo:ready' }` to the page framing it.

The navpad's `</>` button writes an iframe like this (`Share.embedCode()`):

```html
<iframe src="https://destinjones.github.io/open-overwatch/globe.html#embed=1&c=…" width="100%" height="480"
  style="border:0;border-radius:12px" loading="lazy" allow="fullscreen" title="Open Overwatch: the Earth, live"></iframe>
```

### `scene` — a Director scene

`scene=` plus base64url (no padding) of the text `v1;` followed by shots joined with `|`, each
`lon,lat,h,heading,pitch,roll,dur,hold,sensor` (degrees, metres, seconds; `dur` is how long the flight to the shot
takes, `hold` how long to stay). At most 40 shots; each is range-checked (`cleanShot` in `src/core/scene.js`) and
dropped if anything is out of range. A hash with a usable scene opens the Director with it and does **not** apply a
view.

```
v1;-0.1278,51.5074,3500,30,-45,0,4,2,normal|2.3522,48.8566,2000000,0,-90,0,6,0,nvg
#scene=djE7LTAuMTI3OCw1MS41MDc0LDM1MDAsMzAsLTQ1LDAsNCwyLG5vcm1hbHwyLjM1MjIsNDguODU2NiwyMDAwMDAwLDAsLTkwLDAsNiwwLG52Zw
```

## What happens on arrival

When the boot screen has gone, `Share.restore()` applies the link in this order:

1. Layers: `l`, then `a` and `x`.
2. The clock: `t`.
3. The Ops look: `o`.
4. The camera: `c` (set at once on a fresh page).
5. The satellite to follow: `s` (once the satellites have loaded).
6. The drawing: `d` (its card opens on desktops unless the link also opens a country or a flight, never in embeds;
   phones get a short message instead, as the card would cover the drawing).
7. Weather mode: `w`.
8. The country card: `k` (once the borders have loaded).
9. The flight: `f`.

Nothing in a link is trusted: numbers are range-checked, ids are limited to safe characters, names are shown as text,
and a part that fails its check is dropped on its own.

## A hash that changes in an open page

If the hash changes while the globe is open (a link pasted into the same tab, or a page framing the globe moving it),
the link is applied again and the camera **flies** there (2.5 s) instead of jumping. Whatever the new link does not
name goes back to how a fresh page starts: following stops, the clock goes live (no `t`), weather mode closes (no
`w`), a country card closes (no `k`) and the look goes back to normal (no `o`). Layers not named stay as they are.

The MCP server's chat panel uses this: it frames `globe.html#embed=1&…` once and moves it by changing only the hash,
so the globe flies from answer to answer without reloading.

## Building links from code

In JavaScript, use the module itself (it has no dependencies beyond `voicecmd.js` and `measure.js` in the same folder,
and runs in Node and browsers):

```js
import { encodeView } from './src/core/viewlink.js';

const hash = encodeView({
  lon: -122.4194, lat: 37.7749, height: 25000, heading: 0, pitch: -90,
  add: ['quakes', 'terrain'], drop: ['starlink'],   // a/x: leave the visitor's other layers alone
  time: null, country: null, weather: null,
});
const url = 'https://destinjones.github.io/open-overwatch/globe.html#' + hash;
```

`encodeView` fields: `lon`, `lat`, `height`, `heading`, `pitch` (required); `layers` (→ `l`), `add` (→ `a`), `drop`
(→ `x`), `weather` (→ `w`), `time: { jd, rate }` (→ `t`), `country` (→ `k`), `flight` (→ `f`, written only if it is
2-8 letters and digits), `sat` (→ `s`, digits only), `ops: { sensor, hud, detect }` (→ `o`), `drawing` (→ `d`, a list of
`{ kind, coords: [[lon, lat]…], name?, road? }` or `{ kind: 'outline', iso }`).

`mcp/place.mjs` `globeUrl(site, v)` is a worked example on top of it: it keeps only known layer and weather ids, turns
a Unix time into a Julian Date, and writes `a`/`x` rather than `l`. Its `panelUrl(site, go, id)` writes panel links.

In another language, build the hash by hand from the table above. Use `encodeURIComponent` on values (or leave commas
plain; both decode), keep layer ids lower case, and test the result by opening it.

## Other pages

### The Solar System view (`solar.html#…`)

The Solar System view has its own hash, written and read by `src/core/solarlink.js` (`encodeSolarView`,
`decodeSolarView`; tested in `test/solar.test.mjs`) and applied by `src/solar/find.js`. The address follows what you
fly to, and a body's card has a button that copies it. A hash that changes in an open page is applied again.

```
solar.html#f=craft:Voyager%201&t=2026-10-12T06:00&d=0.0012&r=1
solar.html#q=halley
```

| Key | Value | Meaning |
|---|---|---|
| `f` | body key | the focus: a key in the view's registry, such as `mars`, `moon`, `moon:Titan`, `craft:Juno`, `comet:1P/Halley`, `ast:433 Eros`; 1 to 80 letters, digits, spaces and `: . / ' ( ) + , _ -` |
| `q` | text | a search to run when there is no `f` (for hand-written links); 2 to 60 characters, the best match is flown to |
| `t` | `YYYY-MM-DDTHH:MM` (UTC) | the moment, 1800 to 2200 (also `YYYY-MM-DD`, or with seconds or a `Z`); left out = live |
| `r` | number | clock rate in days per second, only with `t`; at most 3,652.5 either way; with `t` but no `r` the clock is paused |
| `d` | number | camera distance from the focus in AU (written to 3 significant figures) |

A comet or asteroid that isn't drawn yet is found by its name (the part after `comet:` or `ast:`). A hash that names
nothing usable is ignored.

Two query parameters also exist: `solar.html?focus=mars` opens at a body when there is no hash (anything unknown opens
at Earth), and `solar.html?embed=1` is the mode the globe uses when it hands the camera over (not meant for links).

### The 2D map (`open-overwatch.html#…`)

The 2D map reads and writes the **globe's format** (`src/map/share.js`, using `src/core/viewlink.js`), so a link made on
either view opens the same area on the other:

- `c` gives the centre; the height becomes a map zoom and back (`heightToZoom`, `zoomToHeight`: at zoom z a map ~950 px
  wide shows about what a 60° camera sees from that height). The map writes heading 0 and pitch −90.
- `l` with the **2D map's own layer ids** (listed in the [user guide](../guide.html#map2d)) sets exactly those layers. A
  globe link's `l` or `a` instead switches on the 2D counterparts of its globe layers, leaving the others as they are:
  `quakes`, `storms`, `cams`, `transit`, `bikes`, `aurora` (same ids), `ships` → `ships_fi`, `fires` → `hotspots` and
  `fireperims`, `sun` → `terminator`, `mil` → `air_mil`, `airports` (same id) (`mapLayersFor`; the globe's `air` switches nothing on, as the
  2D aircraft layers query the area themselves). `x` switches 2D layers off.
- The other way (`globeLayersFor`, the map's 3D globe button): the same pairs, plus `air_local` and `air_opensky` →
  `air` and the keyed 2D `fires` → `fires` (`MAP_TO_GLOBE` in viewlink.js).
- `w` (the globe's weather mode) switches on the 2D forecast layers: `wind` → `wx_wind`, `temp` → `wx_temp`, `pres` →
  `wx_pres`, `gust` → `wx_gust`, `wave` → `wx_wave`, `ir` → `wx_cloud`, `radar` → `wx_rain`, and `ecmwf` picks that
  model (`MAP_TO_WEATHER`, `mapWeatherFor`). The map writes `w` too, from its forecast layers (`weatherFor`), so its
  3D globe button opens weather mode on the same fields and model; the globe's Classic map button carries its weather
  sets back the same way.
- `d` carries the drawing (the 2D map has the same draw-and-measure tools).
- The other parameters are ignored. Once applied, the hash is removed and the map keeps its own view.

The map's **3D globe** button opens `globe.html` at the same place with `a=` for the matching globe layers, `w=` for
its forecast layers and the drawing.

### Tonight

`tonight.html` takes no link parameters; it hands launches and eclipses to the globe with `#go=…&id=…`.

## Checklist

- [ ] The link has `c=lon,lat,height` with numbers in range, **or** it is a panel link with `go=`.
- [ ] Layer ids come from `src/globe/layers.js`; links made outside the globe use `a`/`x`, not `l`.
- [ ] Country codes are upper case; callsigns are 2-8 letters and digits; `s` is digits.
- [ ] Times are Julian Dates (`ms / 86400000 + 2440587.5`), not Unix times.
- [ ] Weather links have a camera high enough to show the whole Earth.
- [ ] You opened the link and looked.
