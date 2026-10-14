# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""Light pollution for a spot: the 2015 World Atlas of artificial sky brightness -> data/lightpollution.bin

    python -I make_lightpollution.py PATH/World_Atlas_2015.tif [--px 8]

The source is Falchi et al. 2016, "The new world atlas of artificial night sky brightness" (GFZ Data Services,
doi:10.5880/GFZ.1.4.2016.001, CC BY-NC 4.0): World_Atlas_2015.zip (653 MB) holds World_Atlas_2015.tif, 43200 x 17406
float32 pixels of 30 arc seconds (lon -180..180, lat 85.05..-60), the artificial zenith sky brightness in mcd/m2.
Download it by hand (the owner's OK is needed for new datasets) into a folder outside the repo; never commit it.

Each output cell is the linear mean of px x px source pixels (px 8 = 1/15 deg, about 7 km), stored as one byte on a log
scale: q = 0 when the mean is below 10^LOG0 mcd/m2 (no measurable artificial light), otherwise
q = 1 + round((log10(mean) - LOG0) / STEP), clamped to 1..255. Rows run north to south, cells west to east.

The file: the line "OOLP1", a one-line JSON header (grid, quantisation, source, licence), then the cells compressed
with raw deflate after a PNG-style "up" filter (each byte minus the one above it, mod 256), which roughly halves the
size. src/core/lightpollution.js reads it. Needs numpy (the user's site-packages: run through the runpy line in the
module's README, data/lightpollution.md, so -I still keeps the download folder off sys.path).
"""
import json, struct, sys, zlib
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / 'data' / 'lightpollution.bin'
LOG0, STEP = -4.0, 0.025          # 1e-4 mcd/m2 (0.06 % of the natural sky) .. 10^(-4 + 254 * 0.025) = 2.2e2 mcd/m2
NATURAL = 0.171168                # mcd/m2, the natural zenith brightness the atlas uses (22.0 mag/arcsec2)


def tiff(path):
    """The atlas GeoTIFF as a lazily read (rows, cols) float32 array, plus its top-left corner and pixel size (deg)."""
    f = open(path, 'rb'); head = f.read(8)
    assert head[:4] == b'II*\0', 'expected a little-endian classic TIFF'
    f.seek(struct.unpack('<I', head[4:])[0]); n = struct.unpack('<H', f.read(2))[0]
    tags = {}
    for _ in range(n):
        tag, typ, cnt, val = struct.unpack('<HHI4s', f.read(12))
        size = {3: 2, 4: 4, 12: 8, 2: 1}.get(typ, 1) * cnt
        if size > 4:
            pos = f.tell(); f.seek(struct.unpack('<I', val)[0]); data = f.read(size); f.seek(pos)
        else:
            data = val[:size]
        fmt = {3: 'H', 4: 'I', 12: 'd'}.get(typ)
        tags[tag] = struct.unpack(f'<{cnt}{fmt}', data) if fmt else data
    W, H, tw, th = tags[256][0], tags[257][0], tags[322][0], tags[323][0]
    assert tags[258][0] == 32 and tags[259][0] == 1 and tags[339][0] == 3, 'expected uncompressed float32 tiles'
    offs = np.array(tags[324], dtype=np.int64); tx, ty = -(-W // tw), -(-H // th)
    assert len(offs) == tx * ty and np.all(np.diff(offs) == tw * th * 4), 'expected tiles stored in order, back to back'
    tiles = np.memmap(path, dtype='<f4', mode='r', offset=int(offs[0]), shape=(ty, tx, th, tw))
    scale, tie = tags[33550], tags[33922]
    return tiles, W, H, tie[3], tie[4], scale[0]


def rows(tiles, a, b, W):
    """Source rows a..b-1 as a (b - a, W) array, nodata (-3.4e38) as 0."""
    th = tiles.shape[2]; out = np.empty((b - a, W), np.float32); r = a
    while r < b:
        t, o = divmod(r, th); k = min(th - o, b - r)
        out[r - a:r - a + k] = tiles[t, :, o:o + k, :].transpose(1, 0, 2).reshape(k, -1)[:, :W]
        r += k
    out[~(out >= 0)] = 0
    return out


def main():
    args = sys.argv[1:]
    px = int(args[args.index('--px') + 1]) if '--px' in args else 8
    src = Path(next(a for a in args if a.endswith('.tif')))
    tiles, W, H, lon0, lat0, d = tiff(src)
    cols, nrows = W // px, H // px
    q = np.zeros((nrows, cols), np.uint8); peak = 0.0
    for i in range(nrows):
        m = rows(tiles, i * px, (i + 1) * px, W)[:, :cols * px].reshape(px, cols, px).mean(axis=(0, 2), dtype=np.float64)
        peak = max(peak, float(m.max()))
        with np.errstate(divide='ignore'):
            v = 1 + np.rint((np.log10(m) - LOG0) / STEP)
        q[i] = np.where(m >= 10 ** LOG0, np.clip(v, 1, 255), 0).astype(np.uint8)
        if i % 200 == 0: print(f'row {i}/{nrows}', flush=True)
    up = q.copy(); up[1:] = (q[1:].astype(np.int16) - q[:-1]).astype(np.uint8)
    body = zlib.compress(up.tobytes(), 9)[2:-4]      # raw deflate (DecompressionStream 'deflate-raw')
    header = {
        'grid': {'cols': cols, 'rows': nrows, 'lon0': round(lon0, 9), 'lat0': round(lat0, 9), 'step': round(d * px, 12)},
        'quant': {'log0': LOG0, 'step': STEP, 'unit': 'mcd/m2', 'zero': 'below 10^log0', 'filter': 'up', 'codec': 'deflate-raw'},
        'natural': NATURAL,
        'source': 'Falchi F. et al. (2016): Supplement to: The New World Atlas of Artificial Night Sky Brightness. GFZ Data Services. '
                  'doi:10.5880/GFZ.1.4.2016.001; paper: Science Advances 2(6) e1600377, doi:10.1126/sciadv.1600377',
        'licence': 'CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/). Non-commercial use only; credit the authors.',
        'derived': f'mean of {px}x{px} source pixels (1/{round(1 / (d * px))} deg), log-quantised to one byte by Open Overwatch '
                   '(brand/tools/make_lightpollution.py)',
    }
    OUT.write_bytes(b'OOLP1\n' + json.dumps(header, separators=(',', ':')).encode() + b'\n' + body)
    lit = int((q > 0).sum())
    print(f'{OUT.name}: {cols} x {nrows} cells of 1/{round(1 / (d * px))} deg, {lit} lit ({lit / q.size:.1%}), '
          f'peak {peak:.2f} mcd/m2, {OUT.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
