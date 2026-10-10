// World radio: the best-voted geolocated stations in the radio-browser.info community directory as dots on the globe,
// a details card with Play / Stop, and an analog tuner whose needle steps through the stations near the view centre,
// west to east, playing each one and flying the globe to the broadcaster. Keyless, and the API sends CORS headers.
// Nothing is fetched until the layer is first switched on; the list is then kept 12 h in Cache Storage. Only https
// streams are listed (an http stream on an https page is blocked as mixed content). Streams belong to their broadcasters.
// Per frame: nothing. The tuner re-scans only when a camera move ends (camera.moveEnd), and only while it is open.
import { C, $, esc, fmt, toast, PHONE, bigStore, getJSON } from './env.js';
import { scene, camera, camHeight } from './viewer.js';
import { state } from './state.js';
import { release } from './follow.js';
import { cleanStations, tunerSet, dialPos, dialIndex } from '../core/radio.js';

const HOSTS = ['all', 'de1', 'de2'];   // as the 2D map: all.api… resolves to the live mirrors; de1/de2 are named fallbacks
const COLOR = '#ff6fd8';
const MAX = PHONE ? 1500 : 3000;       // the API can't trim fields: ~1.25 kB a station, uncompressed
const CACHE_KEY = 'radio.v1', CACHE_MS = 12 * 3600e3;
const DIAL_N = PHONE ? 24 : 40;        // detents on the dial
const COMMIT_MS = 260;                 // a detent held this long (or let go on) tunes in: a fast sweep only plays where it stops
const FLY_S = 1.2, FLY_MAX_H = 2.0e6;
const CAN_HLS = (() => { try { return !!document.createElement('audio').canPlayType('application/vnd.apple.mpegurl'); } catch (e) { return false; } })();
const MEDIA_ERR = { 1: 'stopped', 2: 'network error', 3: 'could not decode it', 4: 'format or server refused' };

const pts = scene.primitives.add(new C.PointPrimitiveCollection());
pts.show = false;
const DOT = C.Color.fromCssColorString(COLOR), DIM = DOT.withAlpha(0.8), RIM = C.Color.BLACK.withAlpha(0.45), WHITE = C.Color.WHITE;
const SIZE = PHONE ? 6 : 5;
const LIVE = new Set(['loading', 'buffering', 'playing']);
const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;

/** A station: the object a dot carries as its id, so ui.js can ask it for its hover tip and card. */
class Station {
  constructor(s) { Object.assign(this, s); this.kind = 'radio'; }
  get where() { return this.place && this.place !== this.country ? `${this.place}, ${this.country || this.cc}` : this.country || this.cc || ''; }
  get stream() { return [this.codec, this.bitrate ? this.bitrate + ' kbps' : ''].filter(Boolean).join(' · '); }
  tip() { return [this.name, this.where, this.stream].filter(Boolean).join(' · '); }   // plain text: ui.js sets textContent
  cardHtml() {
    const on = Radio.current === this && LIVE.has(Radio.status), hp = this.homepage;   // homepage: http(s) only (core/radio.js httpUrl)
    return `<div class="k" style="--c:${COLOR}">World radio${this.cc ? ' · ' + esc(this.cc) : ''}</div><h2>${esc(this.name)}</h2><dl>`
      + (this.place ? row('Where', this.place) : '') + (this.country ? row('Country', this.country) : '')
      + (this.tags.length ? row('Tags', this.tags.join(', ')) : '') + (this.stream ? row('Stream', this.stream) : '')
      + (this.language ? row('Language', this.language) : '') + row('Votes', fmt(this.votes)) + '</dl>'
      + `<div class="acts"><button class="chipbtn rd-cardplay" data-rd-play="1" style="color:${COLOR}">${on ? '■ Stop' : '▶ Play'}</button>`
      + (hp ? `<a class="chipbtn" href="${esc(hp)}" target="_blank" rel="noopener noreferrer">Homepage</a>` : '')
      + (Radio.layer.on && !Tuner.shown() ? '<button class="chipbtn" data-rd-tuner="1">Tuner</button>' : '') + '</div>'
      + '<div class="note" style="margin-top:8px">Listed by <a href="https://www.radio-browser.info/" target="_blank" rel="noopener">radio-browser.info</a> (community-edited; the dot is where the directory places it). The stream belongs to the broadcaster; some only play on their own site.</div>';
  }
  afterCard(card) {
    const p = card.querySelector('[data-rd-play]'), t = card.querySelector('[data-rd-tuner]');
    if (p) p.onclick = () => {
      Radio.toggle(this);
      if (Radio.current === this && LIVE.has(Radio.status) && Radio.layer.on) { Radio.userClosed = false; Tuner.show(); Tuner.focusOn(this); }
    };
    if (t) t.onclick = () => { Radio.userClosed = false; Tuner.show(); Tuner.focusOn(this); t.remove(); };
  }
}

