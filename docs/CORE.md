# The shared core (`src/core/`)

Every module in `src/core/` is plain JavaScript with **no DOM and no three.js or Cesium imports**, so the same code
runs in the browser views, in Node's tests and in the MCP server. This page lists each module: what it is for, who uses
it, and its main exports. The source is the authority (each module opens with a comment that says more); this is the
map. `test/docs.test.mjs` checks that every module has a section here and that every export named here exists.

Conventions (see [ARCHITECTURE.md](ARCHITECTURE.md)): the space frame is heliocentric ecliptic J2000 in AU; time is a
Julian Date (`jd`) or, for things on Earth, milliseconds since 1970 (`ms`); angles are radians inside the orbital maths
and degrees for anything geographic; vector functions write into an `out` object (`{ x, y, z }` or a `THREE.Vector3`)
instead of allocating.

"Used by" names the parts that import a module: **globe** (`src/globe/`), **solar** (`src/solar/`), **map** (the 2D
map, `src/map/`), **sky** (`tonight.html`, `src/sky/`), **app** (`src/app/`, the shell every page loads), **mcp**
(`mcp/`), **tools** (`brand/tools/`), **core** (other core modules). Every module
is also used by its tests in `test/`.

## Contents

- [Time, units and frames](#time-units-and-frames): `time.js`, `units.js`, `rotation.js`
- [Orbits and the Solar System](#orbits-and-the-solar-system): `kepler.js`, `planets.js`, `moons.js`, `smallbodies.js`, `comets.js`, `craft.js`, `accuracy.js`
- [Satellites](#satellites): `tle.js`, `passes.js`, `observer.js`, `socrates.js`, `explain.js`
- [The night sky](#the-night-sky): `sky.js`, `skyfacts.js`, `skyplace.js`, `solarsys.js`, `meteors.js`, `clouds.js`, `eclipse.js`, `eclipselocal.js`, `syzygy.js`, `orientation.js`
- [Geometry on the Earth](#geometry-on-the-earth): `geo.js`, `measure.js`, `borders.js`, `mgrs.js`, `route.js`, `campose.js`
- [Launches and people in space](#launches-and-people-in-space): `launches.js`, `ascent.js`, `crew.js`
- [Weather](#weather): `gfs.js`, `wxmodels.js`, `grib2.js`, `aec.js`, `jpx.js`, `fields.js`, `contour.js`
- [Hazards and imagery](#hazards-and-imagery): `hazards.js`, `quakes.js`, `eonet.js`, `cyclones.js`, `gdacs.js`, `aurora.js`, `fireclusters.js`, `fires.worker.js`, `earthnow.js`
- [Aviation](#aviation): `aircraft.js`, `actype.js`, `phase.js`, `airports.js`, `runways.js`, `aloft.js`, `trail.js`
- [Things that move: aircraft, ships, transit, bikes, traffic](#things-that-move): `flight.js`, `ais.js`, `transit.js`, `transitfeeds.js`, `gtfsrt.js`, `bikes.js`, `cameras.js`, `cables.js`, `mvt.js`, `roadtiles.js`, `traffic.js`
- [OpenStreetMap](#openstreetmap): `osmtiles.js`, `overpass.js`
- [Links, words and the interface](#links-words-and-the-interface): `viewlink.js`, `solarlink.js`, `search.js`, `scene.js`, `voicecmd.js`, `format.js`, `ics.js`, `radio.js`
- [Network and devices](#network-and-devices): `assets.js`, `relay.js`, `gpu.js`
- [The app shell](#the-app-shell): `pwa.js`, `spot.js`, `a11ycheck.js`

## Time, units and frames

### `time.js`

Julian Dates and the simulation clock. `jd` is TT ≈ UTC: the 69 s difference is far below anything drawn. Used by
globe, solar, sky, mcp, core.

- `jdFromMs`, `msFromJd`, `jdNow`: conversions (`jd = ms / 86400000 + 2440587.5`).
- `J2000`, `UNIX_EPOCH_JD`, `julianCenturies`: the epoch constants and centuries since J2000.
- `formatUtc`: "2026-10-02 04:19 UTC".
- `SimClock`: the simulation clock. `rate` is simulated days per real second; at `REAL_TIME` and in step with the wall
  clock it is "live" and follows `Date.now()` exactly. Clamped to a `min`/`max` Julian Date (the Solar System view uses
  1800 to 2200).

### `units.js`

Constants and the one rotation between the equatorial and ecliptic frames. Used by globe, solar, mcp, core.

- `AU_KM`, `KM_AU`, `LY_AU`, `PC_AU`, `C_KM_S`, `C_AU_DAY`, `DEG`, `OBLIQUITY_J2000`.
- `eqToEcl`, `eclToEq`: equatorial (ICRF/J2000) ↔ ecliptic J2000.
- `radecToEcl`: the unit vector toward a right ascension and declination (degrees), in the ecliptic frame.
- `GALACTIC`, `SUN_TO_GALACTIC_CENTRE_LY`: galactic axes in the ecliptic frame, and the Sun's distance from the centre.
- `setXYZ`: write x, y, z into an `out` object.

### `rotation.js`

Which way each body faces: the IAU WGCCRE rotation models (main terms; periodic terms left out). Body-fixed axes have x
on the prime meridian (texture longitude 0) and y toward the north pole, matching three.js sphere UVs. Used by solar.

- `IAU_ROTATION`: pole right ascension and declination, prime meridian angle and their rates, per body.
- `primeMeridian`: the prime meridian angle W at a Julian Date.
- `bodyAxes`: the body-fixed axes as unit vectors in the ecliptic frame.

## Orbits and the Solar System

### `kepler.js`

Two-body orbits. Elements are `{ a (AU), e, i, node, peri (radians), M0 (radians at epoch), epoch (jd) }`. Used by
solar, core.

- `solveKepler`: the eccentric anomaly by Newton's method, started at π for e ≥ 0.8 so it converges up to e → 1.
- `positionAt`: position at a Julian Date. `orbitPoint`: position at an eccentric anomaly.
- `orbitPath`: the whole ellipse as one flat typed array of points, evenly spaced in eccentric anomaly.
- `meanMotion`, `periodDays`, `wrap2pi`, `TWO_PI`, `GAUSS_DEG_PER_DAY`.

### `planets.js`

The eight planets from JPL's "approximate positions" elements (E. M. Standish, valid 1800 to 2050) and the Moon from
Paul Schlyter's elements with the main perturbations. Heliocentric (the Moon geocentric) ecliptic J2000 in AU. Used by
globe, solar, core.

- `planetPosition`, `planetElements`, `planetLongitude`: a planet's position, elements and heliocentric longitude.
- `earthPosition`: Earth's **centre**, not the Earth-Moon barycentre (about 4,700 km away), using `MOON_MASS_FRACTION`.
- `moonGeocentric`: the Moon (Schlyter's elements plus the largest longitude, latitude and distance terms).
- `planetSpread`: the smallest arc holding all eight planets seen from the Sun ("Next planetary alignment").
- `PLANET_KEYS`, `VALID_JD`, `PHYSICAL` (mean radius and flattening).

Tested against JPL Horizons: planets within arcminutes, the Moon within about 0.3°.

### `moons.js`

The 20 major moons from Mars to Pluto: planet-centred orbits fitted to JPL Horizons over 2026 (`data/solar/moons.json`,
made by `brand/tools/make_moons.py`), with linear rates for the mean longitude, node and periapsis. Good to about a
degree for a few years around 2026. Used by solar, core.

- `moonOffset`: a moon's planet-centred position at a Julian Date (AU, ecliptic J2000).
- `moonPeriod`: its sidereal period in days.

### `smallbodies.js`

The packed asteroid format written by `brand/tools/make_small_bodies.py`: 15 bytes per object, column-major (Float32 a,
Uint16 e, i, node, peri, M0, Uint8 class), all propagated to one common epoch. The Solar System view solves Kepler's
equation for each point in a shader; this module decodes the same way on the CPU. Used by solar.

- `viewSmallBodies`: typed-array views over one packed file (no copies). `RECORD_BYTES`, `DEFAULT_EPOCH`.
- `decodeElements`: one record's elements, decoded exactly as the shader decodes them.
- `cometElements`: a comet row from `small_bodies.json` as elements. `packSmallBodies`: elements back into the format.
- `CLASSES`: Main belt, Near-Earth asteroids, Jupiter Trojans, Centaurs, Kuiper belt & beyond, Mars-crossers, Other.

### `comets.js`

Comets on any conic (ellipse, parabola, hyperbola) from JPL's perihelion elements, the names people know them by, and
their two tails: the ion tail along the solar wind and the curved dust tail. Used by solar, core.

- `cometFromRow`: a `small_bodies.json` row to elements. `cometPosition`, `cometVelocity`: where it is and how it moves
  (`solveHyperbolic`, `solveBarker`, `conicInPlane` for the open orbits). `stateToConic`: the orbit through a position
  and velocity.
- `cometNames`, `COMET_NICKNAMES`, `COMET_FACTS`: designations, common names and why some are famous. `cometClass`,
  `cometPeriodYears`.
- `ionTail`, `dustTail`, `dustDays`, `activity`: the tails, longer nearer the Sun (illustrative lengths, true
  directions).
- `cometsNearNow`: the comets best placed near the Sun and Earth. `perihelionPassages`: perihelion dates in a span.
  `conicArc`: a drawable stretch of an open orbit. `GM_SUN`, `SOLAR_WIND_AU_DAY`.
- Brightness from SBDB's M1/K1 (the same formula as Horizons' T-mag, checked against it): `cometMagnitude`,
  `cometMagnitudeAt`, `cometPeak` (the brightest moment in a span), `brightComets` (brightest now, with each one's peak),
  `cometsComing` (due to peak brighter than a magnitude), `seeingWords` ("binoculars"). `orbitFresh`: whether two-body
  motion from the comet's last orbit solution can be trusted yet (16P's 2016 elements are 1.5 AU off by 2026).

### `craft.js`

Deep-space missions from `data/solar/spacecraft.json` (JPL Horizons): where a craft is at any moment (a cubic through
the samples), how fast, what its mission does next, and how long its signal takes to reach Earth. Used by solar, core.

- `trackPosition`, `trackSpeed`, `sampleIndex`: position, speed and the sample reached.
- `missionPhase`: before launch, flying, coasting out past the published track, or beyond the data. `escaping`,
  `lastVelocity`.
- `eventsAround`: the last and next mission event. `missionDays`, `relativeTime` ("in 3 days", "5 hours ago").
- `missionsNow`: one line per mission, nearest Earth first (the "Deep-space missions now" list). `lightSeconds`.
- `lagrangeL1L2`: the Sun-Earth L1 and L2 points for Earth's position (`EARTH_MOON_MU`). `craftAliases`: search words.
- A craft in orbit around a planet (Juno): `track.local` holds Horizons' osculating elements around it, daily and every
  30 minutes for 3 hours around each perijove. `trackPosition(c, jd, out, centerAt)` puts the craft on that orbit
  around the planet as the caller draws it (within 150 km of Horizons through a perijove); `localPosition`,
  `localOrbit` (the set in force, never carried across a perijove), `inLocal`, `periapses` (the perijove times).

### `accuracy.js`

Errors against JPL Horizons, measured with the same code the views run. Used by solar (the "Under the hood" panel loads
the reference file and measures live in the browser) and by the tests (the thresholds).

- `measureAgainstHorizons`: `{ name, what, deg, km }` for the planets, Earth's centre, the Moon and more.

## Satellites

### `tle.js`

Satellite element sets for every view: where to get them, how long to keep them, how to read them. On the website the
site's own copy (`data/tle/<group>.txt`, refreshed every 6 hours by the build) is read first, so visitors never ask
CelesTrak. Used by globe, map, sky, mcp.

- `createTleSource`: a source that tries the copy and CelesTrak in the right order, with a 2-hour cache (`CACHE_MS`).
- `parseTle`: three-line or bare two-line text → `[{ id, name, l1, l2 }]`. `looksLikeTle` checks text first.
- `tleEpochJd`: a TLE's epoch as a Julian Date.
- `celestrakUrl`, `mirrorUrl`, `TLE_MIRROR`.

### `passes.js`

Satellite passes over an observer: rise, peak and set, look angles, and whether you could see it (the satellite in
sunlight while your sky is dark). The caller supplies the satellite's Earth-fixed position at any time (SGP4) and the
Sun's direction, so the module needs no orbit library. Used by globe, mcp, core.

- `findPasses`: passes in a time window, each `{ rise, peak, set, maxEl, azRise, azPeak, azSet, visible }`.
  `nextPass`: the next one within some hours. `ecfAt`: a satellite.js record as an Earth-fixed position function
  (shared by the 2D map, Tonight and the MCP server).
- `lookAngles`: elevation and azimuth of an Earth-fixed point from an observer.
- `sunlit`: is a point in sunlight (cylindrical shadow)? `compass`: a bearing as a compass point.

### `observer.js`

An observer on the WGS84 ellipsoid in Earth-fixed coordinates, and the Sun's direction in the same frame, without
Cesium: what `passes.js` needs on a page with no 3D globe. Used by globe, sky, mcp.

- `observer`: `{ pos, east, north, up }` for a latitude, longitude and height.
- `sunEcef`: the unit vector toward the Sun, Earth-fixed, at a time.

### `socrates.js`

Close approaches between objects in orbit from CelesTrak SOCRATES (conjunctions within 5 km over the next 7 days). The
site build keeps the closest upcoming ones in `data/socrates.json`, which the globe's "Near misses" reads directly; this
module parses the raw CSV for the tests.

- `parseSocrates`: CSV → `{ a, b, tca, rangeKm, speedKmS, maxProb }`.
- `upcoming`: the ones still ahead, closest first. `csvFields`: one RFC 4180 CSV line.

### `explain.js`

"What am I looking at?": one friendly sentence for a satellite card. Used by globe.

- `explainSat`: a sentence from a satellite's name, layer and orbit (height, period).
- `oceanAt`: which ocean or sea a point is over, roughly ("the ISS is over the Pacific").

## The night sky

### `sky.js`

Your sky tonight in plain words: where the Sun, Moon and planets are for someone on the ground, the Moon's phase, which
planets are worth stepping outside for, the aurora chance, passes as sentences, Starlink trains and meetings in the
sky. Accuracy is "where to look" (a degree or so). Used by globe, sky, mcp, core.

- `bodyRaDec`, `altAz`, `gmst`, `sunAlt`: positions in the sky.
- `darkWindow`: the dark part of the next 24 hours (Sun below −6°). `riseSet`: rise and set times for the Sun, the Moon
  and twilight.
- `moonPhase`, `nextFullMoon` (with its traditional name and whether it is a supermoon).
- `planetsTonight`: the bright planets during the dark hours, with a sentence each.
- `auroraAt`: the aurora chance overhead and on the horizon from NOAA's OVATION grid.
- `describePass`: a pass as a sentence. `starlinkTrains`: recent Starlink launches still flying low as a train.
- `meetings`: the Moon within 5° of a bright planet, two planets within 3°, over the next days.
- `craftAt`: a spacecraft from `data/solar/spacecraft.json` at a Julian Date (through `craft.js`). `separation`: the angle between two
  directions.

### `skyfacts.js`

What you are looking at in look-up mode, in a sentence or two: distance and light travel time. Used by globe.

- `bodyFact`: a planet or the Moon at a Julian Date. `starFact`: a bright star ("the light reaching your eyes left
  Vega in 2001"), with distances in `STAR_LY`.

### `skyplace.js`

Where something in the Solar System appears in Earth's sky: its direction, its angle from the Sun, whether that means
the evening or the morning sky, and the constellation figure nearest it. Used by solar.

- `skyPosition`: RA/Dec, distance from Earth, elongation and side for a heliocentric position. `raDecOf`.
- `skyPhrase`: when to look, in words. `nearestConstellation`: the nearest stick figure. `angularSep`,
  `formatRaDec`.

### `solarsys.js`

The planets as seen from Earth, in the numbers people use: distance and light time, elongation and evening or morning
side, how much is lit, visual magnitude (Meeus), and the next oppositions, conjunctions and greatest elongations. Used
by mcp (its `solar_system` tool).

- `planetFromEarth`, `moonFromEarth`: one body from Earth at a Julian Date. `SKY_PLANETS`.
- `magnitude`, `saturnRingTilt`: brightness. `skyEvents`: the coming events. `visibility`: how easy it is to see, in a
  phrase.

### `meteors.js`

The major annual meteor showers (IMO working list) and how many you could really see: the radiant's height and the
Moon cut the rate. Used by globe, mcp.

- `SHOWERS`: name, peak, activity, radiant, ZHR, speed and parent body.
- `showersFor`: active or coming showers for a place and night, with an honest rate, sorted by peak.
- `activeShowers`: showers active at a moment (for marking radiants in look-up mode).

### `clouds.js`

"Will it be clear tonight?" from an Open-Meteo hourly forecast. Used by globe.

- `hoursOf`: the forecast's hourly rows. `cloudAt`: the cloud cover at a moment.
- `night`: the dark hours in words, with the clear spells. `sky`: a word for a cloud cover.

### `eclipse.js`

Solar eclipse geometry: the Moon's shadow cones, where they meet the WGS84 ellipsoid, the shadow's outline, and how
much of the Sun is covered from a place. One Earth-centred frame in km (the globe turns Horizons' vectors Earth-fixed
with Cesium). Used by globe, sky, solar (the Moon's shadow cones), core.

- `cones`, `radiiAt`: the umbra and penumbra.
- `shadowCenter`: where the shadow axis meets the Earth, and whether it is total or annular there.
- `outline`: a shadow's outline on the ground. `rayEllipsoid`: a ray meeting the ellipsoid.
- `seenFrom`: what an observer sees: the Sun's and Moon's sizes, separation and covered fraction (`overlapFraction`).
- `interp`: interpolation in the per-minute Horizons table. `R_SUN`, `WGS84`.

### `eclipselocal.js`

Solar eclipses on the ground without Cesium: JPL Horizons' Sun and Moon (`data/eclipses.json`) turned Earth-fixed with
IAU 1976 precession, the main nutation terms and apparent sidereal time (about 1 km on the ground), then `eclipse.js`'s
cones. Used by mcp (its `eclipses` tool), core (`syzygy.js`).

- `greatestEclipse`: each eclipse's greatest point, kind, central duration and path width.
- `localEclipse`: what a place sees: contacts, how much of the Sun is covered, the kind at maximum.
- `prepareEclipse`, `icrfToFixed`, `ecef`, `geodetic`: the frames.

### `syzygy.js`

Eclipses (solar and lunar) and lunar occultations of bright stars and planets, 2026-2030, found from JPL Horizons' Sun
and Moon (`data/solar/ephem.json`, Chebyshev fits by `brand/tools/make_ephem.py`, within 3 m and 1 km of Horizons).
Solar eclipses use `eclipse.js`'s cones and `eclipselocal.js`'s Earth-fixed turn; lunar eclipses Danjon's shadow
(NASA's canon: every 2026-2030 eclipse within 2 minutes and 0.01 in magnitude). Used by solar.

- `createEphemeris`, `chebEval`: the Sun and Moon, geocentric, ecliptic J2000, km, at a UT Julian Date.
- `lunations`: new and full Moons. `elongationLon`.
- `solarEclipse`, `lunarEclipse`, `findEclipses`: kind, greatest moment, gamma, magnitude, contacts, durations, where.
  `earthShadow`: Earth's umbra and penumbra at the Moon (`DANJON`).
- `findOccultations`, `occultationGeometry`, `planetGeocentric`: the Moon in front of `OCCULT_STARS` (Aldebaran,
  Regulus, Spica, Antares, the Pleiades) and `OCCULT_PLANETS`, where on Earth it is seen and whether it is dark there.
- `subPoint`, `toFixed`: ground points under a direction. `minimize`, `root`: the small searches. `eventTitle`, `R_EARTH`.

### `orientation.js`

A phone's orientation (W3C DeviceOrientation) to where the back camera looks and which way is up on the screen, in
east-north-up components: look-up mode. Used by globe.

- `deviceVectors`: alpha, beta, gamma and the screen angle → view direction and screen-up.
- `alphaFromCompass`: iOS's relative alpha plus `webkitCompassHeading` → an absolute alpha.
- `azEl`: azimuth and elevation of a direction. `guide`: "turn right 32°, up 11°" toward a target.

## Geometry on the Earth

### `geo.js`

Spherical-Earth geodesy for things that move (aircraft dead reckoning, ship tracks). Used by globe, mcp, core.

- `haversine`: great-circle distance in metres. `destination`: the point reached along a bearing.
- `deadReckon`: where a moving object is some seconds after its last fix. `deadReckonArc`: the same through a turn,
  for an aircraft that was turning between its last two fixes.
- `courseAxis`: the unit vector along a course, which Cesium uses to point an icon. `EARTH_RADIUS_M`.

### `measure.js`

Draw and measure on the WGS84 ellipsoid. Distances by Vincenty's formulae (within a millimetre of GeographicLib), with a
bisection near the antipode where Vincenty's iteration fails; areas on the authalic sphere after splitting each edge
every 20 km. Used by globe, core.

- `inverse`: distance and bearings between two points. `direct`: where a path on a bearing ends. `bisect`: the
  near-antipodal case.
- `pathLength`, `densify`, `midpoint`, `centre`, `selfCrossing`: paths and rings.
- `polygonArea`, `multiPolygonArea`: areas and perimeters (`AUTHALIC_R`, `EARTH_AREA`).
- `groundProfile`: a path's length over the hills, with the climb and descent.
- `lengthText`, `areaText`, `bearingText` and their spoken forms `lengthWords`, `areaWords`, `bearingWords`; metric or
  imperial.
- `toGeoJSON`: a drawing as GeoJSON (RFC 7946).
- `encodeDrawing`, `decodeDrawing`: the drawing in a share link (`&d=`, see [LINK_FORMAT.md](LINK_FORMAT.md)).
- `choosePair`: which two places "from A to B" means, from two lists of candidates.
- `WGS84`, `MAX_POINTS` (512).

### `borders.js`

Which country is at a point: plain geometry on the simplified borders in `data/borders.json`. Used by globe, sky.

- `prepare`: add the bounding boxes the lookups use (once, after loading).
- `countryAt`: the border record at a point, or null at sea. `inCountry`: is a point inside one country?
- `mainBox`: the biggest part's box, so a far island doesn't drag a fly-to off the mainland. `inRing`, `boxOf`.

### `mgrs.js`

Military Grid Reference System references for the tactical HUD: UTM by the Krüger series with the Norway and Svalbard
exceptions. Null outside 80°S to 84°N (where MGRS uses the polar UPS grid). Used by globe.

- `toMgrs`: "18S UJ 23487 06483" at 1, 10 or 100 m precision. `toUtm`, `utmZone`.

### `route.js`

Routes for Directions: OSRM steps as plain-English instructions, and a point along a polyline for the "fly it" camera.
Used by globe.

- `instruction`: one OSRM step as "Turn left onto Strand". `distanceText`, `durationText`.
- `measure`: a polyline with cumulative distances. `pointAt`: the point at a distance along it.
- `bearing`, `haversine`, `compass`.

### `campose.js`

Where a public traffic camera looks, as a best guess, and what it sees: a calibrated pose first, else the feed's own
words ("West", "Zoom north"), else the road it stands on. Used by globe.

- `estimatePose`: the pose guess for a camera. `bearingFromText`: a compass bearing from a feed's words.
- `alongRoad`, `roadBearings`: headings from nearby OpenStreetMap roads. `angleDiff`.
- `enuDir`, `axes`, `cornerRays`, `footprint`: the camera's view geometry and the patch of ground it sees.
- `PRESETS`: a typical mount (height, tilt, field of view) per camera network.

## Launches and people in space

### `launches.js`

Rocket launches from Launch Library 2, one mapping for the site build's copy (`data/launches.json`) and the live API.
Used by globe, sky, mcp.

- `fromLL2`: one launch (any response mode) → `{ id, name, mission, orbit, rocket, provider, net, windowStart,
  windowEnd, precision, status, … }`.
- `when`: how sure the time is, in words. `countdown`: "T-2 d 04:10:22".
- `upcoming`: upcoming first; a launch stays listed for 2 hours after its time.

### `ascent.js`

A reconstructed rocket ascent from what a listing says (the pad and the target orbit). Not telemetry: a generic
two-stage climb along the launch azimuth that reaches the target inclination. Used by globe.

- `ascentProfile`: a profile for a launch. `sample`: where the rocket is t seconds after lift-off. `eventAt`: the latest
  event ("Max Q (approx.)") by then; `EVENTS`, `T_ORBIT`.
- `target`: inclination and height for an orbit name. `azimuth`: the launch azimuth for an inclination. `travel`: a
  point along a great circle.

### `crew.js`

Who is in space right now, from Launch Library 2's astronauts. Which station each person is on isn't in the list, so it
is inferred (China's crews: Tiangong; others: the ISS). Used by globe, mcp.

- `fromLL2Astronaut`: one astronaut → `{ name, agency, countries, flag, days, since, human, wiki }`.
- `whoIsUp`: people grouped by station. `crewSentence`: "10 people are in space right now: …". `durationDays`.

## Weather

### `gfs.js`

NOAA's GFS model on AWS (keyless, CORS, byte ranges): which run to read, its files, the fields the globe draws, how a
moment between two forecast hours blends them, and the weather timeline's moments. Used by globe, core.

- `gfsCycles`, `cycleAt`, `gfsFile`: runs and files. `GFS_BUCKET`, `FIELDS`, `PARAM`.
- `bracket`: the two forecast hours around a moment and the blend weight.
- `timeline`: the observed frames then the forecast moments. `relTime`: "-2 h 30 min", "now", "+3 h".
- `windFrom`: u and v → speed and the direction it blows from. `compass`: a bearing in words.

### `grib2.js`

GRIB2, just enough for the model fields the globe draws: NOAA's GFS and ECMWF's IFS on their regular grids, packed
simply, with complex packing and spatial differencing (as NCEP writes it), as JPEG 2000 (NOAA's WAVEWATCH III, through
`jpx.js`) or CCSDS (ECMWF's open data, through `aec.js`); plus NOAA's `.idx` inventories so a browser fetches only the
fields it wants. Matched to eccodes. Used by globe, core.

- `decodeGrib2`: every message in a buffer → its parameter, forecast hour, grid and a `Float32Array` of values.
  `sampleGrid`: a value at a point, bilinear, wrapping in longitude.
- `parseIdx`: an inventory → byte offsets. `idxRanges`: byte ranges for wanted fields, neighbours merged.

### `wxmodels.js`

The weather models the globe reads straight from their open buckets (keyless, CORS, byte ranges): NOAA's GFS (1°, with
WAVEWATCH III waves at 0.25°) and ECMWF's IFS (0.25°, with its wave model; CC BY 4.0). Which runs exist when, a
forecast hour's files and inventories, and which GRIB2 parameters are which field. Used by globe.

- `MODELS`, `PARTS`, `partsOf`: what each model's files call the fields the globe draws.
- `ecmwfCycles`, `ecmwfFile`, `parseEcIndex`, `ECMWF_BUCKET`: ECMWF's runs, files and JSON inventories.
- `gfsWaveFile`: the WAVEWATCH III file of a GFS run. `paramKey`: a GRIB2 parameter to our field.
- `bracketFor`: the forecast hours either side of a moment. `runWords`: "the 12:00 UTC run of 11/10".

### `aec.js`

CCSDS 121.0 lossless decompression (adaptive entropy coding, the Rice coder libaec implements), as GRIB2 data template
5.42 uses it: ECMWF writes its open data this way. Checked against eccodes on a real IFS field. Used by core
(`grib2.js`).

- `aecDecode`: n samples of a given bit width from the bytes. `AEC`: the option flags.
- `aecEncode`: a simple encoder for the tests (not used by the site).

### `jpx.js`

JPEG 2000 codestreams, just enough for GRIB2 data template 5.40 (one grey component), as NOAA's WAVEWATCH III files are
packed. Checked against eccodes on real wave fields. Used by core (`grib2.js`).

- `jpxDecode`: a codestream to `{ width, height, data }`. `decodeBlock`, `synth`: a code block and the inverse wavelet
  step.

### `fields.js`

Model fields on regular latitude/longitude grids, the shape `grib2.js` decodes into: coarsening (a 0.25° global field is
a million values), blending two forecast hours, and sampling that copes with coasts (wave fields are empty over land)
and directions (350° and 10° average to north). Used by globe, core.

- `coarsen`, `blend`, `sampleAt`: smaller fields and moments between forecast hours.
- `sampleValid`: bilinear sampling that skips missing corners. `sampleAngle`, `blendAngle`: directions.
- `wraps`, `rowLat`: grid geometry.

### `contour.js`

Isobars and pressure centres: marching squares over a model grid, joined into lines that carry on across the date
line, and the highs and lows that stand out. Used by globe (the pressure layer).

- `levels`: contour levels every step from a base (isobars every 4 hPa run 996, 1000, 1004…). `isolines`: the lines.
- `extrema`: highs and lows, strongest first. `labelSpots`: where to write a line's value.

## Hazards and imagery

### `hazards.js`

Tropical cyclone forecasts, wildfires and recent satellite pictures, parsed. Used by globe.

- `nhcForecasts`: NOAA NHC's map service → cones, tracks, watches and warnings, wind fields; `coherent` only when they
  all come from the same advisory (`stormKey`, `WW`).
- `gdacsForecast`: GDACS cones and tracks for every other basin.
- `firePerimeters`: NIFC perimeters. `parseFires`, `fireTilesFor`, `fireTileDeg`: VIIRS hot spots from GIBS vector tiles.
- `parseCmrCsv`, `imageryDates`, `pickPair`: Landsat and Sentinel-2 picture dates and the first before/after pair;
  `IMAGERY`, `gibsTemplate` for the tiles.
- `rings`, `paths`, `csvLine`: GeoJSON and CSV helpers.

### `quakes.js`

Earthquakes from the USGS real-time GeoJSON summaries: one parser for the 2D map, the globe and the MCP server. Used by
globe, map, mcp.

- `parseUsgs`: a summary → quakes. `usgsUrl`, `usgsFeedFor`, `USGS_FEEDS`, `USGS_BASE`: which summary to read.
- `largest`, `quakeTitle`: "M6.2 · 34 km SW of Town".

### `eonet.js`

NASA EONET (open wildfires, storms, volcanoes, floods, ice…): one parser for the 2D map, the globe's cyclones and the
MCP server. Used by map, mcp, core.

- `parseEonet`: an answer → events with their newest position. `eonetUrl`, `EONET_CATS`, `EONET_COLOR`, `newestFirst`.

### `cyclones.js`

Tropical cyclones assembled once for every view: EONET tracks, NOAA NHC advisories (through a relay), NOAA's map
service (forecast cones, watches, wind fields) and GDACS for every other basin. Fetching is injected, so the globe, the
2D map and the tests share the whole recipe. Used by globe, map, mcp, core.

- `loadCyclones`: every source, merged (`stormsFromEonet`, `mergeNhc`, `mergeNoaa`, `mergeGdacs`, `attach`).
- `parseNhcCurrent`, `parseGdacsCyclones`: the sources' lists. `noaaLayerUrl`, `gdacsTcUrl`, `gdacsGeometryUrl`.
- `category`, `catName`, `CYCLONE_CAT`, `NHC_CLASS`: Saffir-Simpson and NHC's codes. `activeLine`, `shortName`,
  `stormSources`: words for labels and cards.

### `gdacs.js`

The GDACS disaster alert list behind the 2D map's "Disaster alerts" layer. Used by map.

- `loadGdacsEvents`: every page of the last days. `parseGdacsEvents`, `gdacsEventsUrl`, `GDACS_TYPES`,
  `GDACS_LEVEL_COLOR`.

### `aurora.js`

The aurora oval from NOAA SWPC's OVATION model: one grid and one colour ramp for the 2D map's overlay and the globe's
layer. Pictures are RGBA arrays the views put on a canvas. Used by globe, map.

- `parseOvation`, `ovationAt`: the grid and the chance over a place. `latestKp`: the K-index.
- `paintEquirect`, `paintMercator`: the grid as a picture for the globe or the map. `auroraColor`, `auroraAlpha`,
  `AURORA_STOPS`.

### `fireclusters.js`

Fire detections in an area made answerable: the GIBS tiles that cover it, and hot pixels grouped into fires (within
about 2.5 km of each other), each with size, power and last sighting. Used by mcp (its `wildfires` tool).

- `fireTilesAround`, `clusterFires`, `fireWords`, `perimeterRows`.

### `fires.worker.js`

A Web Worker (no exports) shared by the globe and the 2D map: it fetches a GIBS VIIRS thermal-anomaly vector tile,
unzips and decodes it, and posts back the detections since a time, off the main thread.

### `earthnow.js`

"Earth now": the sums and small charts behind the globe's dashboard (`src/globe/now.js`), from parsed feeds the other
modules produce (quakes, cyclones, EONET wildfires, launches, Kp rows, flybys, model fields). Pure: no fetching, and the
charts are SVG text. Used by globe. Tests: `test/earthnow.test.mjs` (a captured USGS week, NOAA's Kp product checked
against SWPC's own G-scale labels, EONET wildfires).

- `summarizeQuakes`: count, strongest, newest, M4.5+ and M6+ counts, tsunami flags, the busiest regions; `quakeRegion`
  turns a USGS place into a region ("5 km W of Cobb, CA" → California); `quakeClass` names a magnitude.
- `dailyCounts`: items per UTC day for the last N days (today flagged partial); `utcDayStart`.
- `KP_FORECAST_URL`, `kpSeries` (NOAA's Kp products, both shapes, observed / estimated / predicted), `kpSummary`,
  `kpLevel` (NOAA's G scale: Kp 5- (4.67) is G1, as SWPC marks it), `auroraReach`.
- `summarizeStorms`, `summarizeWildfires` (prescribed burns apart: `prescribed`, `wildfireRegion`),
  `launchesSoon`, `launchesToday`, `launchesByMonth` (months the list can't fill are flagged partial),
  `summarizeFlybys`.
- `fieldExtremes`, `windiest`, `weatherExtremes`: the highest, lowest and windiest grid points of a model field, with
  where they are; `tempWords`, `windWords`, `latLonWords`.
- `barsSvg`: an accessible, theme-aware bar chart as SVG markup (a title, a description listing every value, a tooltip
  per bar, `currentColor` bars, CSS-variable text); `quakeChart`, `kpChart`, `launchChart` build on it.

## Aviation

### `aircraft.js`

Aircraft records from the two kinds of feed both views read: readsb-style JSON (adsb.lol, adsb.fi, airplanes.live) and
OpenSky's state vectors, in the feeds' own units plus SI. Used by globe, map.

- `readsb`, `openskyState`: one record each. `cleanHex`, `EMERGENCY_SQUAWKS`, `FT`.

### `actype.js`

What kind of aircraft a record is (from its ICAO type designator, else the emitter category, else adsbdb's type text),
adsbdb answers read into one record, whether a route on file fits where the plane actually is, and the country an ICAO
address belongs to. Used by globe, core.

- `classify`, `shapeOf`, `CLASSES`: the class and the 3D model drawn for it.
- `parseAdsbdb`: an adsbdb answer → `{ aircraft, route }`. `routeFit`: does the route fit the plane? `gcKm`, `bearing`.
- `hexCountry`: where an address was allocated. `classWord`, `typeMatcher`: search by kind or type ("helicopters",
  "747").

### `phase.js`

What a plane is doing, in a pilot's words (parked, taxiing, take-off, climbing, cruise, descending, approach, final,
landing roll), from its own fix and the nearest airport. Used by globe.

- `flightPhase`: `{ phase, words, agl, apKm }`. `PHASES`. `greatCircle`: points along a great circle (the route arc).

### `airports.js`

Airport boards made from the live aircraft already on the globe, not from schedules: near an airport, a plane low and
descending towards it is arriving, one climbing away is departing, one on the ground is at the gate or taxiing; a route
on file makes the call firmer. Used by globe.

- `parseAirports`, `AirportIndex`, `findAirport`: the OurAirports list, nearest and in view, by code, name or city.
- `makeBoard`, `boardStatus`, `BOARD`: the board. `recentMove`: planes that just landed or took off. `etaText`.

### `runways.js`

Runways from OurAirports (`data/runways.json`): the wind along and across each runway end, the runway a plane is lined
up with, and the runway in use. Used by globe.

- `parseRunways`, `windOn`, `windTable`, `linedUp`, `finalFor`, `runwayInUse`.

### `aloft.js`

Weather at an aircraft for the cockpit HUD, from Open-Meteo's pressure levels: wind, temperature and cloud at its
height, head and cross wind, true airspeed and Mach, the deviation from the standard atmosphere, an icing hint; and the
weather and VFR/IFR category at an airport. Used by globe.

- `aloftUrl`, `parseAloft`, `aloftEffects`, `aloftLines`, `bracket`, `LEVELS`: the cockpit.
- `isaPressure`, `isaAltitude`, `isaTempC`: the standard atmosphere.
- `airportWxUrl`, `airportWx`, `airportWxLine`, `flightCategory`, `oktas`, `weatherWords`: airport cards.

### `trail.js`

Flight trails: the last minutes of a plane's fixes, thinned in 3D (Douglas-Peucker) and coloured by altitude. Used by
globe.

- `Trail`: one aircraft's trail. `thin`, `flatM`: thinning. `altColor`, `altRampCss`: the colour ramp.
- `trailStats`, `trailGeoJSON`: the numbers for the card, and the trail as GeoJSON with times.

## Things that move

### `flight.js`

What someone types to find a plane, turned into what the feeds know: "BA 123" on a ticket is "BAW123" on the
transponder. Also a callsign, an ICAO hex address or a registration. Used by globe.

- `parseFlightQuery`: a query → `{ callsigns, hex, reg, label }`, or null. `matchesFlight`: does a feed record match?
- `normCallsign`: upper case, no spaces, no leading zeros. `AIRLINES`: IATA → ICAO for common airlines.

### `ais.js`

Ships from AIS: Fintraffic Digitraffic's positions and ship details, AIS codes in words, and where a ship is between
reports. Used by globe, mcp.

- `parseAisLocations`, `parseAisVessels`: the feed's answers; "not available" codes become null.
- `shipAt`: a ship's position now, along its course and through the turn it reports. `underway`.
- `shipKind`, `SHIP_KINDS`, `shipTypeName`, `NAV_STATUS`, `flagOf`, `rotDegPerSec`, `etaParts`, `etaTime`: codes in
  words (an AIS ETA has no year).

### `transit.js`

Live transit: parsers for MBTA, Entur and HSL, a minimal MQTT 3.1.1 codec for HSL's WebSocket broker, the GTFS-RT
agencies, and the motion model that turns a fix every few seconds into steady movement. Used by globe.

- `parseMbta`, `parseEntur` (with `enturQuery`), `parseHfp`, `fromGtfsRt`: fixes from each source. `mqtt`: the codec.
- `addFix`, `sample`, `ease`, `approach`, `lagMeter`: playback a little behind live, between real reports.
- `inArea`: inside a circle or box.

### `transitfeeds.js`

Live transit feeds shared by the globe and the 2D map: which operators, where, how often, and the loops that run them
(polling, and HSL's MQTT stream over a WebSocket). Fetch and WebSocket are injected. Used by globe, map, mcp.

- `transitSources`, `TRANSIT_AREAS`, `sourcesAt`: the operators and where each runs. `enturBox`, `capmetroFile`.
- `startSource`, `startPoll`, `startHsl`, `stopSource`: running them. `createFleet`: vehicles appearing and going.
- `transitTip`, `transitRows`, `lateness`, `TRANSIT_MODES`: words for tips and cards.

### `gtfsrt.js`

GTFS Realtime vehicle positions, read with the protobuf reader from `mvt.js`. Used by globe, core.

- `parseVehiclePositions`: a feed → vehicles. `encodeVehiclePositions`: writes one (for tests).
- `GTFS_STATUS`, `GTFS_OCCUPANCY`: codes in words.

### `bikes.js`

Bike share: the CityBikes directory (about 800 systems) and a system's stations. Used by globe, mcp.

- `parseNetworks`, `parseStations`: the API's answers. `networksNear`: systems near a point.
- `stationState`: offline, empty, low, full or ok. `cbTime`: CityBikes' unusual timestamps.

### `cameras.js`

Public traffic and weather cameras: every agency network the 2D map and the globe show, as one table (where its list
is, the box it covers, its credit, a parser). Used by globe, map, mcp.

- `CAMERA_NETS`, `CAMERA_GROUPS`, `netOf`, `CALTRANS_DISTRICTS`: the networks. `parseSingapore`, `xmlText`.
- `camNetsNear`, `camsNear`, `camCoverage`: cameras near a place. `boxInView`, `bustUrl`, `isStream`, `imageType`.

### `cables.js`

Submarine cables and landing stations (TeleGeography's map data): where to get them, the cable under the pointer, and
what comes ashore or runs near a place. Used by map, mcp.

- `CABLE_URLS`, `LANDING_URLS`: live data (through a relay) then an older copy. `parseCables`, `parseLandings`,
  `parseCable`, `parseLanding`.
- `nearestCable`, `nearestOnLines`, `cablesNear`, `landingsNear`.

### `mvt.js`

Mapbox Vector Tiles: a small decoder for the layers you ask for, protocol buffers by hand. Used by globe, core.

- `decodeTile`: named layers → features with geometry in tile units. `geometry`: the drawing commands.
- `Pbf`: the protobuf reader (also used by `gtfsrt.js`). `tileAt`, `unproject`: Web Mercator tiles.

### `roadtiles.js`

Roads from vector tiles (OpenFreeMap's OpenMapTiles schema) as ways for the traffic graph: each line clipped to its
tile and joined to its neighbour across the edge; junctions where lines share a vertex. Used by globe.

- `prepareTile`: one tile, ready to join. `joinTiles`: tiles → `{ ways, signals }`. `clip`, `nodeKey`.

### `traffic.js`

Simulated cars on real roads. No open feed says where individual cars are, so the cars are a simulation; where a city
publishes measured speeds and counts (NYC DOT, Fintraffic) they set the cars' speed and number. Used by globe.

- `buildGraph`: ways → a road graph with signals and the street grid's main bearing. `densify`: points along long
  segments so cars follow the ground.
- `Sim`: the simulation. `follow`: car following (a simplified IDM). `nextEdge`, `along`, `laneOffset`, `green`
  (`CYCLE`, `STOP_BACK`): driving, lanes and lights.
- `busyness`, `localTime`, `expected`: how busy roads are by type and local hour, or from a measured count.
- `parseNyc`, `linkPoints`, `zonedToUtc`, `parseTms`, `matchSpeeds`: measured speeds and counts onto the roads.
- `ROAD`, `HIGHWAYS`, `LANE_W`, `maxspeed`, `drivesLeft`, `dist`, `bearing`, `turn`.

## OpenStreetMap

### `osmtiles.js`

OpenStreetMap layers from vector tiles, without the Overpass API: 3D buildings (OpenFreeMap's buildings with their
heights), military areas (land mapped as military, named from the military airfields inside) and licence-plate readers
(DeFlock / FlockHopper's hourly tiles, US and Canada). Used by globe, map, mcp.

- `tileBuildings`, `buildingTint`, `MAX_BUILDING_H`: buildings.
- `tileMilitary`, `joinPieces`, `describeArea`, `areaWords`: military areas joined across tiles.
- `tileCameras`, `cameraFacts`, `facings`, `readersAlong`, `makesWords`: plate readers (and those along a route).
- `polygons`, `clipRing`, `outlineRuns`, `tilesAround`, `tilesInBox`, `routeTiles`, `pickZoom`, `tileBounds`: tile
  geometry.

### `overpass.js`

One polite client for the public Overpass API, shared by every OpenStreetMap layer that still uses it and the 2D map's
area scan: one request at a time, a pause at least as long as the last request took, and the quickest server that is
answering. Used by globe, map.

- `overpass`: run a query. `overpassHealth`: how each server has been doing.

## Links, words and the interface

### `viewlink.js`

The share link: a view as a URL hash and back (full format in [LINK_FORMAT.md](LINK_FORMAT.md)). Used by globe, mcp.

- `encodeView`, `decodeView`: a view ↔ `c=…&l=…&…`. Nothing decoded is trusted.
- `zoomToHeight`, `heightToZoom`: the 2D map's zoom and the globe's camera height, so a link made on one opens the
  same area on the other. `MAP_TO_GLOBE`, `globeLayersFor`, `mapLayersFor`: the two views' layer ids.
- `decodeExtras`: the parts that work without a camera: the panel to open, a flight, an item id. `GO`: the panels a
  link may open.

### `solarlink.js`

The Solar System view as a link (`solar.html#f=…&t=…&d=…&r=…`, or `#q=…`; see [LINK_FORMAT.md](LINK_FORMAT.md)).
Nothing in a hash is trusted. Used by solar.

- `encodeSolarView`, `decodeSolarView`: a view to the hash and back.
- `isoMinute`, `parseIsoMinute`: Julian Dates and `YYYY-MM-DDTHH:MM` (UTC).

### `search.js`

The Solar System view's "Where is it now?" search: one ranked list over planets, moons, spacecraft, comets, named
asteroids, stars and other planetary systems. Exact names first, then prefixes, words, substrings and near-miss
spellings, then by kind and fame. Used by solar.

- `buildIndex`, `search`, `mergeResults`: index, query, and merge ranked lists.
- `matchScore`, `editDistance`, `normalize`, `kindRank`, `KIND_RANK`: the ranking.

### `scene.js`

Director scenes: camera shots to fly through, as compact text for links and files. Used by globe.

- `encodeScene`, `decodeScene`: shots ↔ the `#scene=` text. `cleanShot`: range-checks a shot. `MAX_SHOTS` (40).
- `parseSceneFile`, `sceneFile`: the `.oo-scene.json` file.

### `voicecmd.js`

Spoken commands without an AI service: a sentence in, one action out. Used by globe, mcp, core.

- `parse`: a sentence → `{ act, … }` (go, track, layer, view, sensor, measure, route, weather, count, an airport's
  board, what plane that is, trails, …). `normalize`
  strips the wake word, politeness and punctuation first.
- `EXAMPLES`: the phrases the help card suggests. `SENSORS`: the Ops looks.
- `skyWords`, `weatherSentence`, `seaWords`: weather readings in words (with gusts, pressure and its trend, and the sea
  state), metric or imperial.

### `format.js`

Human-readable numbers and safe HTML. Used by globe, map, solar.

- `esc`: escape text for HTML. `num`, `idArg`: values made safe for JavaScript inside an HTML attribute.
- `distance`, `viewWidth`, `lightTime`, `period`, `bigNumber`: distances in the unit people think in at that scale,
  light travel times, periods, big numbers in words.

### `ics.js`

A calendar file (iCalendar, RFC 5545) with a reminder: the one alert that reaches a phone with the site closed and no
server. Used by globe.

- `makeIcs`: events → the file's text.

### `radio.js`

The world radio layer's helpers. Used by globe.

- `cleanStations`: radio-browser.info rows → stations with real coordinates and an https stream, one per station, in the API's
  vote order.
  `tidyName`: keyword-stuffed names cut to their first clause.
- `tunerSet`, `dialPos`, `dialIndex`, `dLon`: the analog tuner's stations and dial.
- `httpUrl`, `httpsUrl`: only http(s) links and https streams get through.

## Network and devices

### `assets.js`

Fetch a data file, falling back to the published site: archived versions (`/v/<tag>/`) and partial checkouts don't
carry the big data files. Used by globe, solar, sky, core.

- `fetchAsset`: a path → an ArrayBuffer, JSON or text. `SITE`.

### `relay.js`

The public relay for the published website (`relay/worker.js`, a Cloudflare Worker) and the hosts it carries. Used by
globe, map.

- `PUBLIC_RELAY`, `PUBLIC_RELAY_HOSTS`: the Worker's address and its allowlist (= the Worker's `TTL` table).
- `onPublishedSite`: true on the published site (the relay answers only that origin).

### `gpu.js`

GPU checks shared by the 3D views; the caller passes the WebGL context. Used by globe, solar.

- `isSoftwareRenderer`: true when WebGL runs in software (every 3D view then crawls). `rendererName`. `SOFTWARE_HINT`.

## The app shell

### `pwa.js`

The installable app's decisions: whether a page may run the site's service worker (never in an archived `/v/<tag>/`
copy, on the local helper only with `?sw=1`), how to word the age of a saved copy, and when the first-run touch hints
are due. Used by app.

- `swDecision`, `swSwitch`, `isArchivedPath`, `isLocalHost`: the service worker.
- `ageWords`, `offlineWords`: the offline banner. `hintsDue`, `hintsSeen`, `isLongPress`, `HINT_KEY`, `HINT_PAGES`.

### `spot.js`

"This spot": what a long press on the globe or the 2D map shows: the coordinates in the usual ways, and a link that
opens the globe there with a pin. Used by app.

- `describeSpot`, `spotLink`, `decimal`, `dms`, `plain`, `wrapLon`.

### `a11ycheck.js`

A small accessibility check over a page's HTML (names, alt text, labels, ids, contrast of the page's own colour
tokens…): `test/a11y.test.mjs` runs it on every page, `brand/tools/a11y_check.mjs` from the command line. Used by tools.

- `checkHtml`: errors and warnings for a page. `parseHtml`, `parseAttrs`, `walk`, `textOf`, `contrast`, `luminance`,
  `rootTokens`.
