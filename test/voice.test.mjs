// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Voice (src/core/voicecmd.js): picking from a spoken list, weather questions, counting over a place, weather in words,
// the main commands in Hindi, and which language the recogniser listens in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, weatherSentence, skyWords, romanize, voiceLangs, EXAMPLES_HI } from '../src/core/voicecmd.js';

test('the second one: picks from what the last answer listed', () => {
  for (const [t, n] of [['the second one', 2], ['number three', 3], ['open the first one', 1], ['two', 2], ['select the 4th', 4], ['pick 5', 5]]) assert.deepEqual(parse(t), { act: 'pick', n }, t);
  assert.equal(parse('turn on the second layer').act, 'layer');
});

test('weather questions: here, or a named place; "show me the weather" still opens weather mode', () => {
  assert.deepEqual(parse("What's the weather here?"), { act: 'weather' });
  assert.deepEqual(parse('what is the weather like in Paris'), { act: 'weather', place: 'paris' });
  assert.deepEqual(parse('Is it raining in London?'), { act: 'weather', place: 'london' });
  assert.deepEqual(parse('how cold is it here'), { act: 'weather' });
  assert.deepEqual(parse('weather in Tokyo'), { act: 'weather', place: 'tokyo' });
  assert.deepEqual(parse('show me the weather'), { act: 'view', go: 'weather' });
});

test('counting: in view, or over a place, for every kind the globe holds', () => {
  assert.deepEqual(parse('How many satellites are in view?'), { act: 'count', what: 'sat' });
  assert.deepEqual(parse('how many planes over Texas'), { act: 'count', what: 'air', place: 'texas' });
  assert.deepEqual(parse('how many satellites are above Japan right now'), { act: 'count', what: 'sat', place: 'japan' });
  assert.deepEqual(parse('how many ships are in the Baltic'), { act: 'count', what: 'ship', place: 'baltic' });
  assert.deepEqual(parse('how many buses in Boston'), { act: 'count', what: 'transit', place: 'boston' });
  assert.deepEqual(parse('how many earthquakes in Chile'), { act: 'count', what: 'quake', place: 'chile' });
  assert.deepEqual(parse('how many military planes'), { act: 'count', what: 'mil' });
});

test('weather in words: metric, or Fahrenheit and miles an hour', () => {
  assert.equal(weatherSentence({ temp: 14.2, speed: 5, from: 225, cloud: 70, rain: 0.5 }), '14 degrees Celsius, light rain, wind 18 kilometres an hour from the south-west');
  assert.equal(weatherSentence({ temp: 14.2, speed: 5, from: 225, code: 61 }, true), '58 degrees Fahrenheit, light rain, wind 11 miles an hour from the south-west');
  assert.equal(weatherSentence({ temp: -3, speed: 0.2, from: 0, cloud: 100, rain: 1.2 }), '-3 degrees Celsius, snow, calm');
  assert.equal(skyWords({ cloud: 50 }), 'partly cloudy'); assert.equal(skyWords({ code: 95 }), 'thunderstorms'); assert.equal(skyWords({}), '');
});

test('voice: an airport\'s own weather report and its runways', () => {
  assert.deepEqual(parse('METAR at Heathrow'), { act: 'airwx', place: 'heathrow', what: 'metar' });
  assert.deepEqual(parse("What's the weather at Denver airport?"), { act: 'airwx', place: 'denver', what: 'metar' });
  assert.deepEqual(parse('TAF for JFK'), { act: 'airwx', place: 'jfk', what: 'taf' });
  assert.deepEqual(parse('Which runway is Heathrow using?'), { act: 'airwx', place: 'heathrow', what: 'runway' });
  assert.deepEqual(parse('runways at Denver'), { act: 'airwx', place: 'denver', what: 'runway' });
  assert.notEqual(parse("What's the weather in Paris?").act, 'airwx', 'a city\'s weather stays the weather');
  assert.equal(parse('arrivals at Heathrow').act, 'board');
});

test('Hindi: go to a place, in the order Hindi says it, with the name in Latin letters for the search', () => {
  assert.deepEqual(parse('मुझे टोक्यो ले चलो'), { act: 'go', place: 'tokyo' });
  assert.deepEqual(parse('टोक्यो पर जाओ'), { act: 'go', place: 'tokyo' });
  assert.deepEqual(parse('ओवरवॉच, कृपया दिल्ली ले चलो'), { act: 'go', place: 'delhi' }, 'wake word and please go');
  assert.deepEqual(parse('मुंबई दिखाओ'), { act: 'go', place: 'mumbai' });
  assert.deepEqual(parse('जयपुर कहाँ है?'), { act: 'go', place: 'jaipur' });
  assert.deepEqual(parse('काठमांडू जाओ'), { act: 'go', place: 'kathmandu' });
  assert.deepEqual(parse('चाँद दिखाओ'), { act: 'go', place: 'the moon' });
  assert.deepEqual(parse('Tokyo ले चलो'), { act: 'go', place: 'tokyo' }, 'a Latin word in a Hindi sentence');
});

