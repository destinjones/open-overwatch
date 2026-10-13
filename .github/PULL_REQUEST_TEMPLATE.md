<!-- Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE). -->
<!-- Thanks! A few lines under each heading is plenty. Delete what doesn't apply. -->

## What this changes

<!-- What someone will see or be able to do, and why. "Fixes #123" if it closes an issue. -->

## How I checked it

- [ ] `node --test` passes
- [ ] `npm run e2e` passes, or I didn't touch a page
- [ ] I opened the page(s) I changed and saw no errors in the console (a phone-sized window too, if it's on screen)

<!-- Anything else: a screenshot, a share link to the view, frame rates before and after. -->

## The house rules

- [ ] No build step and no new framework; any new CDN library is pinned to an exact version
- [ ] `src/core/` still has no DOM, three.js or Cesium imports, and new core code has a test
- [ ] Upstream strings go through `esc()` before they reach HTML
- [ ] Nothing automated talks to CelesTrak
- [ ] New source files start with the copyright line
- [ ] A new data source is credited in `docs/DATA_SOURCES.md`, with its licence

## Docs

<!-- Which of these did you touch, if the change needs it: guide.html, docs/LINK_FORMAT.md, docs/DEVELOPING.md,
     docs/CORE.md, mcp/README.md, CHANGELOG.md (under "Unreleased"). test/docs.test.mjs will tell you about most. -->
