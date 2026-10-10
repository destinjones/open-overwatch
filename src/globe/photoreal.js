// Photoreal 3D cities: Google Photorealistic 3D Tiles streamed through Cesium ion with the visitor's own free ion token
// (kept in this browser, the same one "3D buildings" uses; config.js can ship one for everyone). Close up (below ~200 km)
// the tiles replace the globe's surface, shells and imagery; higher up the usual Earth shows.
// Google's terms come with the tiles: while this layer is on, place search goes to Google's geocoder (through ion)
// instead of Photon, Google's attribution shows in the credits, and use is personal and non-commercial.
import { C, $, esc, store, toast } from './env.js';
import { viewer, scene, globe, camHeight } from './viewer.js';
import { L, syncDock } from './layers.js';
import { state, hooks } from './state.js';
import { token } from './buildings.js';
import { Earth } from './earth.js';
import { setGeocoder } from './places.js';

const NEAR = 2.0e5;   // metres: below this the tiles are the ground

export const Photoreal = {
  tileset: null, loading: false, shown: false, geocoder: null, active: false,
  /** Runs on every visibility pass (often): only a change of state does anything. */
  async apply() {
    if (!L.photoreal.on) { if (this.active) { this.active = false; this.useGoogleSearch(false); } this.tick(); return; }
    if (this.active || this.loading) { this.tick(); return; }
    if (!token()) { L.photoreal.on = false; store.set('ly.photoreal', false); syncDock(); this.ask(); return; }
    if (!this.tileset && !this.loading) {
      this.loading = true;
      try {
        C.Ion.defaultAccessToken = token();
        // onlyUsingWithGoogleGeocoder: true is a promise this code keeps (useGoogleSearch below)
        this.tileset = await C.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: 16, showCreditsOnScreen: true });
        this.tileset.show = false; scene.primitives.add(this.tileset);
      } catch (e) {
        console.warn('photoreal', e); L.photoreal.on = false; store.set('ly.photoreal', false); syncDock();
        toast('Photoreal 3D could not load: check the Cesium ion token (Access Tokens at ion.cesium.com)', 6000);
      }
      this.loading = false;
    }
    if (this.tileset && L.photoreal.on) { this.active = true; this.useGoogleSearch(true); toast('Photoreal 3D on: fly down to a city (below 200 km). Place search now uses Google.', 4500); }
    this.tick();
  },
  /** Google's tiles may only be used with Google's geocoder: swap place search for as long as the layer is on. */
  useGoogleSearch(on) {
    if (!on) { setGeocoder(null); return; }
    this.geocoder = this.geocoder || new C.IonGeocoderService({ scene, accessToken: token(), geocodeProviderType: C.IonGeocodeProviderType.GOOGLE });
    const g = this.geocoder, deg = C.Math.toDegrees;
    setGeocoder(async (q, limit) => (await g.geocode(q)).slice(0, limit).map(r => {
      const d = r.destination;
      if (d instanceof C.Rectangle) { const c = C.Rectangle.center(d); return { name: r.displayName.split(',')[0], sub: r.displayName.split(',').slice(1).join(',').trim(), lon: deg(c.longitude), lat: deg(c.latitude), type: '', extent: [deg(d.west), deg(d.north), deg(d.east), deg(d.south)] }; }
      const c = C.Cartographic.fromCartesian(d); return { name: r.displayName.split(',')[0], sub: r.displayName.split(',').slice(1).join(',').trim(), lon: deg(c.longitude), lat: deg(c.latitude), type: '', extent: null };
    }), 'Places: Google (through Cesium ion)');
  },
  /** Each frame: the tiles or the globe, never both (z-fighting), and nothing from look-up's eye height. */
  tick() {
    const show = !!(this.tileset && L.photoreal.on && !state.lookup && camHeight() < NEAR);
    if (show === this.shown) return;
    this.shown = show; state.photoreal = show;
    if (this.tileset) this.tileset.show = show;
    globe.show = !show; Earth.covered = show; Earth.apply();
    hooks.applyVisibility();   // OSM buildings step aside while Google's are up
  },
  /** The visitor's own token: a card that explains where to get one. Nothing is sent anywhere but Cesium ion. */
  ask() {
    const c = $('#card'); hooks.clearSelection?.();
    c.innerHTML = `<button class="x" aria-label="Close">×</button><div class="k" style="--c:#9fe3ff">Layer</div><h2>Photoreal 3D cities</h2>
      <p class="note" style="margin:0 0 10px">Google's photorealistic 3D cities, streamed through Cesium ion with your own free token. Free for personal, non-commercial use; Google's and Cesium's terms apply.</p>
      <ol class="note" style="margin:0 0 10px 18px;padding:0"><li>Make a free account at <a href="https://ion.cesium.com/signup" target="_blank" rel="noopener">ion.cesium.com</a></li><li>Open <b>Access Tokens</b> and copy the <b>Default</b> token</li><li>Paste it here: it stays in this browser only</li></ol>
      <form class="fl-form" id="prForm" autocomplete="off"><input id="prTok" maxlength="2000" placeholder="Cesium ion access token" aria-label="Cesium ion access token" spellcheck="false" style="text-transform:none" value=""></form>
      <div class="acts"><button class="chipbtn" id="prSave" style="color:#7dffa6">Save and turn on</button>${token() ? '<button class="chipbtn" id="prDel">Forget my token</button>' : ''}</div>`;
    c.classList.add('show');
    const save = () => { const t = c.querySelector('#prTok').value.trim(); if (!/^[\w.-]{20,}$/.test(t)) { toast('That does not look like an ion token (a long string of letters, digits and dots)', 4500); return; }
      store.set('ionToken', t); this.geocoder = null; L.photoreal.on = true; store.set('ly.photoreal', true); syncDock(); c.classList.remove('show'); this.apply(); };
    c.querySelector('.x').onclick = () => c.classList.remove('show');
    c.querySelector('#prSave').onclick = save; c.querySelector('#prForm').onsubmit = e => { e.preventDefault(); save(); };
    const del = c.querySelector('#prDel'); if (del) del.onclick = () => { store.set('ionToken', ''); L.photoreal.on = false; store.set('ly.photoreal', false); syncDock(); this.apply(); c.classList.remove('show'); toast('Token forgotten', 2500); };
    setTimeout(() => c.querySelector('#prTok')?.focus(), 50);
  },
};
scene.preRender.addEventListener(() => Photoreal.tick());
