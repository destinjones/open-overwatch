OPEN OVERWATCH
==============
A single-page situation map fed by open data: aircraft (ADS-B), satellites (CelesTrak + SGP4),
public cameras, ships (AIS), weather balloons, earthquakes, natural events, disaster alerts,
tropical cyclones, severe-weather alerts, radar, aurora, world news, submarine cables —
with a soundtrack generated live in the browser (or underground radio via SomaFM).

QUICK START (Windows)
  1. Unzip everything into one folder.
  2. Double-click "Start Open Overwatch.bat". It starts a tiny local helper and opens the map at
     http://127.0.0.1:8787/open-overwatch.html
     (needs Python 3 or Node.js; the .bat finds whichever you have)
  Mac / Linux:  python3 serve.py   or   node serve.js

3D GLOBE (beta)
  With the helper running, open http://127.0.0.1:8787/globe.html (or press "3D globe" under the
  Layers rail). One CesiumJS globe from deep space to street level: 18,000+ satellites at their real
  heights, the Moon, live aircraft, earthquakes, and real day/night with city lights. Satellites and
  aircraft near the camera turn into 3D models; click one and press "Follow in 3D" (or double-click it)
  to orbit it while it moves. Esc stops following. It needs the helper (it will say so if you open the
  file directly).

WHY THE HELPER
  The views are ES modules, which browsers will not load from a file opened directly (file://), so
  they need the helper, or any other local web server serving this folder (then without the relayed
  feeds below).

  Most sources allow requests straight from a web page. A few do not (they send no CORS header):
  the ADS-B aggregators (adsb.lol, airplanes.live, adsb.fi), OpenSky, NOAA NHC hurricane advisories,
  NOAA NDBC buoys and DART files, tsunami.gov's messages, the Aviation Weather Center's METAR and TAF,
  NYC DOT cameras, the DriveBC and MoDOT camera lists, four agencies' camera stills, GDELT and the
  live TeleGeography submarine-cable data, plus NASA FIRMS and Windy for the keyed layers. The exact
  list is ALLOWED_HOSTS at the top of serve.js (and serve.py). The worldwide ship stream from
  aisstream.io (with your own key) also goes through the helper: aisstream.io does not permit
  browser connections. The helper serves the page from localhost and relays only those hosts, and
  only for its own pages. It has no dependencies and talks to nothing else. Every public CORS proxy
  we tried is dead or paywalled, which is why it is bundled.

FILES
  open-overwatch.html        the map (self-contained; libraries load from cdnjs/jsdelivr)
  globe.html                 the 3D globe (CesiumJS from jsdelivr; models and textures in brand/)
  solar.html                 the Solar System, out to the Local Group (three.js from jsdelivr)
  tonight.html               what is up in your sky tonight
  index.html                 the home page; about.html (the creator), guide.html (the user guide), india/ (India page),
                             teach/ (classroom activities); sky/ points at the city sky pages on the website
  src/                       the views' code (ES modules)
  data/                      orbits, stars, airports, runways, deep sky, light pollution and more, so the views
                             load them from this folder (the live feeds such as launches, flybys and satellite
                             elements still come from the website). data/lightpollution.md: that atlas is
                             CC BY-NC 4.0 (non-commercial use only), unlike the rest
  brand/                     logo, start-screen art, fonts, 3D models and textures
  serve.py                   helper, Python 3 standard library
  serve.js                   helper, Node 18+ / Bun
  Start Open Overwatch.bat   Windows launcher (console window stays open)
  Start Open Overwatch (minimized).vbs   same, with the console minimized to the taskbar
  LICENSE, NOTICE            MIT licence (LICENSE); data credits and their own licences in NOTICE
                             (all sources and terms: docs/DATA_SOURCES.md)

AUDIO
  Press "Enter with audio" on the boot screen, or the audio button in the header. Generated mode
  synthesizes an original soundtrack (Underground / Drift / Pulse) that reacts to the map; Radio mode
  plays stations from the open radio-browser.info directory by tag (dark ambient, techno, dnb, …).

OPTIONAL KEYS (Setup tab in the map)
  Windy webcams (webcams anywhere), aisstream.io (global ships, through the helper), NASA FIRMS
  (active fires).

CHECKING FEEDS
  Setup tab -> "Test all feeds" lists every source with ok / blocked / error and the response time.
  The Log tab shows each feed's errors as they happen. The Brief tab (default) summarises what is notable now.

FAIR USE
  These are volunteer and public-agency services. The page rate-limits itself (one ADS-B request
  every 2.5 s per network, never under 2 s; orbital data cached 2 h; GDELT once per 15 min; feeds back
  off on errors; polling drops to a third when the tab is hidden). Check each provider's terms before
  any commercial use.
