// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The teachers page (teach/index.html): "Print this page", "Print this activity" (one activity on its own sheet) and
// "Copy" for the citations. The page reads and prints without it: the buttons start hidden and only show from here.
// No storage, no network, nothing sent anywhere.

const status = document.querySelector('.status');
const say = t => { if (status) { status.textContent = t; setTimeout(() => { if (status.textContent === t) status.textContent = ''; }, 4000); } };

/** Print one activity: a copy of it (ids removed, so none repeat) goes into #printOne, and the print styles show only that. */
function printOne(article) {
  document.getElementById('printOne')?.remove();
  const box = document.createElement('div');
  box.id = 'printOne';
  const copy = /** @type {HTMLElement} */ (article.cloneNode(true));
  for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id');
  copy.removeAttribute('aria-labelledby');
  box.appendChild(copy);
  document.body.appendChild(box);
  document.body.classList.add('print-one');
  const done = () => { box.remove(); document.body.classList.remove('print-one'); };
  addEventListener('afterprint', done, { once: true });
  window.print();
}

for (const b of document.querySelectorAll('button[data-print]')) {
  b.hidden = false;
  b.addEventListener('click', () => {
    const which = b.getAttribute('data-print');
    if (which === 'all') { document.getElementById('printOne')?.remove(); document.body.classList.remove('print-one'); window.print(); return; }
    const article = document.getElementById(which);
    if (article) printOne(article);
  });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* no clipboard permission: select it instead */ }
  return false;
}

for (const b of document.querySelectorAll('button[data-copy]')) {
  b.hidden = false;
  b.addEventListener('click', async () => {
    const pre = document.getElementById(b.getAttribute('data-copy'));
    if (!pre) return;
    if (await copyText(pre.textContent)) { say('Copied to the clipboard.'); return; }
    const range = document.createRange();
    range.selectNodeContents(pre);
    const sel = getSelection();
    sel?.removeAllRanges(); sel?.addRange(range);
    say('Selected: press Ctrl+C (or ⌘C) to copy.');
  });
}