export const Radio = {
  layer: { id: 'radio', group: 'Earth', name: 'World radio (radio-browser.info)', color: COLOR, on: false },
  list: [], host: '', loading: null, current: null, status: 'idle', audio: null, userClosed: false, clicked: new Set(), watchdog: 0, failedAt: 0,
  get count() { return this.list.length; },

  /** Show or hide the layer (main.js applyAll passes L.radio.on). The first time it is on, the stations load. */
  apply(on = this.layer.on) {
    on = !!on;
    // look-up mode hides ground layers for a while (main.js GROUND): hide the dots and the tuner, keep the sound
    if (!on && state.lookup && this.layer.on) { pts.show = false; Tuner.hide(); return Promise.resolve(); }
    const turnedOn = on && !this.layer.on;
    this.layer.on = on; pts.show = on; scene.requestRender();
    if (!on) { this.stop(); Tuner.hide(); return Promise.resolve(); }
    if (turnedOn) this.userClosed = false;
    const p = this.load();
    if (!this.userClosed) Tuner.show();
    return p;
  },

  load() {
    if (!this.loading && Date.now() - this.failedAt < 60e3) return Promise.resolve();   // applyAll runs on every dock click: don't hammer a dead directory
    if (!this.loading) this.loading = this.fetchList().then(list => { this.build(list); Tuner.rescan(); }).catch(e => {
      this.loading = null; this.failedAt = Date.now(); console.warn('radio', e); Tuner.say('Directory unreachable'); toast('The radio directory is unreachable right now; switch the layer on again later', 4500);
    });
    return this.loading;
  },
  async fetchList() {
    const hit = await bigStore.get(CACHE_KEY);
    if (hit && Date.now() - hit.t < CACHE_MS && hit.max === MAX && hit.hls === CAN_HLS && hit.list?.length) { this.host = hit.host; return hit.list; }
    let err;
    for (const h of HOSTS) {
      const host = h + '.api.radio-browser.info';
      try {
        const rows = await getJSON(`https://${host}/json/stations/search?has_geo_info=true&is_https=true&hidebroken=true&order=votes&reverse=true&limit=${MAX}`, { timeout: 40000 });
        const list = cleanStations(rows, { max: MAX, hls: CAN_HLS });
        if (!list.length) throw new Error('no stations');
        this.host = host; bigStore.set(CACHE_KEY, { t: Date.now(), host, max: MAX, hls: CAN_HLS, list });
        return list;
      } catch (e) { err = err || e; }   // a dead mirror looks like a CORS error to the browser: try the next
    }
    throw err || new Error('no mirror answered');
  },
  build(list) {
    pts.removeAll();
    this.list = list.map(s => new Station(s));
    for (const s of this.list) s.pt = pts.add({ position: C.Cartesian3.fromDegrees(s.lon, s.lat, 0), pixelSize: SIZE, color: DIM, outlineColor: RIM, outlineWidth: 1, id: s });
    const n = document.getElementById('n-radio'); if (n) n.textContent = fmt(this.list.length);
    scene.requestRender();
  },

  // ---- playback: one shared <audio>
  ensureAudio() {
    if (this.audio) return this.audio;
    const a = this.audio = new Audio(); a.preload = 'none';
    a.addEventListener('playing', () => { clearTimeout(this.watchdog); this.setStatus('playing'); });
    a.addEventListener('waiting', () => { if (this.status === 'playing') this.setStatus('buffering'); });
    a.addEventListener('error', () => {
      if (!a.getAttribute('src')) return;   // stop() empties it
      this.fail(MEDIA_ERR[a.error?.code] || 'stream error');
    });
    return a;
  },
  fail(why) {
    clearTimeout(this.watchdog); const st = this.current; this.setStatus('error');
    if (this.audio) { this.audio.removeAttribute('src'); this.audio.load(); }
    toast(`${st ? st.name : 'This station'} won't play here (${why}). Try the next one.`, 4500);
  },
  play(st) {
    const a = this.ensureAudio();
    this.current = st; this.mark(st); this.setStatus('loading');
    a.src = st.url;
    const p = a.play();
    if (p) p.catch(e => {
      if (e.name === 'AbortError' || this.current !== st) return;   // replaced by the next station
      if (e.name === 'NotAllowedError') { this.setStatus('idle'); toast('Press Play to start the sound (the browser waits for a click or tap)', 4000); }
      else this.fail(e.name === 'NotSupportedError' ? 'format or server refused' : e.message || e.name);
    });
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => { if (this.current === st && this.status === 'loading') this.fail('no answer in 15 s'); }, 15000);
    this.countClick(st);
  },
  stop() {
    clearTimeout(this.watchdog);
    if (!this.audio || this.status === 'idle') return;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    this.setStatus('idle');
  },
  toggle(st) { if (this.current === st && LIVE.has(this.status)) this.stop(); else this.play(st); },
  /** radio-browser asks clients to report each start of playback (it counts one per address, station and day). */
  countClick(st) {
    if (this.clicked.has(st.id)) return; this.clicked.add(st.id);
    fetch(`https://${this.host || 'all.api.radio-browser.info'}/json/url/${encodeURIComponent(st.id)}`).catch(() => {});
  },
  setStatus(s) {
    this.status = s; Tuner.sync();
    const b = document.querySelector('#card [data-rd-play]');
    if (b && state.selected?.kind === 'radio') b.textContent = state.selected === this.current && LIVE.has(s) ? '■ Stop' : '▶ Play';
  },
  /** The tuned station's dot stands out; the dial's set a little; the rest stay dim. */
  mark(st) {
    for (const s of this.list) if (s.pt && s.lit) { s.lit = 0; s.pt.pixelSize = SIZE; s.pt.color = DIM; s.pt.outlineColor = RIM; s.pt.outlineWidth = 1; }
    for (const { st: s } of Tuner.set) if (s.pt) { s.lit = 1; s.pt.pixelSize = SIZE + 2; s.pt.color = DOT; }
    if (st?.pt) { st.lit = 1; st.pt.pixelSize = SIZE + 7; st.pt.color = WHITE; st.pt.outlineColor = DOT; st.pt.outlineWidth = 3; }
    scene.requestRender();
  },
};

