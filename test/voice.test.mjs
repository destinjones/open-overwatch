// Voice (src/core/voicecmd.js): picking from a spoken list, weather questions, counting over a place, weather in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, weatherSentence, skyWords } from '../src/core/voicecmd.js';

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
