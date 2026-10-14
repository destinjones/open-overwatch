# `deepsky.json`: Messier, NGC and IC objects

**Licence: CC-BY-SA-4.0, derived from OpenNGC v20260501** (<https://github.com/mattiaverga/OpenNGC>, Mattia Verga
and contributors). This file is a selection and reformatting of that catalogue and keeps its licence
(<https://creativecommons.org/licenses/by-sa/4.0/>), not Open Overwatch's MIT licence: credit OpenNGC, and share
changed versions of this file under the same licence.

## What is in it

2,405 objects: every Messier object (M102 is missing because OpenNGC lists it as a duplicate of M101), and the
NGC, IC and addendum objects of deep-sky types (galaxies, clusters, nebulae, planetary nebulae, supernova remnants)
brighter than magnitude 12.5, or with a common name and no magnitude (the Horsehead Nebula, the Coalsack). Single and
double stars (except M40), duplicates and non-existent entries are left out.

The JSON has `licence`, `note`, `source` (repository, tag and the SHA-256 of each CSV), `selection`, `units`, `fields`
and `rows`. Each row follows `fields`:

| Field | Meaning |
|---|---|
| `id` | catalogue name: `NGC 224`, `IC 434`, `Mel 22`, `M 40` |
| `m` | Messier number, or null |
| `type` | OpenNGC's type code (`G`, `OCl`, `GCl`, `PN`, `HII`, …; labels in `src/core/deepsky.js`) |
| `ra`, `dec` | J2000 position, degrees |
| `mag`, `band` | magnitude and its band: `V`, or `B` where OpenNGC has no V magnitude (most galaxies' are B) |
| `maj`, `min` | major and minor axis, arcminutes (null when unknown) |
| `name` | the first common name, or null |
| `con` | constellation (IAU abbreviation) |

## Rebuilding it

```
python -I brand/tools/make_deepsky.py
```

The script downloads `NGC.csv` and `addendum.csv` from the pinned tag into `brand/source/openngc/v20260501/` (not
committed) and stops if either file's SHA-256 differs from the pinned one:

| File | SHA-256 |
|---|---|
| `NGC.csv` | `840fe0c9ee1332e551b2e722a0e92726cd7b157914a3d2177602832aadd3aa9e` |
| `addendum.csv` | `1d8f0914e643ada325a5a94d88d8fefad6a4937a2f77cc34f21483af22b11983` |

To move to a newer OpenNGC release, change `TAG` and both hashes in the script together, read the release notes, and
rerun the tests (`node --test test/deepsky.test.mjs`).
