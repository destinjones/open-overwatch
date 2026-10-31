# Design system

One look for every page. The tokens are in [`src/app/shell.css`](../src/app/shell.css) (every page gets them); the content
pages' components are in [`src/app/site.css`](../src/app/site.css). This file says what they are, how to use them, and
what the views (globe, 2D map, Solar System, Tonight) need to do to adopt them.

## Files and load order

| File | Who loads it | What it holds |
|---|---|---|
| `brand/fonts/fonts.css` | every page, in `<head>` | the three self-hosted faces, plus size-matched local fallbacks (`Barlow Fallback`, `Big Shoulders Fallback`, `Plex Mono Fallback`) |
| `src/app/shell.css` | content pages in `<head>`; the views get it from `shell.js` | the `--oo-*` tokens; the skip link, focus rings, top bar, What's new, touch hints, long-press popup, reduced motion |
| `src/app/site.css` | content pages only (index, about, guide, teach/, india/, india/hi/) | base, type, nav, buttons, page hero, sections, contents grid, footer, reveal |
| the page's own `<style>` | that page | only what belongs to that page: its hero, grids and section colours |
| `src/app/site.js` | `shell.js` imports it when the page has a `.site-nav` | the nav turning solid (an IntersectionObserver, not a scroll handler) and the shared phone menu |

Content pages link `fonts.css`, `shell.css` and `site.css` in that order, after two font preloads (Big Shoulders latin
for the headline, Barlow 400 latin for the text; the Hindi page preloads Devanagari instead). `shell.js` sees the linked
`shell.css` and does not add it a second time.

Standalone pages copy the token values instead of linking them: `404.html` (GitHub serves it at any depth), `offline.html`
(the service worker shows it with no network) and the city sky pages (`brand/tools/make_sky_pages.mjs`, 441 small pages:
system fonts, no shared files). Each says so in its CSS comment.

## Tokens

Every token starts with `--oo-` so nothing collides with a view's own variables. There is one theme, dark
(`color-scheme:dark`); the teacher page has a print sheet, black on white.

### Colour roles

| Token | Value | Use |
|---|---|---|
| `--oo-bg` | `#04060a` | the page |
| `--oo-surface`, `--oo-surface-2`, `--oo-surface-hover` | `#080c12`, `#0e141c`, `#070b11` | panels, raised panels, a hovered row or card |
| `--oo-glass`, `--oo-glass-soft`, `--oo-scrim` | rgba(8,12,18,.94), (8,12,18,.7), rgba(4,6,10,.86) | floating cards, button fill, the nav bar |
| `--oo-line`, `--oo-line-strong`, `--oo-line-glass` | `#182230`, `#26343f`, rgba(230,237,243,.14) | hairlines, borders, borders on glass |
| `--oo-ink`, `--oo-ink-2`, `--oo-ink-dim`, `--oo-ink-faint` | `#e6edf3`, `#c3cfdb`, `#8b9bab`, `#738599` | text: main, over pictures, secondary, captions. Contrast on `--oo-bg`: 16.6, 12, 7.1, 5.4 (all AA; faint is still 4.9 on `--oo-surface-2`) |
| `--oo-accent`, `--oo-accent-hover`, `--oo-on-accent` | `#7dffa6`, `#a6ffc2`, `#04060a` | the one action colour, its hover, text on it (16.2:1) |
| `--oo-accent-soft`, `--oo-accent-line`, `--oo-accent-glow` | accent at .14, .35, .32 | tints, outlines, glows |
| `--oo-warn`, `--oo-danger`, `--oo-info`, `--oo-note` | `#ffb44d`, `#ff4d5e`, `#5fd3ff`, `#fff2a8` | states |
| layer colours | `--oo-civ` `--oo-mil` `--oo-emg` `--oo-sat` `--oo-ship` `--oo-qk` `--oo-evt` `--oo-cam` `--oo-lch` `--oo-saffron` `--oo-sky` | a kind of thing is the same colour everywhere (satellites lilac, quakes orange...) |

`site.css` maps the old short names (`--bg`, `--ink-dim`, `--accent`, `--display`, `--gut`...) onto these, so page CSS
reads the same as before.

### Type

| Token | Value |
|---|---|
| `--oo-font-display` | Big Shoulders Display (headings, numbers), always uppercase |
| `--oo-font-body` | Barlow (reading text) |
| `--oo-font-mono` | IBM Plex Mono (labels, buttons, data), usually uppercase with tracking |
| `--oo-font-deva` | Noto Sans Devanagari (Hindi) |
| `--oo-fs-2xs` … `--oo-fs-md` | 11, 12, 13, 15 px: labels and captions |
| `--oo-fs-base` | 17 px: body |
| `--oo-fs-lede` | clamp(18px, 1.7vw, 21px) |
| `--oo-fs-h4`, `--oo-fs-h3` | 22 px, clamp(24px, 2.6vw, 30px) |
| `--oo-fs-h2`, `--oo-fs-h2-xl` | clamp(36px, 5vw, 64px); the landing pages' bigger clamp(44px, 6.2vw, 86px) |
| `--oo-fs-h1`, `--oo-fs-hero` | clamp(50px, 8.4vw, 116px); the landing heroes' clamp(52px, 7.4vw, 124px) |
| `--oo-lh-tight`, `--oo-lh-snug`, `--oo-lh-body` | .94, 1.25, 1.6 |
| `--oo-fw-*` | regular 400, medium 500, semibold 600, bold 700, black 900 |
| `--oo-track-caps`, `--oo-track-label`, `--oo-track-eyebrow` | .12em, .16em, .22em letter-spacing for uppercase mono |

