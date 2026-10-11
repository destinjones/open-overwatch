// Spoken commands for the globe, without an AI service: a sentence in, one action out. Pure (no DOM), so Node tests it.
// The globe's voice.js listens with the browser's own speech recognition and runs what this returns:
//   { act: 'sensor', mode }      night vision, thermal, CRT, noir, normal
//   { act: 'hud' | 'detect' | 'cockpit', on: true | false | null (toggle) }
//   { act: 'go', place }         "take me to Tokyo", "show me the ISS" (the globe decides: satellite, view, layer or a place)
//   { act: 'track', what }       "track the ISS", "follow Hubble", "lock on to the space station"
//   { act: 'layer', name, on }   "turn on earthquakes", "hide the satellites"
//   { act: 'view', go }          "what's above me tonight", "open the solar system", "play the tour"
//   { act: 'reset' | 'north' | 'topdown' | 'stop' | 'what' | 'help' | 'live' | 'pause' }
//   { act: 'zoom', dir: 'in' | 'out' }   { act: 'faster' }   { act: 'count', what, place? }   { act: 'unknown', text }
//   { act: 'route', from, to, mode: 'drive' | 'walk' | 'cycle' }   { act: 'flyroute' }
//   { act: 'pick', n }           "the second one", "number three": one of the things the last answer listed
//   { act: 'weather', place? }   "what's the weather here", "is it raining in Paris", "how cold is it in Oslo"

import { compass } from './gfs.js';

export const SENSORS = Object.freeze(['normal', 'nvg', 'flir', 'flirbh', 'iron', 'crt', 'noir']);

const SENSOR_WORDS = [
  [/\b(night ?vision|nvg|night mode|green mode)\b/, 'nvg'],
  [/\bblack ?hot\b/, 'flirbh'],
  [/\b(iron ?bow|rainbow|heat ?map|colou?r thermal)\b/, 'iron'],
  [/\b(flir|thermal|infra ?red|white ?hot|heat vision|ir mode)\b/, 'flir'],
  [/\b(crt|old tv|retro|tube|scan ?lines?)\b/, 'crt'],
  [/\b(noir|black and white|black & white|monochrome|grayscale|greyscale)\b/, 'noir'],
  [/\b(normal|regular|true colou?r|daylight|visible|eo mode|clear (the )?filter|no filter)\b/, 'normal'],
];
// views the globe can open, by what people say
const VIEWS = [
  [/\b(tonight|above me|overhead tonight|what can i see|passes)\b/, 'tonight'],
  [/\b(look up|sky mode|point (my )?phone)\b/, 'lookup'],
  [/\b(launch(es)?|rockets?)\b/, 'launches'],
  [/\b(weather|clouds|rain|radar)\b/, 'weather'],
  [/\b(solar system|planets|the galaxy|deep space|cosmic web)\b/, 'space'],
  [/\b(tour|guided)\b/, 'tour'],
  [/\b(near miss(es)?|close approach(es)?|conjunctions?|collisions?)\b/, 'conj'],
  [/\b(eclipses?)\b/, 'eclipses'],
  [/\b(asteroids?|comets?|flybys?)\b/, 'flybys'],
  [/\b(astronauts?|people in space|who is in space|crew)\b/, 'crew'],
  [/\b(the moon|lunar)\b/, 'moon'],
  [/\b(geo belt|geostationary)\b/, 'geo'],
];
const ON = /\b(on|show|enable|start|open|activate)\b/, OFF = /\b(off|hide|disable|stop|close|kill|remove|exit|leave)\b/;

