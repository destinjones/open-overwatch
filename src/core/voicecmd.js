// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
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
//   { act: 'measure', from?, to, road }   "measure from Paris to Berlin", "how far is Tokyo", "driving distance from A to B"
//   { act: 'outline', place, area? }      "outline France", "show the border of Japan", "how big is Brazil" (area: true)
//   { act: 'draw', mode | on: false | finish }   "draw an area", "measure a distance", "stop drawing", "finish"
//   { act: 'pin', place? }       "drop a pin" (where the pointer rests), "drop a pin on Rome"
//   { act: 'undoDraw' | 'clearDraw' | 'drawInfo' }   "undo", "clear the drawing", "how long is it"
// Hindi too, for the main commands (parseHindi below): "मुझे टोक्यो ले चलो", "सैटेलाइट दिखाओ", "ज़ूम इन".

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
  return String(text || '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[’']/g, "'").replace(/[^a-z0-9' &-]+/g, ' ')   // "Zürich" -> "zurich", not "z rich": the marks go, the letters stay
    .replace(/^\s*(hey |ok |okay )?(overwatch|open overwatch|computer)\b[ ,]*/, '')
    .replace(/\b(please|can you|could you|would you|i want to|i'd like to|let's|lets|just|now)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const onOff = s => OFF.test(s) ? false : ON.test(s) ? true : null;
const ORDINAL = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4, fifth: 5, '5th': 5, five: 5, sixth: 6, six: 6 };
const COUNTED = [[/sat/, 'sat'], [/quake/, 'quake'], [/military/, 'mil'], [/plane|aircraft|flight|jet/, 'air'], [/ship|boat|vessel/, 'ship'], [/bus|train|tram|metro|vehicle/, 'transit'], [/camera/, 'cam']];
const HERE = /^(here|there|now|right|right now|today|outside)$/;
const clean = s => s.replace(/^(the|a|an|to|at|on|over)\s+/, '').replace(/\s+(please|now|for me|right now)$/, '').trim();

// ---- draw and measure (checked first: "stop drawing" is not "stop", "draw a line from A to B" is not a route)
const DRAWN = 'drawings?|measurements?|measures?|lines?|outlines?|borders?|pins?|markers?|areas?|shapes?|arrows?|sketch(?:es)?|polygons?|ruler';
const MODES = [[/^(pins?|markers?|points?)$/, 'pin'], [/^(lines?|paths?|ruler|length)$/, 'line'], [/^(areas?|polygons?|shapes?|regions?|zones?|fields?)$/, 'area'], [/^(distances?|arrows?|distance arrows?)$/, 'arrow']];
const modeOf = w => (MODES.find(([re]) => re.test(w)) || [])[1];
function drawCommand(s) {
  let m;
  if (new RegExp(`^(clear|erase|delete|remove|wipe|reset)( all| everything)?( (the|my|this|that|those|these|all|every))? (${DRAWN})$`).test(s) || /^(clear|erase)( (it|all|everything|that))?$/.test(s)) return { act: 'clearDraw' };
  if (/^(undo|undo (that|it|the last (point|one|pin))|remove the last (point|pin)|take that back)$/.test(s)) return { act: 'undoDraw' };
  if (/^(stop|end|quit|exit|leave|close) (the )?(drawing|measuring|measurement|ruler|draw mode|drawing mode|measure tool|measuring tool)$|^(i'm )?done (drawing|measuring)$/.test(s)) return { act: 'draw', on: false };
  if (/^(finish|finish (it|that|the (line|area|shape|drawing))|done|close (it|the (area|shape|loop))|that's it)$/.test(s)) return { act: 'draw', finish: true };
  if (/^(how (far|long|big|large) is (it|that|this|the (line|drawing|area|shape))|what('s| is) the (length|total|area|distance)( of (it|that|this|the (line|drawing|area|shape)))?)$/.test(s)) return { act: 'drawInfo' };
  if (/^(measure|how far|distance|what('s| is) the (driving |road )?distance|driving distance|road distance|(draw|make|put)( a| an| the)? (straight )?(line|arrow|ruler) (from|between))\b/.test(s)) {
    const road = /\b(by (road|car)|driving|drive|road distance|on the roads?)\b/.test(s);
    const t = s.replace(/\b(by (road|car)|driving|to drive|on the roads?)\b/g, ' ').replace(/\broad (?=distance)/, '').replace(/\s+/g, ' ').trim();
    if ((m = t.match(/\b(?:from|between) (.+?) (?:to|and) (.+)$/))) return { act: 'measure', from: clean(m[1]), to: clean(m[2]), road };
    if ((m = t.match(/^how far (?:away )?is (.+?) from (.+)$/))) return { act: 'measure', from: clean(m[2]), to: clean(m[1]), road };
    if ((m = t.match(/^(?:how far (?:away )?is(?: it)?(?: to)?|distance to|measure the distance to|measure to) (.+)$/)) && !/^(this|that|it|here|there)$/.test(m[1])) return { act: 'measure', to: clean(m[1]), road };
    if ((m = t.match(/^measure(?: (?:a|an|the|my))? (.+)$/)) && modeOf(m[1])) return { act: 'draw', mode: modeOf(m[1]) };
    if ((m = t.match(/^measure (.+?) to (.+)$/))) return { act: 'measure', from: clean(m[1]), to: clean(m[2]), road };
    if (/^measur(e|ing)$/.test(t)) return { act: 'draw', mode: 'line' };
  }
  if ((m = s.match(/^(?:outline|trace)(?: the)?(?: (?:outline|borders?|boundar(?:y|ies)) of)? (.+)$/) || s.match(/^(?:draw|show|highlight|mark|give)(?: me)?(?: the)? (?:outline|borders?|boundar(?:y|ies)|shape|frontiers?) (?:of|for|around) (.+)$/) || s.match(/^highlight (.+)$/))) return { act: 'outline', place: clean(m[1]) };
  if ((m = s.match(/^(?:how big|how large|what size|what's the size of|what is the size of|what's the area of|what is the area of)(?: is)? (.+)$/))) return { act: 'outline', place: clean(m[1]), area: true };
  if ((m = s.match(/^(?:drop|place|put|add|stick)(?: a| the| one)? (?:pin|marker)(?: (?:on|at|in|over|near) (.+?))?(?: (?:here|there))?$/))) { const p = m[1] && !HERE.test(m[1]) ? clean(m[1]) : null; return p ? { act: 'pin', place: p } : { act: 'pin' }; }
  if ((m = s.match(/^(?:draw|start|make|add|create|begin)(?: a| an| the| new)? (pins?|markers?|lines?|paths?|ruler|areas?|polygons?|shapes?|regions?|distances?|arrows?|distance arrows?)(?: on the (?:map|globe))?$/))) return { act: 'draw', mode: modeOf(m[1]) };
  if (/^((start|begin|open|show) )?(the )?(drawing|draw|measuring|measure|ruler)( (mode|tool|tools))?$/.test(s)) return { act: 'draw', mode: 'line' };
  return null;
}

// aviation: an airport's board ("arrivals at Heathrow", "what's taking off from JFK?"), what a plane is, trails
function airCommand(s) {
  let m = s.match(/^(?:show (?:me )?|open |give me |get )?(?:the )?(arrivals?|departures?|board|airport board|flights?|traffic|planes?) (?:at|for|from|of|in|into|out of|around) (.+?)(?: airport)?$/);
  if (m && !/^(here|there|the airport|this airport)$/.test(m[2])) return { act: 'board', place: clean(m[2]), which: /^arriv/.test(m[1]) ? 'arriving' : /^depart/.test(m[1]) ? 'departing' : null };
  m = s.match(/^what(?:'s| is| are)? (landing|arriving|coming in|taking off|departing|leaving|flying) (?:at|from|in|into|out of|over) (.+?)(?: airport)?$/);
  if (m) return { act: 'board', place: clean(m[2]), which: /land|arriv|coming/.test(m[1]) ? 'arriving' : /tak|depart|leav/.test(m[1]) ? 'departing' : null };
  // an airport's own weather report or its runways: "METAR at Heathrow", "weather at Denver airport", "which runway is JFK using?"
  m = s.match(/^(?:what(?:'s| is) )?(?:the )?(?:(?:latest |current )?(metar|taf|airport weather|aviation weather|flight category)) (?:at|for|in|of) (.+?)(?: airport)?$/)
    || s.match(/^(?:what(?:'s| is) )?(?:the )?(weather) (?:like )?(?:at|for|in) (.+?) airport$/);
  if (m) return { act: 'airwx', place: clean(m[2]), what: m[1] === 'taf' ? 'taf' : 'metar' };
  m = s.match(/^(?:which|what) runways? (?:is|are|does) (.+?)(?: airport)? (?:using|use|landing on|in use)$/) || s.match(/^(?:the )?runways? (?:in use )?(?:at|for) (.+?)(?: airport)?$/);
  if (m) return { act: 'airwx', place: clean(m[1]), what: 'runway' };
  m = s.match(/^(?:show (?:me )?|open )(?:the )?(.+?) airport(?: board)?$/);
  if (m) return { act: 'board', place: clean(m[1]), which: null };
  if (/^what (?:kind|type|sort) of (?:plane|aircraft|jet|airplane|helicopter) is (?:that|this|it)\b|^what (?:plane|aircraft|jet|airplane) is (?:that|this|it)\b|^where is (?:that|this|it) (?:plane |flight )?(?:going|flying|headed|heading)\b/.test(s)) return { act: 'what' };
  m = s.match(/^(show|hide|turn on|turn off|switch on|switch off|clear)? ?(?:the |all )?(?:flight |plane |aircraft )?trails?( on| off)?$/);
  if (m && (m[1] || m[2])) return { act: 'trails', on: !/hide|off|clear/.test((m[1] || '') + (m[2] || '')) };
  return null;
}

// ---- Hindi (हिन्दी): the main commands, for a browser set to Hindi (voice.js then listens in hi-IN). The recogniser
// writes Devanagari, English loanwords included ("सैटेलाइट", "ज़ूम इन"), sometimes with a Latin word or two. Hindi puts
// the verb last: "मुझे टोक्यो ले चलो" (take me to Tokyo), "सैटेलाइट दिखाओ" (show the satellites), "भूकंप बंद करो"
// (earthquakes off). The actions are the English ones; places come out in Latin letters (romanize) for the search.
const DEV = /[ऀ-ॿ]/;
/** Hindi text folded for matching: no nukta (ज़ → ज), chandrabindu as anusvara (ँ → ं), no punctuation, wake word or politeness. */
function foldHi(text) {
  return String(text || '').normalize('NFD').replace(/़/g, '').replace(/ँ/g, 'ं').normalize('NFC').toLowerCase()
    .replace(/[।॥?!.,;:"“”‘’'()]+/g, ' ')
    .replace(/^\s*(?:हे |ओके |hey |ok )?(?:ओपन ओवरवॉच|ओवरवॉच|open overwatch|overwatch)(?= |$)/, '')
    .replace(/(?:^| )(?:कृपया|प्लीज|please|जरा|जी|अब)(?= |$)/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const HI_SHOW = 'दिखाओ|दिखाइए|दिखाइये|दिखाएं|दिखाये|दिखा दो|दिखा दीजिए|दिखाना|दिखा|चालू करो|चालू करें|चालू कीजिए|चालू कर दो|चालू|ऑन करो|ऑन करें|ऑन कर दो|ऑन|खोलो|खोलें|खोलिए|शो करो|show|on';
const HI_HIDE = 'छिपाओ|छिपाइए|छिपाएं|छिपा दो|छुपाओ|छुपाइए|छुपाएं|छुपा दो|हटाओ|हटाइए|हटाएं|हटा दो|बंद करो|बंद करें|बंद कीजिए|बंद कर दो|बंद|ऑफ करो|ऑफ करें|ऑफ कर दो|ऑफ|hide|off';
// the layers by their Hindi names, in the order they are tried ("हवाई जहाज", a plane, before "जहाज", a ship); name: what voice.js's findLayers knows
const HI_LAYERS = [
  ['planes', 'हवाई जहाजों|हवाई जहाज|विमानों|विमान|प्लेन्स|प्लेन|फ्लाइट्स|फ्लाइट|planes|flights'],
  ['ships', 'पानी के जहाज|जहाजों|जहाज|शिप्स|शिप|ships'],
  ['satellites', 'सैटेलाइट्स|सैटेलाइटों|सैटेलाइट|सेटेलाइट्स|सेटेलाइटों|सेटेलाइट|सैटलाइट|उपग्रहों|उपग्रह|satellites|satellite|sats'],
  ['earthquakes', 'भूकंपों|भूकंप|भूकम्पों|भूकम्प|भूचाल|अर्थक्वेक|earthquakes|quakes'],
  ['storms', 'तूफानों|तूफान|चक्रवातों|चक्रवात|आंधी|स्टॉर्म्स|स्टॉर्म|हरिकेन|साइक्लोन|storms'],
].map(([name, words]) => [name, new RegExp(`^(?:(?:मुझे|हमें) )?(?:(?:सभी|सारे|सारी|सब) )?(?:${words})(?: को)? (${HI_SHOW}|${HI_HIDE})$`)]);
const HI_ON = new RegExp(`^(?:${HI_SHOW})$`);
const HI_HERE = /^(?:यहां|इधर|वहां|यहां का|अभी|आज|आज रात|कल|बाहर|मेरे यहां)$/;
// names said in Hindi whose English differs from the letters (the rest go through romanize)
const HI_TERMS = {
  'आईएसएस': 'iss', 'आई एस एस': 'iss', 'अंतरिक्ष स्टेशन': 'iss', 'स्पेस स्टेशन': 'iss', 'इंटरनेशनल स्पेस स्टेशन': 'iss', 'अंतरराष्ट्रीय अंतरिक्ष स्टेशन': 'iss',
  'हबल': 'hubble', 'चांद': 'the moon', 'चंद्रमा': 'the moon', 'चन्द्रमा': 'the moon', 'सौर मंडल': 'solar system', 'सौरमंडल': 'solar system', 'अंतरिक्ष': 'space',
  'भारत': 'india', 'हिंदुस्तान': 'india', 'इंडिया': 'india', 'अमेरिका': 'united states', 'अमरीका': 'united states', 'चीन': 'china', 'जापान': 'japan', 'रूस': 'russia',
  'इंग्लैंड': 'england', 'ब्रिटेन': 'united kingdom', 'फ्रांस': 'france', 'जर्मनी': 'germany', 'दिल्ली': 'delhi', 'नई दिल्ली': 'new delhi', 'लंदन': 'london',
  'पेरिस': 'paris', 'न्यूयॉर्क': 'new york', 'हैदराबाद': 'hyderabad', 'बैंगलोर': 'bangalore', 'बेंगलुरु': 'bengaluru', 'हिमालय': 'himalayas',
  'जयपुर': 'jaipur', 'लखनऊ': 'lucknow', 'वाराणसी': 'varanasi', 'अहमदाबाद': 'ahmedabad',
  'एवरेस्ट': 'mount everest', 'माउंट एवरेस्ट': 'mount everest', 'ताजमहल': 'taj mahal', 'ताज महल': 'taj mahal',
};
const HI_ISS = 'आईएसएस|आई एस एस|इंटरनेशनल स्पेस स्टेशन|अंतरराष्ट्रीय अंतरिक्ष स्टेशन|अंतरिक्ष स्टेशन|स्पेस स्टेशन|iss';
const placeOf = x => { x = x.trim(); return HI_TERMS[x] || (DEV.test(x) ? romanize(x) : x); };

// ---- Devanagari in Latin letters, the way names are written in English: consonants carry an "a" that Hindi drops at
// the end of a word and between a vowel-ended syllable and a consonant-vowel one (जयपुर → jaypur, कोलकाता → kolkata).
const CONS = { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n', 'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h' };
const NUKTA = { 'क': 'q', 'ख': 'kh', 'ग': 'g', 'ज': 'z', 'ड': 'r', 'ढ': 'rh', 'फ': 'f' };
const SIGN = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e', 'ॆ': 'e', 'ॊ': 'o' };
const VOWEL = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e' };
function romanWord(w) {
  const u = [], ch = [...w.normalize('NFD')];
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i], last = u[u.length - 1];
    if (CONS[c]) { const nk = ch[i + 1] === '़'; if (nk) i++; u.push({ c: nk ? NUKTA[c] || CONS[c] : CONS[c], v: 'a', auto: true, coda: '' }); }
    else if (c === '्') { if (last) { last.v = ''; last.auto = false; } }   // virama: no vowel
    else if (SIGN[c]) { if (last) { last.v = SIGN[c]; last.auto = false; } }
    else if (VOWEL[c]) u.push({ c: '', v: VOWEL[c], auto: false, coda: '' });
    else if (c === 'ं' || c === 'ँ') { if (last) last.coda += 'N'; }   // anusvara: n, or m before p, b, m (मुंबई → mumbai)
    else if (c === 'ः') { if (last) last.coda += 'h'; }
    else if (/[a-z0-9]/i.test(c)) u.push({ c: c.toLowerCase(), v: '', auto: false, coda: '' });
  }
  const n = u.length;
  if (n > 1 && u[n - 1].auto && !u[n - 1].coda) u[n - 1].v = '';
  for (let i = n - 2; i >= 1; i--) {
    const p = u[i - 1], x = u[i], q = u[i + 1];
    if (x.auto && x.c && !x.coda && p.v && !p.coda && q.c && q.v) { x.v = ''; i--; }
  }
  return u.map((x, i) => x.c + x.v + x.coda.replace(/N/g, () => /^[pbm]/.test((u[i + 1] || {}).c || '') ? 'm' : 'n')).join('');
}
/** Devanagari → Latin letters (words kept apart; Latin passes through): "टोक्यो" → "tokyo", "मुंबई" → "mumbai". */
export function romanize(text) {
  return String(text || '').split(/\s+/).filter(Boolean).map(w => DEV.test(w) ? romanWord(w) : w.toLowerCase()).join(' ');
}

/** A Hindi sentence → the same actions parse() gives for English, or null when it is none of the Hindi commands. */
function parseHindi(text) {
  const h = foldHi(text); let m;
  if (!h) return null;
  if (/^(?:मदद|सहायता|हेल्प)(?: (?:करो|करें|कीजिए|चाहिए))?$|^(?:मैं )?क्या (?:बोल|कह) (?:सकता|सकती) हूं$/.test(h)) return { act: 'help' };
  if (/^(?:जूम इन|zoom in)(?: (?:करो|करें|कीजिए|कर दो))?$|^(?:और )?(?:पास|नजदीक|करीब) (?:लाओ|जाओ|ले चलो|करो|आओ|दिखाओ)$|^बडा करो$/.test(h)) return { act: 'zoom', dir: 'in' };
  if (/^(?:जूम आउट|zoom out)(?: (?:करो|करें|कीजिए|कर दो))?$|^(?:और )?दूर (?:ले जाओ|जाओ|करो|हटो|से दिखाओ)$|^पीछे (?:जाओ|हटो)$|^छोटा करो$/.test(h)) return { act: 'zoom', dir: 'out' };
  // the weather: a question ("पेरिस में मौसम कैसा है?") is the weather there; "मौसम दिखाओ" opens weather mode
  if ((m = h.match(/^(?:(.+?) (?:में|का|की|के) )?(?:आज(?: रात)? )?मौसम (?:कैसा|क्या|बताओ|बताइए|बताएं)(?: (?:है|हे|रहेगा|हाल है))?$/))) {
    const place = m[1] && !HI_HERE.test(m[1]) ? placeOf(m[1]) : null; return place ? { act: 'weather', place } : { act: 'weather' };
  }
  if (new RegExp(`^(?:(?:मुझे|हमें) )?(?:मौसम|वेदर|बादल|बारिश|रडार)(?: (?:का नक्शा|मोड|मैप))?(?: को)?(?: (?:${HI_SHOW}))?$`).test(h)) return { act: 'view', go: 'weather' };
  if (/(?:^| )(?:आज रात|टुनाइट|tonight|मेरे ऊपर)(?: |$)/.test(h)) return { act: 'view', go: 'tonight' };
  if (/^(?:ऊपर|आसमान(?: में| की ओर| की तरफ)?|आकाश(?: में| की ओर| की तरफ)?) (?:देखो|देखें|देखिए|देखना)$|^(?:लुक अप|look up|स्काई मोड)(?: (?:करो|करें))?$/.test(h)) return { act: 'view', go: 'lookup' };
  for (const [name, re] of HI_LAYERS) if ((m = h.match(re))) return { act: 'layer', name, on: HI_ON.test(m[1]) };
  if ((m = h.match(/^(.+?)(?: को| का)? (?:ट्रैक|फॉलो|फोलो|track|follow)(?: (?:करो|करें|कीजिए|कर दो))?$/) || h.match(/^(.+?) का पीछा (?:करो|करें|कीजिए)$/))) return { act: 'track', what: placeOf(m[1]) };
  if (new RegExp(`^(?:${HI_ISS})(?: को)? (?:${HI_SHOW})$`).test(h)) return { act: 'go', place: 'iss' };
  if ((m = h.match(/^(?:(?:मुझे|हमें) )?(.+?)(?: (?:पर|में|तक|की ओर|की तरफ|के पास))? (?:ले चलो|ले चलिए|ले चलें|ले जाओ|ले जाइए|ले जाएं|जाओ|जाइए|जाएं|चलो|चलिए|चलें|दिखाओ|दिखाइए|दिखाएं|दिखा दो|दिखाना|दिखा|ढूंढो|ढूंढें|खोजो|खोजें)$/)
    || h.match(/^(.+?) (?:कहां|किधर) (?:है|हैं)$/))) return { act: 'go', place: placeOf(m[1]) };
  return null;
}

/** Phrases for the help card in Hindi. */
export const EXAMPLES_HI = Object.freeze(['मुझे टोक्यो ले चलो', 'सैटेलाइट दिखाओ', 'भूकंप बंद करो', 'आईएसएस ट्रैक करो', 'आज रात क्या दिखेगा', 'पेरिस में मौसम कैसा है', 'ज़ूम इन']);
/** The languages parse() understands. */
export const COMMAND_LANGS = Object.freeze(['en', 'hi']);
const EN_REGIONS = new Set(['US', 'GB', 'IN', 'AU', 'CA', 'NZ', 'IE', 'ZA', 'SG', 'PH', 'NG', 'KE', 'PK', 'GH', 'LK', 'BD', 'MY']);
/**
 * Which language to listen and answer in, from the browser's languages (navigator.languages, first choice first):
 * { listen, speak, words }. The first language parse() understands wins: English as the browser says it, Hindi
 * heard in hi-IN (answers stay English, in an Indian English voice). With neither, English for the first language's
 * country (Tamil in India → en-IN), else en-US: a recogniser set to a language parse() can't read hears nothing useful.
 */
export function voiceLangs(langs) {
  const list = (Array.isArray(langs) ? langs : [langs]).map(l => String(l || '').trim().replace('_', '-')).filter(Boolean);
  for (const l of list) {
    const base = l.split('-')[0].toLowerCase();
    if (base === 'en') return { listen: l, speak: l, words: 'en' };
    if (base === 'hi') return { listen: 'hi-IN', speak: 'en-IN', words: 'hi' };
  }
  const r = ((list[0] || '').split('-')[1] || '').toUpperCase(), en = EN_REGIONS.has(r) ? `en-${r}` : 'en-US';
  return { listen: en, speak: en, words: 'en' };
}

export function parse(text) {
  if (DEV.test(text || '')) { const h = parseHindi(text); if (h) return h; if (!normalize(text)) return { act: 'unknown', text: foldHi(text) }; }
  const s = normalize(text);
  if (!s) return { act: 'unknown', text: '' };
  if (/^(help|what can i (say|do)|commands|what do you do)\b/.test(s)) return { act: 'help' };
  const drawn = drawCommand(s); if (drawn) return drawn;
  const air = airCommand(s); if (air) return air;
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
    return place && !/^(view|sight|the view|frame|the frame|the picture|the sky|sky|range|my view|screen|the screen|air|the air|me|us|here|there|out there|up there|space|orbit|total|all|the world|earth|the earth|the planet)$/.test(place) ? { act: 'count', what, place } : { act: 'count', what };   // "in the air", "above me": not places
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
  'Measure from Paris to Berlin', 'Outline France', 'How big is Brazil?', 'Draw an area', 'Clear the drawing',
  'Arrivals at Heathrow', "What's taking off from JFK?", 'What plane is that?', 'METAR at Denver', 'Which runway is Heathrow using?',
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
/** The sea in a word from significant wave height (m), the Douglas sea-state scale ("" for no reading). */
export function seaWords(m) {
  if (!Number.isFinite(m)) return '';
  return m < 0.1 ? 'calm' : m < 0.5 ? 'smooth' : m < 1.25 ? 'slight' : m < 2.5 ? 'moderate' : m < 4 ? 'rough' : m < 6 ? 'very rough' : m < 9 ? 'high' : m < 14 ? 'very high' : 'phenomenal';
}
/**
 * A reading { temp °C, speed m/s, from (deg), cloud %, rain mm/h, code, gust m/s, pres hPa, wave m, waveFrom (deg) }
 * spoken: "14 degrees Celsius, light rain, wind 18 kilometres an hour from the south-west, gusting 40, pressure 1008
 * hectopascals and falling, a rough sea, waves 3 metres from the west". `imperial`: Fahrenheit, miles an hour, inches
 * of mercury and feet (US English). Gusts are said only when they matter (well above the wind, and strong).
 */
export function weatherSentence(r, imperial = false) {
  const out = [], spd = v => imperial ? Math.round(v * 2.23694) : Math.round(v * 3.6);
  if (Number.isFinite(r.temp)) out.push(imperial ? `${Math.round(r.temp * 9 / 5 + 32)} degrees Fahrenheit` : `${Math.round(r.temp)} degrees Celsius`);
  const sky = skyWords(r); if (sky) out.push(sky);
  if (Number.isFinite(r.speed)) out.push(r.speed < 0.5 ? 'calm' : `wind ${spd(r.speed)} ${imperial ? 'miles' : 'kilometres'} an hour${Number.isFinite(r.from) ? ` from the ${compass(r.from)}` : ''}`
    + (Number.isFinite(r.gust) && r.gust >= 10 && r.gust > 1.4 * (r.speed || 0) ? `, gusting ${spd(r.gust)}` : ''));
  if (Number.isFinite(r.pres)) {
    const trend = Number.isFinite(r.presTrend) && Math.abs(r.presTrend) >= 1 ? (r.presTrend < 0 ? ' and falling' : ' and rising') : '';   // hPa over the next 3 hours
    out.push(imperial ? `pressure ${(r.pres * 0.02953).toFixed(2)} inches${trend}` : `pressure ${Math.round(r.pres)} hectopascals${trend}`);
  }
  if (Number.isFinite(r.wave)) {
    const sea = seaWords(r.wave), h = imperial ? `${Math.round(r.wave * 3.28084)} feet` : `${r.wave < 2 ? r.wave.toFixed(1) : Math.round(r.wave)} metres`;
    out.push(`${sea === 'calm' ? 'a calm sea' : `a ${sea} sea, waves ${h}`}${Number.isFinite(r.waveFrom) && r.wave >= 0.1 ? ` from the ${compass(r.waveFrom)}` : ''}`);
  }
  return out.join(', ');
}
