// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Saving a layer's visible live items as GeoJSON, CSV or KML with their provenance (the rows: core/export.js), for both
// views: a small row of buttons a layer panel shows, and the download itself (a Blob link, nothing leaves the browser).
import { exportFile, EXPORT_FORMATS } from '../core/export.js';

/** Hand the browser a file to save. */
export function saveText(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30e3);
}

/**
 * The export row for one layer: "Export view: GeoJSON CSV KML". items() → the layer's live items in view now; layer: its
 * name, or a function giving it at the click (the file name and the KML document); say(text): a toast. Returns the element (no inline handlers: CSP).
 */
export function exportRow(items, layer, say = () => {}) {
  const row = document.createElement('div'); row.className = 'export-row';
  const label = document.createElement('span'); label.textContent = 'Export view:'; label.style.cssText = 'font-size:11px;opacity:.75';
  row.appendChild(label);
  for (const [id, f] of Object.entries(EXPORT_FORMATS)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pill export-btn'; b.textContent = f.name;
    b.title = `Save what is in view as ${f.name}, with where each item came from and how old its data is`;
    b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      try {
        const name = typeof layer === 'function' ? layer() : layer, out = exportFile(id, items(), { layer: name });
        if (!out.count) { say(`Nothing of ${name} in view to export (is the layer on?)`); return; }
        saveText(out.name, out.mime, out.text); say(`Saved ${out.count} ${out.count === 1 ? 'item' : 'items'} as ${f.name}`);
      } catch (err) { say('Export failed: ' + err.message); }
    });
    row.appendChild(b);
  }
  return row;
}
