// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "What's new": the card a returning visitor sees once after the site was updated (src/app/pwa.js shows it), DOM-free
// so Node can test it. The notes are CHANGELOG.md's, shortened to card lines; add an entry here with each version
// (test/whatsnew.test.mjs fails when src/map/version.js names a version newer than the newest entry).
//   - the version part of the worker's build stamp ('0.9.2.15+abc1234': a commit-only rebuild is not a new version),
//   - whether the card is due: never on a first visit (that only remembers the version), never in an archived
//     /v/<tag>/ copy or an embed, once per version,
//   - the link to the full notes.

export const SEEN_KEY = 'oo-seen';
export const CHANGELOG_URL = 'https://github.com/destinjones/open-overwatch/blob/main/CHANGELOG.md';
export const MAX_LINES = 3;

/** Newest first. title: the release's one-line name; lines: what changed, most worth trying first (the card shows the
 *  first MAX_LINES); go: a page to try it on, relative to the site root; date: the CHANGELOG heading's date (null until
 *  it is published). */
export const RELEASES = Object.freeze([
  {
    version: '0.9.2.15', date: '2026-10-17', title: 'Tonight for any place, and honest about what is live',
    go: 'tonight.html',
    lines: [
      'Tonight for any place, not only where you are.',
      'Sunrise and moonrise to the minute.',
      'ISRO\'s missions in the Solar System view.',
      'A faster globe, and a lighter low-quality setting for phones.',
      'EMSC confirmations on earthquakes.',
      'Honest about which live feeds the website carries.',
      'This card: what changed, once after each update.',
    ],
  },
  {
    version: '0.9.2.14', date: '2026-10-15', title: 'India',
    go: 'india/',
    lines: [
      'An India page in English and हिन्दी: launches from Sriharikota, ISS passes over six cities in IST, dark skies, the monsoon and cyclones.',
      'Each part opens the globe already set there.',
      'Tools for vertical promo videos.',
    ],
  },
  {
    version: '0.9.2.13', date: '2026-10-14', title: 'Checked, and darker skies',
    go: 'globe.html#go=reentry',
    lines: [
      'Provenance on every live layer: who reported it, how many agree, how old the data is, and a confidence.',
      'The Sun now: solar wind, Bz, flares and NOAA\'s alerts in plain words.',
      'Your sky: the Bortle class where you are, the nearest darker sky, and Deep sky tonight.',
      'Falling soon: satellites and debris due to re-enter in the next 30 days.',
      'Export a layer as GeoJSON, CSV or KML.',
    ],
  },
]);

/** '0.9.2.15' from a build stamp '0.9.2.15+abc1234' (or 'v0.9.2.15'); null for 'dev', 'unknown' or nothing. */
export function versionOf(build) {
  const m = /^v?(\d+(?:\.\d+)+)(?:[+-]|$)/.exec(String(build || '').trim());
  return m ? m[1] : null;
}

/** Compare two dotted versions: -1, 0 or 1 ('0.9.2.15' > '0.9.2.9'). */
export function compareVersions(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The entry for a version, or null. */
export function releaseFor(version) {
  return RELEASES.find(r => r.version === version) || null;
}

/** Where "Full notes" goes: the version's heading in CHANGELOG.md on GitHub once it has a date, else the top. */
export function notesUrl(release) {
  if (!release || !release.date) return CHANGELOG_URL;
  // GitHub's anchor for "## [0.9.2.14] - 2026-10-15": lower case, punctuation but '-' dropped, spaces to '-'
  return CHANGELOG_URL + '#' + `[${release.version}] - ${release.date}`.toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');
}

/** A safe "try it" link: a page of this site, relative to its root (no scheme, no '//', no '..'), or null. */
export function tryLink(go) {
  const s = String(go || '');
  return /^[a-z][\w-]*(?:\/|\.html)?(?:#[\w=&.-]*)?$/i.test(s) && !s.includes('..') ? s : null;
}

/** What the card shows for a release: { version, title, lines (at most MAX_LINES), more (lines left out), go, notes }. */
export function cardFor(release, max = MAX_LINES) {
  if (!release) return null;
  const lines = release.lines.slice(0, max);
  return { version: release.version, title: release.title, lines, more: release.lines.length - lines.length, go: tryLink(release.go), notes: notesUrl(release) };
}

/**
 * Is the card due? build: the controlling worker's stamp; seen: the stored last-seen version (SEEN_KEY) or null;
 * env: { archived, embed, updated: the visitor just pressed Reload on the new-version bar, search }.
 * Returns { card: cardFor(…) | null, remember: the version to store, or null to leave storage alone }.
 * A first visit only remembers (nothing is new to someone who has never been here), unless the visitor came through the
 * Reload button (they were here before this card existed). ?whatsnew=1 forces the card (for testing), ?whatsnew=0 never.
 */
export function whatsNewDue(build, seen, env = {}) {
  const none = { card: null, remember: null };
  const q = new URLSearchParams(String(env.search || '')).get('whatsnew');
  if (env.archived || q === '0') return none;
  const version = versionOf(build);
  if (q === '1') return { card: cardFor(releaseFor(version) || RELEASES[0]), remember: null };
  if (env.embed || !version) return none;
  const last = versionOf(seen);
  if (last === version) return none;
  const isNew = last ? compareVersions(version, last) > 0 : !!env.updated;
  return { card: isNew ? cardFor(releaseFor(version)) : null, remember: version };
}