test('Hindi: layers on and off (satellites, quakes, storms, planes, ships)', () => {
  assert.deepEqual(parse('सैटेलाइट दिखाओ'), { act: 'layer', name: 'satellites', on: true });
  assert.deepEqual(parse('सभी उपग्रह छिपाओ'), { act: 'layer', name: 'satellites', on: false });
  assert.deepEqual(parse('भूकंप बंद करो'), { act: 'layer', name: 'earthquakes', on: false });
  assert.deepEqual(parse('भूकंप चालू करो'), { act: 'layer', name: 'earthquakes', on: true });
  assert.deepEqual(parse('तूफ़ान दिखाइए'), { act: 'layer', name: 'storms', on: true }, 'with a nukta');
  assert.deepEqual(parse('तूफान दिखाइए'), { act: 'layer', name: 'storms', on: true }, 'and without');
  assert.deepEqual(parse('हवाई जहाज दिखाओ'), { act: 'layer', name: 'planes', on: true }, 'a plane is not a ship');
  assert.deepEqual(parse('जहाज़ हटाओ'), { act: 'layer', name: 'ships', on: false });
});

test('Hindi: the weather, tonight, look up, zoom, the ISS, help', () => {
  assert.deepEqual(parse('मौसम दिखाओ'), { act: 'view', go: 'weather' });
  assert.deepEqual(parse('मौसम कैसा है?'), { act: 'weather' });
  assert.deepEqual(parse('यहाँ का मौसम कैसा है'), { act: 'weather' });
  assert.deepEqual(parse('पेरिस में मौसम कैसा है'), { act: 'weather', place: 'paris' });
  assert.deepEqual(parse('आज रात क्या दिखेगा'), { act: 'view', go: 'tonight' });
  assert.deepEqual(parse('आज रात का मौसम कैसा रहेगा'), { act: 'weather' }, 'tonight\'s weather is the weather');
  assert.deepEqual(parse('ऊपर देखो'), { act: 'view', go: 'lookup' });
  assert.deepEqual(parse('ज़ूम इन'), { act: 'zoom', dir: 'in' });
  assert.deepEqual(parse('ज़ूम आउट करो'), { act: 'zoom', dir: 'out' });
  assert.deepEqual(parse('और पास लाओ'), { act: 'zoom', dir: 'in' });
  assert.deepEqual(parse('आईएसएस दिखाओ'), { act: 'go', place: 'iss' });
  assert.deepEqual(parse('ISS दिखाओ'), { act: 'go', place: 'iss' });
  assert.deepEqual(parse('अंतरिक्ष स्टेशन कहाँ है'), { act: 'go', place: 'iss' });
  assert.deepEqual(parse('आईएसएस को ट्रैक करो'), { act: 'track', what: 'iss' });
  assert.deepEqual(parse('मदद'), { act: 'help' });
  assert.deepEqual(parse('कुछ भी नहीं'), { act: 'unknown', text: 'कुछ भी नहीं' }, 'not a command: unknown, with what was heard');
  for (const e of EXAMPLES_HI) assert.notEqual(parse(e).act, 'unknown', e);
});

test('Hindi does not change English', () => {
  assert.deepEqual(parse('Take me to Tokyo'), { act: 'go', place: 'tokyo' });
  assert.deepEqual(parse('hide the satellites'), { act: 'layer', name: 'satellites', on: false });
  assert.deepEqual(parse('zoom in'), { act: 'zoom', dir: 'in' });
  assert.deepEqual(parse("what's above me tonight"), { act: 'view', go: 'tonight' });
});

test('romanize: Devanagari names in the letters English writes them with', () => {
  for (const [d, l] of [['टोक्यो', 'tokyo'], ['मुंबई', 'mumbai'], ['कोलकाता', 'kolkata'], ['दुबई', 'dubai'], ['कमल', 'kamal'], ['चंडीगढ़', 'chandigarh'],
    ['भोपाल', 'bhopal'], ['ज़िम्बाब्वे', 'zimbabve'], ['काठमांडू', 'kathmandu'], ['नई दिल्ली', 'nai dilli']]) assert.equal(romanize(d), l, d);
  assert.equal(romanize('Tokyo'), 'tokyo');
});

test('the recogniser listens in a language parse() reads: English as the browser says it, Hindi, else English', () => {
  assert.deepEqual(voiceLangs(['en-GB']), { listen: 'en-GB', speak: 'en-GB', words: 'en' });
  assert.deepEqual(voiceLangs(['hi-IN']), { listen: 'hi-IN', speak: 'en-IN', words: 'hi' }, 'answers stay English');
  assert.deepEqual(voiceLangs('hi'), { listen: 'hi-IN', speak: 'en-IN', words: 'hi' });
  assert.deepEqual(voiceLangs(['fr-FR']), { listen: 'en-US', speak: 'en-US', words: 'en' }, 'French: nothing parse() reads, so English');
  assert.deepEqual(voiceLangs(['ta-IN']), { listen: 'en-IN', speak: 'en-IN', words: 'en' }, 'Tamil in India: Indian English');
  assert.deepEqual(voiceLangs(['de-DE', 'en-GB']), { listen: 'en-GB', speak: 'en-GB', words: 'en' }, 'the first language it reads');
  assert.deepEqual(voiceLangs(['mr-IN', 'hi-IN']), { listen: 'hi-IN', speak: 'en-IN', words: 'hi' });
  assert.deepEqual(voiceLangs([]), { listen: 'en-US', speak: 'en-US', words: 'en' });
});