Headings use a unitless line height, so a font swap never changes their box height; the fallbacks are scaled to the same
average width, so lines wrap the same way before and after the swap (no reflow).

### Space, layout, shape

| Token | Value |
|---|---|
| `--oo-s-1` … `--oo-s-10` | 4, 8, 12, 16, 20, 24, 32, 40, 56, 80 px (a 4 px grid) |
| `--oo-gutter` | clamp(16px, 4vw, 56px): the side margin, 16 px on a phone |
| `--oo-max`, `--oo-max-doc`, `--oo-measure` | 1240 px landing width, 1100 px reading width, 46em line length |
| `--oo-section`, `--oo-section-xl` | reading pages' section padding, the landing pages' |
| `--oo-nav-h`, `--oo-tap` | 64 px bar, 44 px smallest touch target |
| `--oo-cut` | 10 px: the cut corner of buttons and panels (the site's shape) |
| `--oo-r-xs` … `--oo-r-lg`, `--oo-r-pill` | 5, 8, 12, 16 px, 999 px: radii are for floating UI (bars, cards over a view, inputs) |
| `--oo-shadow-1` … `-3` | small (skip link), floating card, phone mock-up |
| `--oo-blur` | blur(12px): glass, never on phones (under 760 px the bar is solid) |

### Motion

| Token | Value | Use |
|---|---|---|
| `--oo-dur-1` | 120 ms | a press |
| `--oo-dur-2` | 160 ms | a hover colour (globe.html `--t-fast`) |
| `--oo-dur-3` | 280 ms | a panel or menu (globe.html `--t`) |
| `--oo-dur-4` | 420 ms | a sheet, an artwork lift (globe.html `--t-slow`) |
| `--oo-dur-5` | 640 ms | a reveal on scroll, the hero entrance |
| `--oo-ease-out` | cubic-bezier(.2,.8,.2,1) | things arriving (globe.html `--ease`) |
| `--oo-ease-in-out` | cubic-bezier(.65,0,.35,1) | things moving across (globe.html `--ease-io`) |
| `--oo-ease-std` | cubic-bezier(.2,0,0,1) | colour and opacity changes |

With `prefers-reduced-motion: reduce` every duration token is 0 ms, and `shell.css` also cuts every animation and
transition on the page.

## Components (site.css)

- **Nav** `<nav class="site-nav">`: sticky and solid. Add `.over` on a page with a full-bleed hero: it floats over the
  picture with a soft shade under the links and turns solid after 40 px (`site.js`). The solid layer is a pseudo-element
  faded by opacity, so scrolling repaints nothing else. `data-menu="shared"` gives the phone menu (under 860 px): a
  44 px button whose three lines turn into an X, the same links stacked under the bar, closed by a link, Escape, a tap
  outside or a wide screen. index.html and india/ wire their own menus (their tests pin them) with the same styles.
  Links underline from the left on hover; `aria-current="page"` keeps the underline.
- **Brand** `.brand` (32 px emblem, `brand/emblem/emblem-96.webp`, 3.5 KB) and `.brand.sm` (26 px, in the footer).
- **Button** `.btn`: square with one cut corner, mono caps, 48 px high (`.small` 40 px). `.primary` is the accent (one
  per view, the main action), `.ghost` has no fill. Hover lifts 1 px, a press sinks back and shrinks 1.5%. The
  focus ring is drawn inside (outline-offset -4px), because the cut corner clips anything outside; on `.primary` it is
  dark. `aria-disabled="true"` fades it and turns it off. Icons inside are 16 px inline SVG.
- **Eyebrow** `.eyebrow`: the mono caps label with a 22 px rule before a heading.
- **Lede** `.lede`, **note** `.note`, **text link as action** `.lnk`.
- **Page hero** `.page-hero` (reading pages) with `p.sub` (accent mono caps) and two ledes.
- **Sections** `<body class="doc">` gives reading pages their section rhythm and hairlines.
- **Contents grid** `.toc`: 3 / 2 / 1 columns, 48 px rows.
- **Footer** two columns, one on phones.
- **Reveal** `.rv`: hidden until the page script adds `.in`, then fades and rises over `--oo-dur-5`. Only with
  scripting on and motion allowed (`@media (scripting:enabled) and (prefers-reduced-motion:no-preference)`): without a
  script the content is simply there. Inside `.hero`, `.rv` plays a CSS entrance from the first paint, staggered 60 ms,
  so the headline never waits for a script (and the LCP is not held back).
- **Long pages** `.cv` (or the ids in index.html): `content-visibility:auto` with a remembered size, for sections far
  below the fold. Off in print.
- `[hidden]` always hides, even on a `.btn`.

## Icons

Inline SVG, 24×24 viewBox, `fill:none`, `stroke:currentColor`, stroke width 2, round caps and joins (`.btn svg` sets
these, so an icon only needs its paths). A filled detail inside a stroked icon uses `fill="currentColor"` on that shape.
Icons take the text colour; never a second colour in a button.

## No layout shift, no hitch: the rules

- Every `<img>` has `width` and `height` (or the CSS sets both, or an `aspect-ratio`); a picture that fills a box is
  absolutely placed in a box sized by CSS. The hero picture has `fetchpriority="high"`; anything below the fold has
  `loading="lazy"`.
- Video posters below the fold are set by an IntersectionObserver 800 px ahead; a poster that never shows is not there
  (the home page's hero clip fades in over the still).
- Heavy things load as they come near: model-viewer (600 px ahead, from a hashed `<template>`), clips (on a tap on
  phones and slow connections).
- Text that a feed fills later keeps its room from the start (`min-height` for its two lines; counters use
  `tabular-nums`).
- Fonts: `font-display:swap`, two preloads per page, size-matched fallbacks.
- Animate only `transform` and `opacity` (colour changes on hover are fine). No `transition: all`, no animated `width`,
  `height`, `top`, `margin` or `box-shadow`.
- No per-frame scroll handlers: an IntersectionObserver for "has the page left the top" and for reveals; a scroll
  listener, if one is unavoidable, is `{ passive: true }` and only toggles a class.

## Do and don't

- Do use a token; if none fits, add one here and in `shell.css` rather than a one-off value.
- Do keep one `.primary` button per view. Don't make every button green.
- Do write labels in mono caps and reading text in Barlow sentence case. Don't set body copy in mono.
- Do keep the cut corner for site buttons and panels, radii for floating UI over a view. Don't mix both on one element.
- Don't put a blur on phones; use the solid panel colours.
- Don't add a colour for a kind of thing that already has one (a quake is `--oo-qk` everywhere).
- Do keep copy honest: the website has no live aircraft (they come with the free download).

## For the views (adoption notes)

The views get `shell.css` from `shell.js` after their own CSS, so the `--oo-*` tokens are there once the page is up but
not at first paint. To adopt them without a flash, link `src/app/shell.css` in the view's `<head>` (`shell.js` then
skips adding it) and alias the view's own variables in one place, for example in globe.html's `:root`:

```css
--ease:var(--oo-ease-out); --ease-io:var(--oo-ease-in-out);
--t-fast:var(--oo-dur-2); --t:var(--oo-dur-3); --t-slow:var(--oo-dur-4);
```

solar.html and tonight.html keep their own `:root` today; map their colours onto the colour roles above (most are the
same values). `site.css` is not for the views: it styles bare elements (`body`, `h1`, `footer`), which would fight a
view's layout.

## Page weight

`node brand/tools/page_weight.mjs` (no browser) adds up what each content page fetches before any scroll: the HTML, the
stylesheets, the module scripts with their static imports, the fonts its text uses, and the images it shows at once
(the first `<source>` of a `<picture>`, which is the phone picture). Lazy images, videos and dynamic imports are
listed apart. `--json` for a comparison. First design-system pass, 2026-10-31 (KB; text gzip, images and fonts as stored):

| page | HTML | CSS | JS | images | first load, before → after |
|---|---|---|---|---|---|
| index.html | 27.0 → 26.5 | 3.4 → 9.2 | 16.5 → 16.7 | 412.0 → 66.4 | **587.8 → 247.7** |
| about.html | 7.7 → 6.9 | 3.4 → 9.2 | 16.5 → 16.7 | 81.9 → 35.1 | **238.4 → 196.9** |
| guide.html | 36.4 → 35.3 | 3.4 → 9.2 | 16.5 → 16.7 | 50.2 → 3.4 | **235.4 → 193.6** |
| teach/ | 18.2 → 17.1 | 3.4 → 9.2 | 17.6 → 17.7 | 50.2 → 3.4 | **218.2 → 176.4** |
| india/ (and india/hi/) | 16.1 → 15.5 | 3.4 → 9.2 | 73.7 → 73.9 | 270.1 → 51.3 | **610.6 → 397.2** |
| 404.html | 2.0 → 2.2 | 0 | 0 | 50.2 → 10.4 | **52.2 → 12.6** |

Fonts (129 KB, 247 KB with Devanagari) are the same before and after. The CSS is the shared `site.css` and `shell.css`,
cached from the first page on. Where the images went: a 51 KB PNG for the 32 px nav emblem (now a 3.5 KB WebP), the
135 KB 512 px emblem shown at 120 px (now a lazy 11 KB WebP), a 136 KB hero poster that never showed, and the phone
demo's poster (now loaded as it comes near).
