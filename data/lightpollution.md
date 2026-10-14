# `lightpollution.bin`: artificial night sky brightness

**Licence: CC BY-NC 4.0 (<https://creativecommons.org/licenses/by-nc/4.0/>). Non-commercial use only.** This file is
not covered by Open Overwatch's MIT licence. You may share and adapt it for non-commercial purposes if you credit the
authors. If you fork Open Overwatch for anything commercial (selling it, ads, a paid product or service), delete this
file and the feature that reads it, or ask the authors first.

## Source

Falchi, F., Cinzano, P., Duriscoe, D., Kyba, C. C. M., Elvidge, C. D., Baugh, K., Portnov, B., Rybnikova, N. A.,
Furgoni, R. (2016): *Supplement to: The New World Atlas of Artificial Night Sky Brightness.* GFZ Data Services.
<https://doi.org/10.5880/GFZ.1.4.2016.001>

Paper: Falchi F. et al. (2016), The new world atlas of artificial night sky brightness, *Science Advances* 2(6),
e1600377. <https://doi.org/10.1126/sciadv.1600377>

Both references must be cited by anyone using this data. The licence above is the one on the dataset's DOI record
(DataCite, checked 2026-10-14). The README inside the original 2016 download (`World_Atlas_2015.zip`) is stricter: it
says further distribution of those files and commercial use are generally prohibited, and that changes to the policy
are announced on the data page. This repository ships only the resampled grid described below, never the original
files.

## What is in it

The atlas's `World_Atlas_2015.tif` (43200 × 17406 float32 pixels of 30″, lon −180…180, lat 85.05…−60; the
artificial zenith sky brightness in mcd/m² for a clear moonless night, modelled from 2014 VIIRS satellite data),
averaged over blocks of 8 × 8 pixels (1/15°, about 7 km north-south) by
[`brand/tools/make_lightpollution.py`](../brand/tools/make_lightpollution.py). 5400 × 2175 cells, 1.65 MB.

Layout:

1. The ASCII line `OOLP1`.
2. One line of JSON: `grid` (`cols`, `rows`, `lon0`, `lat0` = the north-west corner, `step` in degrees), `quant`,
   `natural` (0.171168 mcd/m², the 22.0 mag/arcsec² natural sky), `source`, `licence`, `derived`.
3. The cells, one byte each, rows north to south and west to east, with a PNG-style "up" filter (each byte minus the
   byte above it, mod 256), compressed with raw deflate.

A cell's byte `q` is 0 when the mean brightness is under 10⁻⁴ mcd/m² (no measurable artificial light), otherwise the
brightness is 10^(−4 + (q − 1) × 0.025) mcd/m² (steps of 0.0625 mag in the artificial part).
[`src/core/lightpollution.js`](../src/core/lightpollution.js) decodes it and turns a spot into an SQM reading and a
Bortle class.

## Rebuilding it

Download `World_Atlas_2015.zip` (653 MB) from
<https://datapub.gfz-potsdam.de/download/10.5880.GFZ.1.4.2016.001/> into a folder outside the repository, unzip
`World_Atlas_2015.tif` (3 GB) there, and run from the repository root (numpy from the user's site-packages; `-I` keeps
the download folder off Python's path):

```
python -I -c "import site,sys,runpy; sys.path.append(site.getusersitepackages()); sys.argv=['make_lightpollution.py']+sys.argv[1:]; runpy.run_path('brand/tools/make_lightpollution.py', run_name='__main__')" PATH/World_Atlas_2015.tif --px 8
```

The zip downloaded on 2026-10-14 had SHA-256 `9c6a624427463c40717efbca7696e3c6bb0f332c26d1b039e7a91e0dbc831fbf`.
Never commit the zip or the GeoTIFF.