// ---- the analog tuner
let noise = null;   // a short burst of static between stations (Web Audio, made on the first drag: a user gesture)
function crackle() {
  try {
    if (!noise) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)(), buf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7; const g = ctx.createGain(); g.gain.value = 0.05;
      f.connect(g).connect(ctx.destination); noise = { ctx, buf, f };
    }
    if (noise.ctx.state === 'suspended') noise.ctx.resume();
    const s = noise.ctx.createBufferSource(); s.buffer = noise.buf; s.connect(noise.f); s.start();
  } catch (e) { /* no Web Audio: silent tuning */ }
}
const lonText = lon => `${Math.abs(lon).toFixed(1)}°${lon < 0 ? 'W' : 'E'}`;

function viewCentre() {
  const cv = scene.canvas, p = camera.pickEllipsoid(new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2), scene.globe.ellipsoid);
  const g = p ? C.Cartographic.fromCartesian(p) : camera.positionCartographic;
  return { lon: C.Math.toDegrees(g.longitude), lat: C.Math.toDegrees(g.latitude) };
}

export const Tuner = {
  el: null, set: [], idx: -1, pos: 0.5, anchor: null, flight: 0, flightNo: 0, timer: 0,
  shown() { return !!this.el && this.el.classList.contains('show'); },
  build() {
    if (this.el) return;
    const el = this.el = document.createElement('section');
    el.id = 'rdTuner'; el.className = 'glass'; el.setAttribute('aria-label', 'World radio tuner');
    el.innerHTML = '<div class="rd-head"><b>World radio</b><span class="rd-scan"></span><button class="rd-x" type="button" aria-label="Close the tuner and stop the sound" title="Close (stops the sound)">×</button></div>'
      + '<div class="rd-dial" tabindex="0" role="slider" aria-label="Station dial: left and right arrows change station" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">'
      + '<div class="rd-tag"><b></b><small></small></div><div class="rd-scale"><div class="rd-ticks"></div><span class="rd-w"></span><span class="rd-e"></span></div><div class="rd-needle"></div></div>'
      + '<div class="rd-ctl"><button class="rd-step" type="button" data-step="-1" aria-label="Previous station (west)">‹</button><span class="rd-led"></span><span class="rd-status"></span>'
      + '<button class="rd-play" type="button" aria-label="Play">▶</button><button class="rd-step" type="button" data-step="1" aria-label="Next station (east)">›</button></div>';
    document.body.append(el);
    this.dial = el.querySelector('.rd-dial'); this.needle = el.querySelector('.rd-needle'); this.tag = el.querySelector('.rd-tag');
    el.querySelector('.rd-x').onclick = () => { Radio.userClosed = true; Radio.stop(); this.hide(); };
    el.querySelector('.rd-play').onclick = () => this.playPause();
    for (const b of el.querySelectorAll('[data-step]')) b.onclick = () => this.step(+b.dataset.step, true);
    el.addEventListener('pointerdown', e => e.stopPropagation());
    // drag: the needle follows the pointer, the readout follows the detent under it, letting go snaps and tunes in
    let drag = false;
    const at = e => { const r = this.dial.getBoundingClientRect(); return (e.clientX - r.left - 14) / Math.max(1, r.width - 28); };
    this.dial.addEventListener('pointerdown', e => {
      if (!this.set.length) return; drag = true; try { this.dial.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ } this.dial.classList.add('drag');
      this.moveTo(at(e), false); e.preventDefault();
    });
    this.dial.addEventListener('pointermove', e => { if (drag) this.moveTo(at(e), false); });
    const end = () => { if (!drag) return; drag = false; this.dial.classList.remove('drag'); this.setNeedle(dialPos(this.idx, this.set.length)); this.commit(0); };
    this.dial.addEventListener('pointerup', end); this.dial.addEventListener('pointercancel', end); this.dial.addEventListener('lostpointercapture', end);
    this.dial.addEventListener('keydown', e => {
      const k = e.key, n = this.set.length; if (!n) return;
      const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[k];
      if (by) this.step(by, false);
      else if (k === 'Home') this.go(0, false); else if (k === 'End') this.go(n - 1, false);
      else if (k === 'Enter' || k === ' ') this.playPause();
      else return;
      e.preventDefault(); e.stopPropagation();   // the globe's own shortcuts stay out of it
    });
    camera.moveEnd.addEventListener(() => this.onMoveEnd());
  },
  show() { this.build(); if (!this.el.classList.contains('show')) { this.el.classList.add('show'); document.body.classList.add('rd-open'); this.rescan(); } },
  hide() { if (!this.el) return; this.el.classList.remove('show'); document.body.classList.remove('rd-open'); },
  say(text) { if (this.el) { this.el.querySelector('.rd-status').textContent = text; } },

  /** Pick the stations around `centre` (default: the view centre) and lay them out on the dial. */
  rescan(centre) {
    if (!this.el) return;
    if (!Radio.list.length) { this.set = []; this.render(); this.say(Radio.loading ? 'Loading stations…' : 'No stations'); return; }
    const c = centre || viewCentre(); this.anchor = c;
    this.set = tunerSet(Radio.list, c.lon, c.lat, { n: DIAL_N, perSpot: 3 });
    const cur = this.set.findIndex(x => x.st === Radio.current);
    let near = 0; this.set.forEach((x, i) => { if (x.km < this.set[near].km) near = i; });
    this.idx = cur >= 0 ? cur : near;
    this.render(); Radio.mark(Radio.current);
  },
  /** A camera move the user made (not our own flight) ends: re-scan if the view centre moved a fair way. */
  onMoveEnd() {
    if (this.flight) { this.flight = 0; return; }
    if (!this.shown() || !Radio.list.length || state.lookup) return;
    const c = viewCentre(), a = this.anchor;
    if (a) {
      const far = this.set.length ? this.set[this.set.length >> 1].km : 0, moved = Math.hypot((c.lat - a.lat) * 111, ((((c.lon - a.lon) % 360) + 540) % 360 - 180) * 111 * Math.cos(c.lat * Math.PI / 180));
      if (moved < Math.max(15, far * 0.35)) return;
    }
    this.rescan(c);
  },
  render() {
    const n = this.set.length, ticks = this.el.querySelector('.rd-ticks');
    ticks.replaceChildren(...this.set.map((x, i) => { const t = document.createElement('i'); t.style.left = (dialPos(i, n) * 100) + '%'; return t; }));
    this.el.querySelector('.rd-w').textContent = n ? lonText(this.set[0].st.lon) : 'W';
    this.el.querySelector('.rd-e').textContent = n ? lonText(this.set[n - 1].st.lon) : 'E';
    this.el.querySelector('.rd-scan').textContent = n ? `${n} near the view · west → east` : '';
    this.dial.setAttribute('aria-valuemax', String(Math.max(0, n - 1)));
    this.setNeedle(n ? dialPos(this.idx, n) : 0.5); this.sync();
  },
  setNeedle(x) {
    this.pos = x; const p = (x * 100).toFixed(2);
    this.needle.style.left = `calc(14px + (100% - 28px) * ${x})`;
    this.tag.style.left = p + '%'; this.tag.style.transform = `translateX(-${p}%)`;   // the label rides the needle and stays inside the dial
  },
  /** Needle to dial position x (0..1). The detent under it is shown at once; it tunes in after a pause (or on release). */
  moveTo(x, snap) {
    const n = this.set.length; if (!n) return;
    x = Math.min(1, Math.max(0, x)); const i = dialIndex(x, n);
    this.setNeedle(snap ? dialPos(i, n) : x);
    if (i !== this.idx) { this.idx = i; crackle(); this.sync(); this.commit(COMMIT_MS); }
  },
  go(i, now) { const n = this.set.length; if (!n) return; i = Math.min(n - 1, Math.max(0, i)); if (i === this.idx && Radio.current === this.set[i].st) return; this.idx = i; crackle(); this.setNeedle(dialPos(i, n)); this.sync(); this.commit(now ? 0 : COMMIT_MS); },
  step(by, now) { this.go(this.idx + by, now); },
  playPause() { const st = this.set[this.idx]?.st; if (!st) return; if (Radio.current === st && LIVE.has(Radio.status)) Radio.stop(); else this.commit(0); },
  /** Tune in to the detent under the needle: play it, fly to it. */
  commit(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const st = this.set[this.idx]?.st; if (!st) return;
      if (Radio.current !== st || !LIVE.has(Radio.status)) Radio.play(st); else Radio.mark(st);
      this.fly(st);
    }, ms);
  },
  /** Fly to the broadcaster: same heading and tilt, same height below 2,000 km (else 2,000 km), the station centred. */
  fly(st) {
    if (state.lookup) return;
    release();
    const h = Math.max(300, Math.min(camHeight(), FLY_MAX_H)), heading = camera.heading, pitch = Math.min(camera.pitch, C.Math.toRadians(-25));
    const range = h / Math.sin(-pitch), cp = Math.cos(pitch);
    const enu = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(st.lon, st.lat, 0));
    const dest = C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(-range * Math.sin(heading) * cp, -range * Math.cos(heading) * cp, -range * Math.sin(pitch)), new C.Cartesian3());
    const no = ++this.flightNo; this.flight = no;
    camera.flyTo({ destination: dest, orientation: { heading, pitch, roll: 0 }, duration: FLY_S,
      cancel: () => { if (this.flight === no) this.flight = 0; } });   // the user grabbed the globe: their move re-scans
  },
  /** Put the needle on a station (a card's Play): re-scan around it if it isn't on the dial. */
  focusOn(st) {
    if (!this.shown()) return;
    let i = this.set.findIndex(x => x.st === st);
    if (i < 0) { this.rescan({ lon: st.lon, lat: st.lat }); i = this.set.findIndex(x => x.st === st); }
    if (i >= 0) { this.idx = i; this.setNeedle(dialPos(i, this.set.length)); this.sync(); Radio.mark(st); }
  },
  /** Readout: the name and place ride the needle; the status line says what the radio is doing. */
  sync() {
    if (!this.el) return;
    const x = this.set[this.idx], st = x?.st, live = st && Radio.current === st, s = live ? Radio.status : 'idle';
    this.tag.querySelector('b').textContent = st ? st.name : '';
    this.tag.querySelector('small').textContent = st ? st.where : '';
    const words = { loading: 'Tuning in…', buffering: 'Buffering…', playing: 'On air', error: 'No signal', idle: st ? 'Tuned · press ▶' : '' }[s];
    this.say(st ? [words, st.stream, x.km < 1 ? '' : fmt(x.km) + ' km from centre'].filter(Boolean).join(' · ') : Radio.loading && !Radio.list.length ? 'Loading stations…' : '');
    this.el.dataset.state = s;
    const play = this.el.querySelector('.rd-play'), on = live && LIVE.has(s);
    play.textContent = on ? '■' : '▶'; play.setAttribute('aria-label', on ? 'Stop' : 'Play');
    this.dial.setAttribute('aria-valuenow', String(Math.max(0, this.idx)));
    this.dial.setAttribute('aria-valuetext', st ? `${st.name}, ${st.where}` : 'no stations');
  },
};
