// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe in the conversation: an MCP Apps view (io.modelcontextprotocol/ui, spec 2026-01-26). Hosts that show apps
// (Claude Desktop, and others) render this small page in a sandbox when show_on_globe answers; it frames the website's
// globe in embed mode (#embed=1: just the globe) and moves it to each new view by changing only the link's hash, so the
// globe flies there instead of loading again. Nothing is loaded through the MCP server: the page is public, and the host
// lets the frame in because the resource names the site in its frameDomains.

export const PANEL_URI = 'ui://open-overwatch/globe';
export const MCP_APP_MIME = 'text/html;profile=mcp-app';
const HEIGHT = 520;

function page(site, version) {
  const cfg = JSON.stringify({ site, version, height: HEIGHT }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Overwatch</title>
<style>
  html, body { margin: 0; height: 100%; background: #05080c; color: #cfe3ee; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
  #wrap { position: relative; height: ${HEIGHT}px; }
  body.full #wrap { height: 100vh; }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #05080c; }
  #veil { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; padding: 0 28px; text-align: center; background: #05080c; z-index: 2; }
  #veil[hidden] { display: none; }
  #bar { position: absolute; top: 10px; left: 10px; display: flex; gap: 6px; z-index: 3; }   /* the globe's own way out sits top right */
  button { padding: 6px 11px; border: 1px solid #2c4150; border-radius: 7px; background: rgba(5, 8, 12, .78); color: #e6f2f8; font: inherit; cursor: pointer; }
  button:hover { border-color: #7dffa6; color: #7dffa6; }
  button[hidden] { display: none; }
  .dim { color: #86a0ae; font-size: 12px; }
</style>
</head>
<body>
<div id="wrap">
  <iframe id="globe" title="Open Overwatch: the live 3D Earth" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
  <div id="veil"><div id="say">Waiting for a view…</div></div>
  <div id="bar"><button id="full" type="button" hidden>Full screen</button><button id="open" type="button" hidden>Open in Open Overwatch</button></div>
</div>
<script>
(() => {
  const cfg = ${cfg};
  const $ = id => document.getElementById(id), frame = $('globe'), veil = $('veil'), sayEl = $('say'), openBtn = $('open'), fullBtn = $('full');
  const pending = new Map();
  let nextId = 1, url = null, ready = false, mode = 'inline', timer = 0;
  const send = m => window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, m), '*');
  const notify = (method, params) => send({ method, params: params || {} });
  const request = (method, params) => new Promise((res, rej) => {
    const id = nextId++; pending.set(id, { res, rej }); send({ id, method, params: params || {} });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('no answer')); } }, 20000);
  });
  const say = (text, withLink) => {
    sayEl.textContent = text; veil.hidden = false;
    const old = veil.querySelector('.dim'); if (old) old.remove();
    if (withLink && url) { const p = document.createElement('div'); p.className = 'dim'; p.textContent = url; veil.appendChild(p); }
  };
  const size = () => notify('ui/notifications/size-changed', { width: document.body.clientWidth, height: mode === 'fullscreen' ? window.innerHeight : cfg.height });
  const context = c => {
    if (!c) return;
    if (c.displayMode) { mode = c.displayMode; document.body.classList.toggle('full', mode === 'fullscreen'); fullBtn.textContent = mode === 'fullscreen' ? 'Back to the chat' : 'Full screen'; }
    if (Array.isArray(c.availableDisplayModes)) fullBtn.hidden = !c.availableDisplayModes.includes('fullscreen');
  };
  // only links to the site itself are shown: the frame never goes anywhere else
  const ours = u => typeof u === 'string' && u.indexOf(cfg.site) === 0 && /^[^#]*\\/globe\\.html#/.test(u);
  function show(result) {
    const sc = result && result.structuredContent, u = sc && sc.url;
    if (result && result.isError) { if (!url) say('The question could not be answered, so there is nothing to show.'); return; }
    if (!ours(u)) { if (!url) say('This answer has no view to show on the globe.'); return; }
    url = u; openBtn.hidden = false;
    const embed = u.replace('#', '#embed=1&');
    if (!frame.getAttribute('src')) {
      say('Loading the live globe…');
      clearTimeout(timer); timer = setTimeout(() => { if (!ready) say('The globe has not appeared here. This app host may not allow it: open it in your browser instead.', true); }, 45000);
    }
    frame.src = embed;   // after the first load only the hash changes: the globe flies to the new view
  }
  // a host whose sandbox refuses the frame (no frameDomains support) reports a CSP violation at once: offer the link then
  document.addEventListener('securitypolicyviolation', e => {
    if (!ready && url && /^(frame|child)-src/.test(e.effectiveDirective || e.violatedDirective || '')) { clearTimeout(timer); say('This app does not allow the live globe inside the chat. Open it in your browser instead.', true); }
  });
  window.addEventListener('message', e => {
    const m = e.data;
    if (e.source === frame.contentWindow) { if (m && m.type === 'oo:ready') { ready = true; clearTimeout(timer); veil.hidden = true; } return; }
    if (e.source !== window.parent || !m || m.jsonrpc !== '2.0') return;
    if (m.id != null && !m.method) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); } return; }
    if (m.method === 'ui/notifications/tool-result') show(m.params);
    else if (m.method === 'ui/notifications/tool-cancelled') { if (!url) say('Cancelled.'); }
    else if (m.method === 'ui/notifications/host-context-changed') { context(m.params); size(); }
    else if (m.id != null && (m.method === 'ui/resource-teardown' || m.method === 'ping')) send({ id: m.id, result: {} });
  });
  openBtn.onclick = () => { if (url) request('ui/open-link', { url }).catch(() => window.open(url, '_blank', 'noopener')); };
  fullBtn.onclick = () => request('ui/request-display-mode', { mode: mode === 'fullscreen' ? 'inline' : 'fullscreen' }).then(r => { context({ displayMode: r && r.mode }); size(); }, () => {});
  window.addEventListener('resize', () => { if (mode === 'fullscreen') size(); });
  request('ui/initialize', { appInfo: { name: 'open-overwatch', title: 'Open Overwatch', version: cfg.version }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26' })
    .then(r => { context(r && r.hostContext); notify('ui/notifications/initialized'); size(); },
      () => say('This app host did not accept the globe panel; the link in the answer opens it in your browser.'));
})();
</script>
</body>
</html>
`;
}

/** The panel as an MCP resource for `site` (its origin is the one frame the page may hold). */
export function panelResource(site, version) {
  const origin = new URL(site).origin;
  return {
    uri: PANEL_URI, name: 'globe', title: 'Open Overwatch globe', description: 'The live 3D Earth, showing the view show_on_globe returns.',
    mimeType: MCP_APP_MIME, text: page(site, version),
    _meta: { ui: { csp: { frameDomains: [origin] }, prefersBorder: true } },
  };
}
