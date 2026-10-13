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

| Tool | Answers from | What you get |
|---|---|---|
| `show_on_globe` | (the globe itself) | the live 3D globe on a view: a place or point, a tilt, layers on or off, weather, a moment and clock speed, a satellite to follow, a flight to look for, a country's card, a camera look. Pass another answer's `url` to show exactly that |
| `earthquakes` | USGS | the last hour, day, week or month, worldwide or in an area, strongest or latest first, with tsunami flags and PAGER alerts |
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
| `sun_and_moon` | the website's own sky maths | sunrise, sunset, day length, the twilights, golden and blue hours, and the Moon, at a place on any day |
| `meteor_showers` | the IMO shower list, the website's sky maths | the coming showers, how many an hour you could really see from a place, and when to look |
| `plate_readers` | OpenStreetMap via DeFlock and FlockHopper's hourly tiles | the licence-plate readers mapped near a place in the US or Canada: how many, makes, operators, facings, the nearest ones (a count only for a big area) |
| `military_areas` | OpenStreetMap via OpenFreeMap's tiles | land mapped as military near a place (up to 150 km), worldwide: size, airfields inside, the nearest town, an OpenStreetMap link each |
| `weather_details` | Open-Meteo forecast, marine and multi-model APIs (ECMWF IFS, NOAA GFS, DWD ICON) | at a point: sea-level pressure and its three-hour tendency, Beaufort force and gusts, thunderstorm energy (CAPE), fog, freezing level, UV, cloud at three heights; the lowest pressure and strongest gust ahead and when; at sea the waves (Douglas scale), swell, period, sea temperature and current; and whether the models agree on the coming days. The link opens the globe with isobars, gusts and waves |
| `aircraft_lookup` | adsbdb | by registration or ICAO hex: type and type code, maker, class, registered owner, the country the address belongs to, a photo link; by callsign: the airline and the route on file, with both airports and the distance (the link draws it and looks for the flight) |
| `where_in_space` | JPL Horizons tracks and JPL small-body elements (the website's copies), the site's planet and moon maths | where a planet, the Moon, a major moon, a mission (Voyager, JWST, Parker, Juno…), any comet or any of 26,000 named asteroids is now or at a time: distance from the Sun and Earth, light time, speed, RA/Dec and constellation, evening or morning sky, brightness, the mission's next event or the comet's next return; from a place, how high it is. The link opens the 3D Solar System on it |

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
look-ups a request) it leaves out the eleven heaviest tools (satellite pass searches, the planets' look-ahead, tile
decoding, vessel-by-vessel AIS); on Workers Paid it lists all of them. Once deployed, add
`https://open-overwatch-mcp.<account>.workers.dev/mcp/<token>` in claude.ai (Settings → Connectors → Add custom
connector). It is not deployed yet: the deploy steps are in [mcp-worker/README.md](../mcp-worker/README.md).

## Privacy

Nothing is stored and nothing is sent to this project: the server runs on your computer and asks the public sources
directly. What each one sees is your IP address and what the question needs: place names go to Photon, coordinates to
Open-Meteo (weather, marine and model forecasts, time zones), adsbdb (the registration or callsign you ask about), Fintraffic (ships), CityBikes (stations near a point), Entur (vehicles in a box around
the place), NIFC (fires in a box around a US place) Photon again (the place nearest a fire), the map tiles around a place
to OpenFreeMap and FlockHopper (military areas, plate readers), and the other tools fetch
whole public feeds (USGS, NOAA, NASA, transit operators, camera agencies and their pictures, TeleGeography, the website's
data copies on GitHub Pages) without anything about you. The globe in
the chat is the public website, loaded by your Claude app, under the same privacy notice as the website. Each source's
own policy and licence applies; see [docs/DATA_SOURCES.md](../docs/DATA_SOURCES.md). The remote Worker, once deployed,
asks the same sources from Cloudflare's network instead of your computer, keeps shared copies of their answers and of
tool answers (keyed by a hash of the question) for a minute to a day, and logs nothing about you (with `LOG` on, only the
tool's name and time).

## For developers

- `node mcp/server.mjs --site http://localhost:8787/` points links (and the globe panel) at a local copy of the site.
- `node --test` runs `test/mcp.test.mjs` with every source canned, a stdio round trip and the HTTP transport.
- `node mcp/server.mjs --http 8793` serves Streamable HTTP (`mcp/http.mjs` is the transport on web Request/Response only,
  so it could run on a Worker; `mcp/http-node.mjs` serves it from Node). Tools may return images (MCP image content).
- `mcp/worker.mjs` is the same server as a Cloudflare Worker (deployed from `mcp-worker/`, not yet): a server per
  request over a shared in-isolate memory, the Cache API in front of the network (`createFeeds({ shared })`) and of tool
  answers, a subrequest budget, and the free plan's tool list (`HEAVY`). `test/mcpworker.test.mjs` runs it in Node with
  canned feeds and a stand-in Cache API, and checks that nothing it imports needs Node (stdio lives in `mcp/stdio.mjs`).
- No SDK: the protocol is in `mcp/protocol.mjs`; one dependency, `satellite.js` (the SGP4 library the website loads).
- The globe panel (`mcp/panel.mjs`) is an MCP Apps view (`ui://open-overwatch/globe`, spec 2026-01-26): it frames the
  website in embed mode and moves it by changing only the link's hash, so the globe flies instead of reloading. Hosts
  allow the frame because the resource names the site's origin in `_meta.ui.csp.frameDomains`.
- It never asks CelesTrak (which blocks networks that download often): element sets come from the website's copy,
  refreshed every 6 hours.
