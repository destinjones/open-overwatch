// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The search box of the city lists (/sky/ and /sky/hi/, made by brand/tools/make_sky_pages.mjs): type part of a city's
// or a country's name and the list keeps only what matches. Without this script the whole list simply shows.
const box = /** @type {HTMLInputElement | null} */ (document.getElementById('q')), list = document.getElementById('cities');
// "sao" finds São Paulo: compare without accents and case
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
if (box && list) {
  box.closest('[hidden]')?.removeAttribute('hidden');
  const heads = [...list.querySelectorAll('h2')];
  box.addEventListener('input', () => {
    const q = fold(box.value.trim());
    for (const h of heads) {
      const ul = /** @type {HTMLElement} */ (h.nextElementSibling), country = !q || fold(h.textContent).includes(q);
      let any = false;
      for (const li of ul.querySelectorAll('li')) { const on = country || fold(li.textContent).includes(q); li.hidden = !on; any ||= on; }
      h.hidden = ul.hidden = !any;
    }
  });
}
