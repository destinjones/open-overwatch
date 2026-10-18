# Open Overwatch for Claude (MCP)

Ask Claude about the live Earth and get answers from public open data: earthquakes, where the ISS is and when you can
see it, rocket launches, who is in space, asteroid flybys, hurricanes, wildfires and eruptions, ships in the Baltic,
bike share, live buses and trains, traffic cameras (with the latest picture), undersea cables, a country at a glance,
the weather (down to pressure, gusts, waves and whether the forecast models agree), what a plane is and where a
flight goes, where any spacecraft, comet or asteroid is, the aurora, the planets and tonight's sky. Every answer carries a link that opens
[Open Overwatch](https://destinjones.github.io/open-overwatch/)'s live 3D globe on it, and in Claude Desktop (and other
apps that show MCP Apps) the globe appears right in the conversation and moves to each new answer.

No account, no API keys, no local web server. It is a small Model Context Protocol server that runs on your computer
(over stdio, or Streamable HTTP on your own machine) and reads the same public feeds the website does. It can also run
as a remote server on Cloudflare Workers for claude.ai and ChatGPT connectors ([below](#remote-claudeai-and-chatgpt-connectors)).

> "Any big earthquakes today? Show me the strongest." · "When can I see the ISS from Chicago this week?" ·
> "What's in the sky tonight over Austin?" · "Follow the ISS on the globe." · "Is there a hurricane near Mexico?" ·
> "Will I see the aurora in Minneapolis tonight?" · "Ships near Helsinki" · "Free bikes near the Eiffel Tower" ·
> "Show me the traffic camera at Trafalgar Square" · "Which trams are near Helsinki station?" · "Any fires burning
> in Northern Australia?" · "Brief me on Japan" · "Which undersea cables land in Marseille?" · "When is Jupiter at
> opposition, and can I see Saturn from Austin tonight?" · "Will I see the 2027 eclipse from Madrid?" · "How far is it
> from Big Ben to the Tower of London on foot?" · "Is Etna erupting?" · "How fast is traffic moving in Helsinki?" ·
> "Is a storm coming to the Azores? How big are the waves?" · "What plane is G-XLEA?" · "Where does BAW15 fly?" ·
> "Where is Voyager 1 right now?" · "Where is comet Halley, and when does it come back?"

## Install

**Claude Desktop (one click).** Download `open-overwatch.mcpb` from the
[latest release](https://github.com/destinjones/open-overwatch/releases/latest) and open it (or Settings → Extensions →
Install Extension). Claude Desktop runs it with its own Node.js.

**Claude Code, from this repository.** Needs Node.js 20 or newer.

```bash
git clone https://github.com/destinjones/open-overwatch.git
cd open-overwatch && npm install
claude mcp add open-overwatch -- node "$PWD/mcp/server.mjs"
```

**Any other MCP client** (Claude Desktop by hand, Codex, VS Code, Cursor…): run `node /path/to/open-overwatch/mcp/server.mjs`
over stdio, with an absolute path. For Claude Desktop, Settings → Developer → Edit Config:

```json
{ "mcpServers": { "open-overwatch": { "command": "node", "args": ["/path/to/open-overwatch/mcp/server.mjs"] } } }
```

Once it is on npm, `npx -y open-overwatch-mcp` will work anywhere a command is asked for, with no clone.

## Tools

Live answers carry a `provenance` line per item (or for the whole answer): which sources reported it, how many agree, how
old the data is and a confidence word (confirmed, reported, stale, unknown), the same line the globe's cards show
(src/core/liveprov.js).

The 38 tools below are what a local server lists. `earthquakes` asks a second catalogue, EMSC's (www.seismicportal.eu),
next to each USGS feed: a quake both list within 60 s, 100 km and 0.6 of a magnitude reads "confirmed" when EMSC's entry is
its own solution and both are fresh; an EMSC entry that republishes USGS's solution is listed as "EMSC (USGS solution)"
and does not count. EMSC's answer is
kept for 10 minutes; if EMSC fails or takes over 10 s, that feed's last EMSC list is used, else the answer is USGS's
alone. EMSC is asked for at most 500 events for a window of a day or less at M2.5 and up, and 1,000 for a longer window or a
lower floor. A busy window (a week or a month, or M1 and up over a day) can hold more than that; then only the newest
part comes back, and older quakes can read "reported" for want of an EMSC solution.

| Tool | Answers from | What you get |
|---|---|---|
| `show_on_globe` | (the globe itself) | the live 3D globe on a view: a place or point, a tilt, layers on or off, weather, a moment and clock speed, a satellite to follow, a flight to look for (download version only: on the website it is left out of the link), a country's card, a camera look. Pass another answer's `url` (a globe, 3D Solar System or Tonight link, an archived copy's too) to show exactly that |
| `earthquakes` | USGS, checked against EMSC | the last hour, day, week or month, worldwide or in an area, strongest or latest first, with tsunami flags and PAGER alerts |
| `where_is_satellite` | CelesTrak element sets (the website's copy), SGP4 | where a satellite is now: the point below it, height, speed, orbit, sunlit or not. Its link follows it |
| `satellite_passes` | the same | when it passes over a place in the next days, in that place's time zone, and which passes you can see |
| `launches` | Launch Library 2 (the website's copy) | upcoming launches, with how sure the time is, status, weather odds and webcasts |
| `people_in_space` | Launch Library 2 (the website's copy) | who is up, on the ISS and Tiangong |
| `asteroid_flybys` | NASA/JPL CNEOS (the website's copy) | close approaches in lunar distances, speed and rough size |
| `tropical_storms` | NOAA NHC, GDACS | every active cyclone: class, wind, pressure, movement, alert level |
| `natural_events` | NASA EONET | open wildfires, eruptions, storms, floods, icebergs, dust and more |
| `ships_baltic` | Fintraffic Digitraffic AIS | ships near a place in the northern Baltic (Finland's coastal network): type, status, speed, destination |
| `bike_share` | CityBikes | the nearest stations with bikes, e-bikes and free docks, worldwide |
| `weather` | Open-Meteo | now and up to 7 days, metric or imperial, in the place's time zone |
| `aurora` | NOAA SWPC | Kp now and for 3 days, and the chance of aurora overhead or on the horizon at a place |
| `space_weather` | NOAA SWPC | the solar wind at L1 (speed, density, Bz: southward is aurora-friendly), X-ray flares now and the 24 h peak, watches, warnings and alerts in force (storms, CMEs), each with its data age |
| `dark_sky` | the light pollution atlas (Falchi et al. 2016, CC BY-NC) and the OpenNGC deep-sky catalogue (CC-BY-SA-4.0), both the website's copies; Open-Meteo | the Bortle class and SQM at a place, what that means (Milky Way, stars), the nearest darker sky and which way, how good tonight is (sky, Moon, clouds), and the galaxies, clusters and nebulae within reach of eyes, binoculars or a small telescope tonight |
| `night_sky` | the website's own sky maths, Open-Meteo, NOAA SWPC | when it's dark, the planets, the Moon, meteor showers, bright passes, the aurora chance and the clouds |
| `traffic_cameras` | the agencies' own feeds: TfL (London), NYC DOT, Caltrans, DelDOT, Iowa DOT, MoDOT, Fintraffic, Statens vegvesen, DriveBC, Calgary, Hong Kong, Singapore | the nearest cameras, and the latest picture from the nearest few as images Claude can look at (live-video cameras as a stream link) |
| `transit_vehicles` | MBTA (Boston), HSL (Helsinki), Entur (Norway), CapMetro (Austin), Metro Transit (Minneapolis-St Paul) | the buses, trams, metros, trains and ferries near a place right now: line, destination, speed, how late (Norway) |
| `wildfires` | NASA VIIRS fire detections (FIRMS via GIBS), NIFC (US) | the hot pixels of the last day grouped into fires, strongest first, named by the nearest place; named US fires with acres and containment |
| `country_briefing` | the website's country data (Wikidata, World Bank), USGS, NASA EONET, NOAA NHC, GDACS, Open-Meteo | capital, population, economy, area, this week's earthquakes, open events, storms nearby and the weather in the capital |
| `submarine_cables` | TeleGeography's submarine cable map | the landing stations and cables at or near a place, with length, owners and the year in service |
| `solar_system` | the website's own planet maths (JPL elements) | where the planets and the Moon are, how bright, from a place when they rise and set, and their next oppositions and elongations |
| `eclipses` | JPL Horizons (the website's eclipse tables, 2027-2030) | each solar eclipse's kind and greatest point, and for a place whether it is seen, when, and how much of the Sun is covered |
| `distance` | WGS84 geodesics; OSRM over OpenStreetMap | how far between places as the crow flies (to the millimetre) and by road, bike or on foot; the globe link draws the line |
| `volcanoes` | Wikidata (the website's copy), NASA EONET, USGS | the volcanoes nearest a place, any open eruption, and this week's earthquakes next to them |
| `road_speeds` | Fintraffic (Finland), NYC DOT | measured traffic speeds and volumes on the roads near a place |
| `close_approaches` | CelesTrak SOCRATES (the website's copy), SGP4 | the closest coming encounters between satellites and debris, and where over the Earth they happen |
| `reentries` | CelesTrak element sets (the website's copy), the globe's decay model (`src/core/decay.js`) | what is predicted to re-enter in the next 30 days, soonest first: the window (usually ±25% of the time left, wider when the two drag estimates disagree), the orbit, working satellite or debris, provenance, and optionally the corridor (ground track over the window) |
| `sun_and_moon` | the website's own sky maths | sunrise, sunset, day length, the twilights, golden and blue hours, and the Moon, at a place on any day |
| `meteor_showers` | the IMO shower list, the website's sky maths | the coming showers, how many an hour you could really see from a place, and when to look |
| `plate_readers` | OpenStreetMap via DeFlock and FlockHopper's hourly tiles | the licence-plate readers mapped near a place in the US or Canada: how many, makes, operators, facings, the nearest ones (a count only for a big area) |
| `military_areas` | OpenStreetMap via OpenFreeMap's tiles | land mapped as military near a place (up to 150 km), worldwide: size, airfields inside, the nearest town, an OpenStreetMap link each |
| `weather_details` | Open-Meteo forecast, marine and multi-model APIs (ECMWF IFS, NOAA GFS, DWD ICON) | at a point: sea-level pressure and its three-hour tendency, Beaufort force and gusts, thunderstorm energy (CAPE), fog, freezing level, UV, cloud at three heights; the lowest pressure and strongest gust ahead and when; at sea the waves (Douglas scale), swell, period, sea temperature and current; and whether the models agree on the coming days. The link opens the globe with isobars, gusts and waves |
| `aircraft_lookup` | adsbdb | by registration or ICAO hex: type and type code, maker, class, registered owner, the country the address belongs to, a photo link; by callsign: the airline and the route on file, with both airports and the distance (the link draws the route; it looks for the live flight only in the download version) |
| `where_in_space` | JPL Horizons tracks and JPL small-body elements (the website's copies), the site's planet and moon maths | where a planet, the Moon, a major moon, a mission (Voyager, JWST, Parker, Juno, ISRO's Chandrayaan-2 and Aditya-L1…), any comet or any of 26,000 named asteroids (Apophis on its own JPL Horizons track for 2026-2035, through its 13 April 2029 Earth flyby) is now or at a time: distance from the Sun and Earth, light time, speed, RA/Dec and constellation, evening or morning sky, brightness, the mission's next event or the comet's next return; from a place, how high it is. Without a name, every mission nearest first (signal time, next event) or the comets best placed now. The link opens the 3D Solar System on it |
| `airport_weather` | Aviation Weather Center (NOAA/NWS) data API; OurAirports runways (the website's copy) | an airport's METAR and TAF decoded into plain words, its flight category, the forecast period by period and the runway the wind favours (live aircraft on its link only in the download version) |
| `sea_conditions` | NOAA NDBC (latest observations, station list), NOAA CO-OPS (stations, water level, tide predictions) | the buoys and coastal stations nearest a place with their latest waves, wind and water temperature, and the nearest US tide gauge with the level now and the next high and low |
| `air_quality` | Open-Meteo air-quality API (Copernicus CAMS model) | the US and European AQI, PM2.5, PM10, ozone, NO2, dust and aerosol depth at a place for this hour; a model, not a station measurement (OpenAQ needs a key) |

**Times.** `show_on_globe`, `solar_system` and `where_in_space` take an ISO 8601 `time`. A Z or an offset is honoured;
a time without one is read on the place's own clock, or as UTC when no place is given, never in the zone of the computer
running the server (a PC's own zone, or the Worker's UTC, would answer the same question hours apart), and the answer
says how it was read. `sun_and_moon`'s `date` is the place's own calendar day from its local midnight (23 or 25 hours on a clock-change
day; from 01:00 where the clocks spring forward at midnight, as in Santiago or Cairo), and a day the place's clocks skipped
is an error.

**Places right round the world.** Photon gives the United States, Russia, Fiji, Alaska and Chukotka a box from -180 to
180, which read as it stands is a band over every longitude. A country like that is its own outline in the website's
`data/borders.json` plus the sea within 2.5° (about 280 km) of any of its parts where no other country is nearer:
earthquakes and volcanoes in the United States take in Alaska, the Aleutians and Hawaii but not Baja California, Fiji
includes its islands east of 180°, and Russia does not count quakes off the Aleutians or Hokkaido. Alaska and Chukotka
are rougher: the country's land and sea inside the state's latitudes and near it. Every other place keeps its own box
or circle.

**Storms reach out to sea.** `tropical_storms`, and the severe storms of `natural_events`, let such a country reach 8°
(about 890 km) out to sea, whichever coast is nearer, the same reach as `country_briefing`'s storms nearby: a hurricane in
the central Gulf of Mexico (25°N 88°W) is the United States', one in the mid-Atlantic (35°N 40°W) is not. The reach is
sea only: a storm over another country's land never counts (a typhoon over Hokkaido is not Russia's, one over Havana
not the United States').

**Live aircraft.** The published website has none (its relay does not carry the ADS-B networks), so links made for it
leave out the `air` and `mil` layers and any flight to look for, and `aircraft_lookup`, `airport_weather` and
`show_on_globe` say that live aircraft come with the download version. With `--site http://localhost:8787/` (the
download's helper, or any `localhost`, `127.0.0.1` or `[::1]` address) links keep them.

**Prompts.** Hosts that show MCP prompts (Claude Desktop lists them as slash commands) get five ready-made requests:
`situation_report` (a place right now), `sky_tonight`, `country_brief`, `space_now` and `trip_check` (from, to, by). Each
walks Claude through the right tools and ends on the globe.

Place names are looked up with Photon (komoot), a free geocoder over OpenStreetMap; you can give `lat`/`lon` instead.

## Over HTTP

Some clients (and the MCP Inspector) speak Streamable HTTP rather than stdio. Run

```bash
node mcp/server.mjs --http 8793
```

and point the client at `http://127.0.0.1:8793/mcp`. It answers on your own computer only (`--host` takes 127.0.0.1, ::1
or localhost, never a public address: there is no sign-in), each POST carries one JSON-RPC message and gets one JSON answer,
and nothing is remembered between requests. Web pages may use it only from your own machine (`http://localhost:…`) or from
origins you list with `--allow-origin https://example.com`; everything else gets 403.

## Remote: claude.ai and ChatGPT connectors

The same server runs as a Cloudflare Worker ([`mcp-worker/`](../mcp-worker/README.md), the code in `mcp/worker.mjs`):
stateless Streamable HTTP at `/mcp`, guarded by a secret (`Authorization: Bearer <token>`, or the token as the last part of
the path for connectors that only take a URL), with CORS for claude.ai and ChatGPT, every feed and every tool answer
shared through the Workers Cache API, and a rate limit per address. On Cloudflare's free plan (10 ms of CPU and 50
look-ups a request) it leaves out the thirteen heaviest tools (satellite pass searches, re-entry predictions, the planets' look-ahead, tile
decoding, vessel-by-vessel AIS, the light pollution grid); on Workers Paid it lists all of them. Once deployed, add
`https://open-overwatch-mcp.<account>.workers.dev/mcp/<token>` in claude.ai (Settings → Connectors → Add custom
connector). It was deployed on the owner's Cloudflare account on 2026-10-13 and has not been redeployed since, so it
runs an older version of this server: it lacks later changes such as EMSC in `earthquakes`. The connector URL holds the
token, so it is kept off the repository (ask the owner for one). A redeploy is a production deploy and needs the owner's
OK; the steps are in [mcp-worker/README.md](../mcp-worker/README.md).

## Privacy

Nothing is stored and nothing is sent to this project: the server runs on your computer and asks the public sources
directly. What each one sees is your IP address and what the question needs: place names go to Photon, coordinates to
Open-Meteo (weather, marine and model forecasts, time zones), adsbdb (the registration or callsign you ask about), Fintraffic (ships), CityBikes (stations near a point), Entur (vehicles in a box around
the place), NIFC (fires in a box around a US place), NASA GIBS (the fire tiles around the place asked about), Photon
again (the place nearest a fire), the map tiles around a place to OpenFreeMap and FlockHopper (military areas, plate
readers), the two ends of a road, bike or foot route to the FOSSGIS OSRM servers (routing.openstreetmap.de), and the
airport code to NOAA's Aviation Weather Center (METAR and TAF); the other tools fetch whole public feeds (USGS, EMSC,
NOAA, NASA, transit operators, camera agencies and their pictures, TeleGeography, the website's data copies on GitHub
Pages) without anything about you. The globe in
the chat is the public website, loaded by your Claude app, under the same privacy notice as the website. Each source's
own policy and licence applies; see [docs/DATA_SOURCES.md](../docs/DATA_SOURCES.md). The remote Worker
asks the same sources from Cloudflare's network instead of your computer, keeps shared copies of their answers and of
tool answers (keyed by a hash of the question) for a minute to a day, and logs nothing about you (with `LOG` on, only the
tool's name and time).

## For developers

- `node mcp/server.mjs --site http://localhost:8787/` points links (and the globe panel) at a local copy of the site;
  a local site counts as the download version, so its links may turn live aircraft on (`siteHasAircraft` in `mcp/feeds.mjs`).
- `node --test` runs `test/mcp.test.mjs` with every source canned, a stdio round trip and the HTTP transport.
- `node mcp/server.mjs --http 8793` serves Streamable HTTP (`mcp/http.mjs` is the transport on web Request/Response only,
  so it could run on a Worker; `mcp/http-node.mjs` serves it from Node). Tools may return images (MCP image content).
- `mcp/worker.mjs` is the same server as a Cloudflare Worker (deployed from `mcp-worker/`, last on 2026-10-13): a server per
  request over a shared in-isolate memory, the Cache API in front of the network (`createFeeds({ shared })`) and of tool
  answers, a subrequest budget, and the free plan's tool list (`HEAVY`). `test/mcpworker.test.mjs` runs it in Node with
  canned feeds and a stand-in Cache API, and checks that nothing it imports needs Node (stdio lives in `mcp/stdio.mjs`).
- No SDK: the protocol is in `mcp/protocol.mjs`; one dependency, `satellite.js` (the SGP4 library the website loads).
- The globe panel (`mcp/panel.mjs`) is an MCP Apps view (`ui://open-overwatch/globe`, spec 2026-01-26): it frames the
  website in embed mode and moves it by changing only the link's hash, so the globe flies instead of reloading. Hosts
  allow the frame because the resource names the site's origin in `_meta.ui.csp.frameDomains`.
- It never asks CelesTrak (which blocks networks that download often): element sets come from the website's copy,
  refreshed every 6 hours.
