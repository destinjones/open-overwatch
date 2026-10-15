# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""A fast-cut vertical TikTok promo (1080x1920, 30 fps, no audio: the music is added in TikTok) from footage already in
brand/: the 30 s zoom (brand/video/open-overwatch-zoom-1080.mp4), the phone tour (tiktok_tour.mjs) and the landing
page's clips. Every cut punches in, every caption pops; the last 3 s are the end card.

    python brand/tools/promo_hyper.py [out.mp4]       (needs imageio-ffmpeg; default brand/video/open-overwatch-promo-hyper.mp4)
"""
import os, subprocess, sys, tempfile
import imageio_ffmpeg

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'brand', 'video', 'open-overwatch-promo-hyper.mp4')
ZOOM = os.path.join(ROOT, 'brand', 'video', 'open-overwatch-zoom-1080.mp4')
TOUR = os.path.join(ROOT, 'brand', 'video', 'open-overwatch-tiktok-tour.mp4')
CLIP = lambda n: os.path.join(ROOT, 'brand', 'lander', 'clips', n + '.mp4')
FONT = 'C\\:/Windows/Fonts/impact.ttf'
GREEN, WHITE = '0x7dffa6', 'white'

# (source, start s, source seconds, output seconds, caption line 1, caption line 2 (green))
CUTS = [
    (ZOOM, 0.0, 3.0, 1.5, 'THIS FREE WEBSITE', 'TRACKS EVERYTHING'),
    (CLIP('air_world'), 0.3, 1.6, 1.6, '12,000+ PLANES', 'LIVE. RIGHT NOW.'),
    (TOUR, 27.0, 2.8, 1.4, '18,000 SATELLITES', 'IN REAL ORBITS'),
    (CLIP('mil'), 1.0, 1.2, 1.2, 'MILITARY JETS', ''),
    (CLIP('hazards'), 0.5, 1.2, 1.2, 'QUAKES. STORMS.', 'WILDFIRES.'),
    (TOUR, 33.6, 6.0, 1.6, 'DIVE INTO ANY CITY', ''),
    (ZOOM, 3.0, 9.0, 2.2, 'NOW ZOOM OUT', ''),
    (ZOOM, 12.0, 7.0, 2.0, 'PAST THE MOON', 'PAST THE PLANETS'),
    (ZOOM, 19.5, 7.0, 2.4, 'INTO ANOTHER', 'SOLAR SYSTEM'),
    (ZOOM, 27.0, 6.4, 2.2, 'OUT TO THE', 'COSMIC WEB'),
    (TOUR, 44.0, 9.0, 2.4, 'HOLD YOUR PHONE', 'UP TO THE SKY'),
    (TOUR, 3.0, 22.0, 1.8, 'NO APP. NO ACCOUNT.', '100% FREE'),
]
END = 3.0   # the end card, over the last frame of the cosmic web


def caption_filters(tmp, i, l1, l2):
    """Two pop-in lines in the upper third: they grow from 70% to full size in a fifth of a second."""
    out = []
    for k, (txt, col, y) in enumerate(((l1, WHITE, 'h*0.17'), (l2, GREEN, 'h*0.17+130'))):
        if not txt: continue
        f = os.path.join(tmp, f'c{i}_{k}.txt')
        open(f, 'w', encoding='utf-8').write(txt)
        out.append(f"drawtext=expansion=none:fontfile='{FONT}':textfile='{f.replace(os.sep, '/').replace(':', chr(92) + ':')}':fontcolor={col}:"
                   f"fontsize='118*min(1,0.7+t*1.5)':borderw=9:bordercolor=black@0.9:shadowx=0:shadowy=6:shadowcolor=black@0.5:"
                   f"x=(w-text_w)/2:y={y}")
    return out


def main():
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    tmp = tempfile.mkdtemp(prefix='oo-promo-')
    args, chains = [ff, '-y', '-loglevel', 'error'], []
    for i, (src, ss, dur, outdur, l1, l2) in enumerate(CUTS):
        args += ['-ss', str(ss), '-t', str(dur), '-i', src]
        speed = dur / outdur
        chains.append(f"[{i}:v]setpts=(PTS-STARTPTS)/{speed:.4f},fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
                      # the punch: 14% in at the cut, back to full frame in a quarter of a second
                      f"scale=w='trunc(1080*(1+0.14*max(0,1-t*4))/2)*2':h='trunc(1920*(1+0.14*max(0,1-t*4))/2)*2':eval=frame,crop=1080:1920,"
                      f"trim=duration={outdur},setpts=PTS-STARTPTS,"
                      + ','.join(caption_filters(tmp, i, l1, l2) + [f'setsar=1,fade=t=in:st=0:d=0.06:color=white']) + f"[v{i}]")
    # end card: the cosmic web's last frame, darkened, with the name and where to find it
    n = len(CUTS)
    args += ['-sseof', '-0.1', '-i', ZOOM]
    end = [f"[{n}:v]trim=end_frame=1,loop=loop={int(END * 30)}:size=1:start=0,setpts=N/30/TB,fps=30,scale=1080:1920,eq=brightness=-0.42,boxblur=6:1"]
    for txt, col, size, y, f in (('OPEN OVERWATCH', WHITE, 150, 'h*0.36', 'e0'), ('THE WHOLE UNIVERSE, LIVE', GREEN, 74, 'h*0.36+190', 'e1'),
                                 ('SEARCH  OPEN OVERWATCH', WHITE, 60, 'h*0.62', 'e2'), ('FREE  -  IN YOUR BROWSER', WHITE, 52, 'h*0.62+90', 'e3')):
        p = os.path.join(tmp, f + '.txt'); open(p, 'w', encoding='utf-8').write(txt)
        end.append(f"drawtext=expansion=none:fontfile='{FONT}':textfile='{p.replace(os.sep, '/').replace(':', chr(92) + ':')}':fontcolor={col}:fontsize='{size}*min(1,0.6+t*2)':"
                   f"borderw=8:bordercolor=black@0.9:x=(w-text_w)/2:y={y}")
    chains.append(','.join(end) + f",setsar=1,trim=duration={END}[v{n}]")
    chains.append(''.join(f'[v{i}]' for i in range(n + 1)) + f'concat=n={n + 1}:v=1:a=0,format=yuv420p[out]')
    args += ['-filter_complex', ';'.join(chains), '-map', '[out]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
             '-movflags', '+faststart', '-r', '30', OUT]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    subprocess.run(args, check=True)
    print('promo ->', OUT, f'{sum(c[3] for c in CUTS) + END:.1f} s')


if __name__ == '__main__':
    main()
