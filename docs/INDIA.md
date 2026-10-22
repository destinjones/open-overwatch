# The India page and its ads

`india/` (<https://destinjones.github.io/open-overwatch/india/>) is a landing page for visitors from India, made for
Meta ads aimed at India. English by default, हिन्दी with the toggle in the top bar or with `?lang=hi`; the choice is
kept in the browser (`localStorage` `oo-lang`). `india/hi/` is the same page opening in हिन्दी at its own,
self-canonical address (hreflang hi-IN), made from `india/index.html` by `node brand/tools/india_hi.mjs` (run it after
every edit of the English page). The app itself stays in English.

Files: `india/index.html` (the page, both languages in it), `india/india.js` (the page's code), `src/core/india.js`
(the logic, tested in `test/india.test.mjs`), `brand/india/` (hero stills, the Open Graph card and the phone clips),
`brand/fonts/noto-sans-devanagari-var-devanagari.woff2` (the Hindi typeface, self-hosted, SIL OFL), `e2e/india.spec.mjs`
(the browser test, CI only).

## Ad links

Measurement is by UTM tags only: no Meta Pixel, no analytics, no cookies, so the page keeps the site's "no account, no
tracking" promise. The page never reads the tags; it only takes `utm_*` and `fbclid` out of the address bar once it
has loaded (and its Share button never carries them), so a link someone copies or shares is clean.

Nothing on the site records the tags either: GitHub Pages keeps no visitor log you can read. The numbers to watch are
Meta's own (link clicks per ad). The tags only start to count if a privacy-friendly counter is added later, and then
they are already on every ad.

| Ad | URL |
|---|---|
| English | `https://destinjones.github.io/open-overwatch/india/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=promo_en` |
| Hindi | `https://destinjones.github.io/open-overwatch/india/hi/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=promo_hi` |
| ISS passes | `https://destinjones.github.io/open-overwatch/india/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=iss#iss` |
| ISRO launches | `https://destinjones.github.io/open-overwatch/india/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=isro#launches` |
| Air quality | `https://destinjones.github.io/open-overwatch/india/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=aqi#air` |
| Night sky / Hanle | `https://destinjones.github.io/open-overwatch/india/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=sky#sky` |

Display link: `destinjones.github.io/open-overwatch/india`. In Ads Manager the tags can go in "URL parameters"
instead, with Meta's own fields: `utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`.
A Hindi ad points at `india/hi/` (its share card and search entry are in Hindi); the older `india/?lang=hi` still
opens in Hindi, but it is not the Hindi page's own address. A topic ad in Hindi is the English one with `india/hi/` in
place of `india/` (and `_hi` on its `utm_content`): the Hindi page has the same anchors (`#iss`, `#launches`, `#air`,
`#sky`, `#sun`).

## What a Hindi reader gets

- **The page in हिन्दी at its own address.** `india/hi/` always opens in Hindi (`?lang=en` switches it), with a Hindi
  `<title>`, description, Open Graph and Twitter text and image alt, `og:locale` `hi_IN`, and the Devanagari typeface
  served by the site. `india/` opens in English unless the visitor chose Hindi before (`oo-lang`). The hreflang pair
  points each page at the other.
- **The same facts as the English page**: every line is in the page in both languages, the dynamic text too (the live
  strip, the next launches, the pass table), and `test/india.test.mjs` fails if `india/hi/` falls behind `india/`.
- **Links into an English app.** The globe, the Solar System view and Tonight are in English. On the globe, voice
  commands understand Hindi when the browser lists Hindi before English (`core/voicecmd.js` `voiceLangs`): going to a
  place ("मुझे टोक्यो ले चलो"), following a satellite, zooming, switching satellites, planes, ships, quakes or storms
  on and off, the weather, Tonight and Look up. Answers are spoken in English with an Indian English voice; help and a
  sentence it didn't catch get Hindi phrases, read in Hindi.

## The city sky pages in हिन्दी

Each of the 84 Indian cities in `data/cities.json` (Wikidata, CC0: every Indian city of 500,000 people or more, see
`brand/tools/make_cities.py`) has a "What's in the sky tonight" page in English at `sky/<slug>/` and in Hindi at
`sky/hi/<slug>/`. They are made at every 6-hourly site build by `brand/tools/make_sky_pages.mjs` (never committed;
the repo's `sky/` holds only stand-ins for the two lists), with tonight's facts worked out by the same core code as
Tonight: sunset and sunrise, when it gets dark, the Moon, the planets up after dark, the next visible ISS pass, the
Bortle class and three binocular targets, on IST (`Asia/Kolkata`).

- **The Hindi page**: `lang="hi"`, a Hindi `<title>`, description and heading with the city's Hindi name from
  Wikidata (मुम्बई, पुणे), `og:locale` `hi_IN`, and the facts in Hindi. The live Tonight card framed in it is in
  English and shows times on the visitor's own clock; the page says so in Hindi.
- **The pair**: each page names the other with hreflang (`en`, `hi`, and `x-default` the English one), and the
  sitemap (`sitemap-sky.xml`) carries the same pairs. The two lists are not a pair: `sky/` lists every city by country
  (India's heading is `sky/#in`), `sky/hi/` only the Indian cities, in Hindi.
- **Links in**: both India pages link to `sky/#in` ("Tonight in your city") and `sky/hi/` ("आज रात आपके शहर में"); each
  Indian city page links back to `india/` or `india/hi/`.

A slug is the city's English name in ASCII: `delhi`, `mumbai`, `bengaluru`, `hyderabad`, `ahmedabad`, `chennai`,
`pune`, `kolkata`, `lucknow`, `jaipur`, `navi-mumbai`, `thiruvananthapuram` (the full list: the `slug` column of
`data/cities.json`). An ad for one city points at its page, Hindi or English, with the same tags as the other ads and
the city in `utm_content`:

| Ad | URL |
|---|---|
| Tonight in Pune, Hindi | `https://destinjones.github.io/open-overwatch/sky/hi/pune/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=sky_pune_hi` |
| Tonight in Pune, English | `https://destinjones.github.io/open-overwatch/sky/pune/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=sky_pune` |
| All Indian cities, Hindi | `https://destinjones.github.io/open-overwatch/sky/hi/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=sky_list_hi` |

Unlike the India page, a city page runs no script, so the tags stay in the address bar and go with a link the visitor
copies; nothing reads them, and the Tonight card framed in the page is given only the place, never the tags. Point
ads at the website only: the download version and a local copy show a stand-in at `sky/` that links to the website. A
city page exists once a site build has run with the city in `data/cities.json`, so check the link before an ad goes out.

## What the page claims, and why it is true

- **No live aircraft on the website**: said in the hero, in "What you won't get", and no link turns `air` or `mil` on
  (`test/india.test.mjs` checks the links).
- **Launches from India**: read from the site build's copy of Launch Library 2 (`data/launches.json`, the next 40
  worldwide); dates are shown only as precisely as announced ("target: October 2026"). If none is on the list, it says so.
- **More than 50 Indian satellites among 15,000+ active**: the CelesTrak `active` group the site copies had 15,927
  satellites and 54 Indian ones by name (Cartosat, Oceansat/EOS, NISAR, RISAT, Resourcesat, Astrosat, INSAT, GSAT, CMS,
  IRNSS/NVS) on 2026-10-15. INSAT, GSAT and NavIC are also in the `geo` group. Follow links: Cartosat-3 (44804), NISAR (65053).
- **ISS passes over six cities**: worked out in the page from the site's TLE copy (`data/tle/stations.txt`, never
  CelesTrak) with `core/passes.js`, the same code as Tonight. "Visible" needs a dark sky and a sunlit station; when no
  visible pass comes within 7 days the next pass of any kind is shown and marked "not visible".
- **Hanle Bortle 1, India Gate Bortle 8**: the app's light-pollution grid (Falchi et al. 2016, `data/lightpollution.bin`,
  `core/lightpollution.js` `skyAt`) at 32.78 N 78.96 E and 28.61 N 77.23 E. Mumbai comes out 7, Bengaluru, Kolkata and
  Hyderabad 8, Chennai 6. A model from 2014 satellite data, said so on the page.
- **ISRO missions**: Chandrayaan-1/-2/-3 (Vikram, propulsion module), Mangalyaan and Aditya-L1 are drawn in the Solar
  System view from NASA JPL Horizons tracks (`data/solar/spacecraft.json`, `brand/tools/make_spacecraft.py`); the
  Moon and Mars orbiters fly Moon- or Mars-centred orbits. The page names where each track ends, and
  `test/india.test.mjs` warns two weeks before a "now" link (Chandrayaan-2, Aditya-L1) runs past its track. Chandrayaan-2's
  track ends 2026-11-26 and Aditya-L1's 2027-01-19: before 2026-11-12, rerun
  `python brand/tools/make_spacecraft.py --only "Chandrayaan-2,Aditya-L1"` (a few Horizons requests) and republish.
  Past the end, the missions list says "past the published track (JPL Horizons)" rather than "mission over".
- **Air quality**: modelled (CAMS via Open-Meteo), not CPCB stations; the page points to CPCB, IMD and NCS for anything
  that matters.

## Clips, stills and the ad video

- `brand/india/clips/{india_sats,delhi_dive,airq,lookup}.mp4` + `.jpg` (540x960, 4.5–5.5 s): recorded from the
  published website with `node brand/tools/india_clips.mjs` (headless Edge on the GPU, frame-stepped, 1080x1920 frames,
  IST time zone, the location fixed at India Gate). `OO_CLIPS=airq` records one; `OO_ENCODE_ONLY=1` re-encodes.
  Record while it is night in India for the city lights and the Look up sky (the satellite clip sets its own midday).
- `brand/india/hero-wide.{webp,jpg}`, `hero-tall.webp`: India at night from the published globe (`globe_shot.mjs` with
  `OO_URL=…globe.html?hints=0#c=…&l=stations,visual,geo,active,night`, the page furniture hidden).
- `brand/india/og-india-1200x630.jpg`: `brand/india/og-card.html` rendered at 1200x630 (see the comment in it).
- The ad: `python brand/tools/promo_india.py` → `brand/video/open-overwatch-india-promo.mp4` (gitignored), 1080x1920,
  30 fps, about 17.6 s, English captions, no audio, ending on a card with the address.
