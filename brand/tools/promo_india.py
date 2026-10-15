# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""The India ad: a vertical 1080x1920, 30 fps promo of about 17 s with English captions and no audio (music goes on in the
ad tool), cut from the frames brand/tools/india_clips.mjs recorded (the website over India: satellites, the dive to
Delhi, modelled air quality, Look up from India Gate), ending on a card with the India page's address. Nothing in it
claims live aircraft: the website has none.

    python brand/tools/promo_india.py [framesDir] [out.mp4]
      framesDir default: %LOCALAPPDATA%/open-overwatch-brand/footage/india (or OW_WORK's footage/india)
      out default:       brand/video/open-overwatch-india-promo.mp4 (gitignored)
"""
import os, subprocess, sys, tempfile
import imageio_ffmpeg

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WORK = os.environ.get('OW_WORK') or os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'open-overwatch-brand')
FRAMES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WORK, 'footage', 'india')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'brand', 'video', 'open-overwatch-india-promo.mp4')
FONT = 'C\\:/Windows/Fonts/impact.ttf'
GREEN, WHITE, SAFFRON = '0x7dffa6', 'white', '0xff9f3f'
FPS = 30

# (clip, first frame, frames used, output seconds, caption line 1, line 2 (green))
CUTS = [
    ('india_sats', 1, 120, 3.6, 'INDIA, LIVE', 'FROM SPACE'),
    ('delhi_dive', 1, 165, 4.0, 'FROM ORBIT', 'DOWN TO DELHI'),
    ('airq', 1, 135, 3.6, 'THE AIR OVER', 'NORTH INDIA'),   # ends before the globe's "no military aircraft" toast
    ('lookup', 1, 150, 3.6, 'HOLD YOUR PHONE', 'UP TO THE SKY'),
]
END = 2.8   # the end card, over the last Look up frame


def textfile(tmp, name, txt):
    p = os.path.join(tmp, name + '.txt')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(txt)
    return p.replace(os.sep, '/').replace(':', '\\:')


def draw(tmp, name, txt, col, size, y, grow=True, border=9):
    s = f"'{size}*min(1,0.7+t*1.5)'" if grow else str(size)
    return (f"drawtext=expansion=none:fontfile='{FONT}':textfile='{textfile(tmp, name, txt)}':fontcolor={col}:fontsize={s}:"
            f"borderw={border}:bordercolor=black@0.9:shadowx=0:shadowy=6:shadowcolor=black@0.5:x=(w-text_w)/2:y={y}")


def main():
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        args, chains = [ff, '-y', '-loglevel', 'error'], []
        for i, (clip, first, n, secs, l1, l2) in enumerate(CUTS):
            d = os.path.join(FRAMES, clip)
            if not os.path.exists(os.path.join(d, f'frame_{first:05d}.jpg')):
                raise SystemExit(f'missing frames: {d} (run brand/tools/india_clips.mjs first)')
            args += ['-framerate', str(FPS), '-start_number', str(first), '-i', os.path.join(d, 'frame_%05d.jpg')]
            speed = secs / (n / FPS)
            f = [f'trim=end_frame={n}', f'setpts=PTS*{speed:.4f}', f'fps={FPS}', 'scale=1080:1920:flags=lanczos:out_range=tv', 'setsar=1',
                 draw(tmp, f'c{i}a', l1, WHITE, 116, 'h*0.15'), draw(tmp, f'c{i}b', l2, GREEN, 116, 'h*0.15+128'),
                 f'trim=duration={secs}', 'setpts=PTS-STARTPTS', 'format=yuv420p']
            chains.append(f'[{i}:v]' + ','.join(f) + f'[v{i}]')
        # the end card: the last Look up frame, darkened, with the offer and the address
        last = CUTS[-1]
        args += ['-loop', '1', '-framerate', str(FPS), '-t', str(END), '-i', os.path.join(FRAMES, last[0], f'frame_{last[1] + last[2] - 1:05d}.jpg')]
        k = len(CUTS)
        end = ['scale=1080:1920:flags=lanczos:out_range=tv', 'setsar=1', 'eq=brightness=-0.32:saturation=0.6',
               draw(tmp, 'e1', 'FREE. NO SIGN-UP.', GREEN, 104, 'h*0.30'),
               draw(tmp, 'e2', 'ISRO LAUNCHES', WHITE, 76, 'h*0.30+170', False, 7),
               draw(tmp, 'e3', 'ISS PASSES OVER YOUR CITY', WHITE, 76, 'h*0.30+260', False, 7),
               draw(tmp, 'e4', 'CYCLONES  ·  QUAKES  ·  AQI', WHITE, 76, 'h*0.30+350', False, 7),
               draw(tmp, 'e5', 'OPEN OVERWATCH', SAFFRON, 84, 'h*0.66', False, 7),
               draw(tmp, 'e6', 'destinjones.github.io/open-overwatch/india', WHITE, 50, 'h*0.66+110', False, 5),
               f'trim=duration={END}', 'setpts=PTS-STARTPTS', 'format=yuv420p']
        chains.append(f'[{k}:v]' + ','.join(end) + f'[v{k}]')
        chains.append(''.join(f'[v{i}]' for i in range(k + 1)) + f'concat=n={k + 1}:v=1:a=0[out]')
        args += ['-filter_complex', ';'.join(chains), '-map', '[out]', '-r', str(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
                 '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-an', OUT]
        subprocess.run(args, check=True)
    print('promo ->', OUT, f'{sum(c[3] for c in CUTS) + END:.1f} s')


if __name__ == '__main__':
    main()