/** Lowercase, no punctuation, no wake word or politeness. */
export function normalize(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' &-]+/g, ' ')
    .replace(/^\s*(hey |ok |okay )?(overwatch|open overwatch|computer)\b[ ,]*/, '')
    .replace(/\b(please|can you|could you|would you|i want to|i'd like to|let's|lets|just|now)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const onOff = s => OFF.test(s) ? false : ON.test(s) ? true : null;
const ORDINAL = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4, fifth: 5, '5th': 5, five: 5, sixth: 6, six: 6 };
const COUNTED = [[/sat/, 'sat'], [/quake/, 'quake'], [/military/, 'mil'], [/plane|aircraft|flight|jet/, 'air'], [/ship|boat|vessel/, 'ship'], [/bus|train|tram|metro|vehicle/, 'transit'], [/camera/, 'cam']];
const HERE = /^(here|there|now|right|right now|today|outside)$/;
const clean = s => s.replace(/^(the|a|an|to|at|on|over)\s+/, '').replace(/\s+(please|now|for me|right now)$/, '').trim();

export function parse(text) {
  const s = normalize(text);
  if (!s) return { act: 'unknown', text: '' };
  if (/^(help|what can i (say|do)|commands|what do you do)\b/.test(s)) return { act: 'help' };
  // stop / exit first, so "exit cockpit" and "stop tracking" are not read as anything else
  if (/\b(cockpit|ride along|pilot view|first person|ride it|ride with)\b/.test(s)) return { act: 'cockpit', on: /\b(exit|leave|stop|off|out of)\b/.test(s) ? false : /\b(enter|on|go|start|take|ride|switch)\b/.test(s) ? true : null };
  if (/^(pause|freeze|stop time|hold time)\b/.test(s)) return { act: 'pause' };
  if (/^(stop|stop (tracking|following)|release|unlock|cancel|escape|let go)\b/.test(s)) return { act: 'stop' };
  if (/\b(hud|heads up|tactical (display|overlay)|overlay)\b/.test(s)) return { act: 'hud', on: onOff(s) };
  if (/\b(detection|detect|bounding box(es)?|boxes|target boxes|tracking boxes|identify everything)\b/.test(s)) return { act: 'detect', on: onOff(s) };
  for (const [re, mode] of SENSOR_WORDS) if (re.test(s)) return { act: 'sensor', mode };
  if (/^(reset|home|start over|zoom out to (a |the )?(globe|whole earth|earth)|globe view|whole (earth|planet|world)|show (me )?the (whole )?(earth|world|globe))\b/.test(s)) return { act: 'reset' };
  if (/\bnorth up\b|\bface north\b|\bpoint north\b/.test(s)) return { act: 'north' };
  if (/\b(top down|straight down|look down|bird'?s eye)\b/.test(s)) return { act: 'topdown' };
  if (/^(zoom in|closer|get closer|move in|enhance)\b/.test(s)) return { act: 'zoom', dir: 'in' };
  if (/^(zoom out|back up|pull back|further|farther|wider)\b/.test(s)) return { act: 'zoom', dir: 'out' };
  if (/\b(go live|back to (now|live)|real ?time|live mode)\b/.test(s)) return { act: 'live' };
  if (/\b(speed up|fast forward|faster|time lapse|timelapse)\b/.test(s)) return { act: 'faster' };
  if (/^(what('s| is) (this|that|here|it|selected)|what am i looking at|where am i|where is this|identify( this| that)?|what('s| is) (down )?there)\b/.test(s)) return { act: 'what' };
  let m = s.match(/^(?:(?:open|select|show|pick|choose|go to|take me to) )?(?:the )?(?:number )?(first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|one|two|three|four|five|six|[1-6])(?: one)?$/);
  if (m) return { act: 'pick', n: ORDINAL[m[1]] || +m[1] };
  m = s.match(/^(?:what's|whats|what is|how's|hows|how is|tell me) (?:the )?weather(?: like)?(?: (?:in|at|for|over|around) (.+?))?(?: (?:here|there|right|today))?$/)
    || s.match(/^(?:is it|will it be) (?:raining|snowing|windy|cold|hot|warm|sunny|cloudy)(?: (?:in|at|over) (.+?))?(?: (?:here|there|right|today))?$/)
    || s.match(/^how (?:warm|cold|hot|windy) is it(?: (?:in|at|over) (.+?))?(?: (?:here|there|right|today))?$/)
    || s.match(/^(?:weather|temperature|wind) (?:in|at|for|over) (.+)$/);
  if (m) { const place = m[1] && !HERE.test(m[1]) ? clean(m[1]) : null; return place ? { act: 'weather', place } : { act: 'weather' }; }
  m = s.match(/^how many (satellites|sats|planes|airplanes|aircraft|flights|jets|military( aircraft| planes| flights)?|earthquakes|quakes|ships|boats|vessels|buses|trains|trams|vehicles|cameras|things|objects|targets|contacts)\b(?:.*?\b(?:over|above|in|around|near|across|within|off)\s+(.+?))?$/);
  if (m) {
    const what = (COUNTED.find(([re]) => re.test(m[1])) || [null, 'all'])[1], place = m[3] ? clean(m[3].replace(/\s+(right|at the moment|today)$/, '')) : '';
    return place && !/^(view|sight|the view|frame|the frame|the picture|the sky|range|my view|screen|the screen)$/.test(place) ? { act: 'count', what, place } : { act: 'count', what };
  }
  if (/^(fly (it|the route|this route|that route|along the route|the path)|play the route)( |$)/.test(s)) return { act: 'flyroute' };
  m = s.match(/^(?:show me |give me |get |find |draw |plot )?(?:the |a )?(?:(walking|walk|driving|drive|car|cycling|cycle|bike|biking) )?(?:route|directions|way|path)? ?from (.+?) to (.+)$/)
    || s.match(/^(walk|drive|cycle|bike) from (.+?) to (.+)$/) || s.match(/^how (?:do|can) i (walk|drive|cycle|get) from (.+?) to (.+)$/);
  if (m && m[2] && m[3]) return { act: 'route', from: clean(m[2]), to: clean(m[3]), mode: /walk/.test(m[1] || '') ? 'walk' : /cycl|bike/.test(m[1] || '') ? 'cycle' : 'drive' };
  m = s.match(/^(track|follow|lock on( to)?|lock onto|target|chase)\s+(.+)$/);
  if (m) return { act: 'track', what: clean(m[3]) };
  m = s.match(/^(turn|switch|toggle)\s+(on|off)\s+(.+)$/) || s.match(/^(turn|switch|toggle)\s+(.+?)\s+(on|off)$/);
  if (m) { const on = m[2] === 'on' || m[3] === 'on', name = clean(m[2] === 'on' || m[2] === 'off' ? m[3] : m[2]); return { act: 'layer', name, on }; }
  m = s.match(/^(hide|remove)\s+(.+)$/);
  if (m) return { act: 'layer', name: clean(m[2]), on: false };
  for (const [re, go] of VIEWS) if (re.test(s) && !/^(take me|fly|go|show me|navigate|zoom)\s+(to|over)\s/.test(s)) return { act: 'view', go };
  m = s.match(/^(take me|fly me|fly|go|head|navigate|zoom|jump|teleport|bring me)\s+(to|over|into|towards?)\s+(.+)$/) || s.match(/^(show me|show|find|where is|where's|search( for)?|look at)\s+(.+)$/);
  if (m) return { act: 'go', place: clean(m[3]) };
  return { act: 'unknown', text: s };
}

/** Phrases for the help card and the "try saying" hint. */
export const EXAMPLES = Object.freeze([
  'Take me to Tokyo', 'Track the ISS', 'Night vision', 'Thermal', 'Enter cockpit', 'Turn on earthquakes', 'Walking route from Big Ben to the Tower of London',
  'How many satellites are in view?', "What's this?", 'Show me the launches', 'Zoom out to a globe view', "What's the weather in Paris?", 'How many planes over Texas?',
]);

// ---- weather in words (for spoken answers)
const WMO = { 0: 'clear skies', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow',
  75: 'heavy snow', 77: 'snow grains', 80: 'rain showers', 81: 'rain showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms',
  96: 'thunderstorms with hail', 99: 'thunderstorms with hail' };
/** The sky in a few words: from a WMO weather code if there is one, else from cloud cover (%) and rain (mm/h). */
export function skyWords({ code, cloud, rain, temp }) {
  if (Number.isFinite(code) && WMO[code]) return WMO[code];
  if (Number.isFinite(rain) && rain >= 0.2) return (Number.isFinite(temp) && temp < 0 ? 'snow' : rain >= 4 ? 'heavy rain' : rain >= 1 ? 'rain' : 'light rain');
  if (!Number.isFinite(cloud)) return '';
  return cloud >= 85 ? 'overcast' : cloud >= 45 ? 'partly cloudy' : cloud >= 15 ? 'mostly clear' : 'clear skies';
}
/** A reading { temp °C, speed m/s, from (deg), cloud %, rain mm/h, code } spoken: "14 degrees Celsius, light rain, wind 18 kilometres
 *  an hour from the south-west". `imperial`: Fahrenheit and miles an hour (US English). */
export function weatherSentence(r, imperial = false) {
  const out = [];
  if (Number.isFinite(r.temp)) out.push(imperial ? `${Math.round(r.temp * 9 / 5 + 32)} degrees Fahrenheit` : `${Math.round(r.temp)} degrees Celsius`);
  const sky = skyWords(r); if (sky) out.push(sky);
  if (Number.isFinite(r.speed)) out.push(r.speed < 0.5 ? 'calm' : `wind ${imperial ? Math.round(r.speed * 2.23694) + ' miles' : Math.round(r.speed * 3.6) + ' kilometres'} an hour from the ${compass(r.from)}`);
  return out.join(', ');
}
