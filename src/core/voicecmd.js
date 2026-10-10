// Spoken commands for the globe, without an AI service: a sentence in, one action out. Pure (no DOM), so Node tests it.
// The globe's voice.js listens with the browser's own speech recognition and runs what this returns:
//   { act: 'sensor', mode }      night vision, thermal, CRT, noir, normal
//   { act: 'hud' | 'detect' | 'cockpit', on: true | false | null (toggle) }
//   { act: 'go', place }         "take me to Tokyo", "show me the ISS" (the globe decides: satellite, view, layer or a place)
//   { act: 'track', what }       "track the ISS", "follow Hubble", "lock on to the space station"
//   { act: 'layer', name, on }   "turn on earthquakes", "hide the satellites"
//   { act: 'view', go }          "what's above me tonight", "open the solar system", "play the tour"
//   { act: 'reset' | 'north' | 'topdown' | 'stop' | 'what' | 'help' | 'live' | 'pause' }
//   { act: 'zoom', dir: 'in' | 'out' }   { act: 'faster' }   { act: 'count', what }   { act: 'unknown', text }

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
  let m = s.match(/^how many (satellites|sats|planes|aircraft|flights|military( aircraft| planes| flights)?|earthquakes|quakes|things|objects|targets|contacts)\b/);
  if (m) return { act: 'count', what: /sat/.test(m[1]) ? 'sat' : /quake/.test(m[1]) ? 'quake' : /military/.test(m[1]) ? 'mil' : /plane|aircraft|flight/.test(m[1]) ? 'air' : 'all' };
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
  'Take me to Tokyo', 'Track the ISS', 'Night vision', 'Thermal', 'Enter cockpit', 'Turn on earthquakes',
  'How many satellites are in view?', "What's this?", 'Show me the launches', 'Zoom out to a globe view',
]);
