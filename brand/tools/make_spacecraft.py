# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""Build deep-space spacecraft trajectories for solar.html from JPL Horizons.

    python brand/tools/make_spacecraft.py
    python brand/tools/make_spacecraft.py --only "Aditya-L1,Chandrayaan-2"   # rebuild those, keep the rest of the file

Frame: heliocentric (Sun centre, 500@10) ECLIPTIC J2000, AU, TDB.
Raw Horizons responses are cached in brand/source/horizons/ (or $OO_HORIZONS_CACHE; delete a file to refetch it).
Requests are sequential and at least 1 s apart. --only fetches just the named craft (and the bodies their events need)
and merges them into the existing file in CRAFT order, so adding a mission costs a few requests, not a full rebuild.

Output data/solar/spacecraft.json:
  [{name, id, launch_jd, desc, events: [[jd, text], ...], t0_jd, step_days, n, end_jd, agency, status, alias,
    xyz: [x0, y0, z0, x1, ...],      # sample i is at t0_jd + i*step_days (uniform; interpolate by index)
    local?: {center, gm, t0_jd, step_days, el: [[q km, e, i, node, peri (deg), tp], ...],
             pj: [{tp, t0, step, el: [sets every 30 min for +-3 h around each perijove]}]}}]
  `local` (a craft in orbit around a planet, Juno): Horizons' osculating elements around the planet (CENTER 500@599,
  ecliptic J2000, TDB), one set a day; src/core/craft.js flies the nearest set as a two-body orbit around the planet as
  the view draws it. Perijove passes come out within tens of km (test/fixtures/horizons_juno_perijoves.json: 20-minute
  Horizons vectors for a day either side of three perijoves, written by this script as well). `pj` (the 30-minute sets
  around each periapsis) only for Juno: a Moon orbiter passes periapsis every two hours, Mars Orbiter Mission every three
  days, and a set every 3 days (`step`; 6 hours for Chandrayaan-3) keeps them within ~300 km of Horizons
  (test/fixtures/horizons_isro_orbits.json, written here too). Moon orbiters centre on 500@301 ('moon').
  Craft that spend their first weeks raising their orbit around Earth (the ISRO missions) start their tracks at the burn
  that sent them away (`since`): samples a day or more apart cannot follow an orbit that takes a day or two.
"""
import datetime as dt, hashlib, json, math, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.environ.get('OO_HORIZONS_CACHE') or os.path.join(ROOT, 'brand', 'source', 'horizons')
OUT = os.path.join(ROOT, 'data', 'solar', 'spacecraft.json')
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'

GRID0 = 2440000.5            # sample times are GRID0 + k*step (0h TDB), so 5-day craft share planet samples
LIMIT_JD = None              # set in main(): 2035-01-01 00:00 TDB
CHECK_DATE = '2026-10-02'
MAX_POINTS = 7000

# events: (date 'YYYY-MM-DD[ HH:MM]' | 'auto', text, body for the closest-approach check or None)
# 'auto' events take the closest approach to `body` in the window (date range) given as the 4th item;
# 'end' events sit on the last sample of the track, 'start' events on the first.
# since / until: start or end the heliocentric track there (else it runs over Horizons' whole coverage, to 2035).
CRAFT = [
    dict(name='Voyager 1', id=-31, launch='1977-09-05 12:56', step=5,
         desc='Fastest-receding probe; flew past Jupiter and Saturn/Titan, first craft in interstellar space.',
         events=[('1979-03-05', 'Jupiter flyby', '599'), ('1980-11-12', 'Saturn flyby (Titan close pass)', '699'),
                 ('1990-02-14', '"Pale Blue Dot" family portrait of the Solar System', None),
                 ('1998-02-17', 'Overtook Pioneer 10 as the most distant human-made object', None),
                 ('2004-12-16', 'Crossed the termination shock', None),
                 ('2012-08-25', 'Crossed the heliopause into interstellar space', None)]),
    dict(name='Voyager 2', id=-32, launch='1977-08-20 14:29', step=5,
         desc='Grand Tour probe; the only spacecraft to visit Uranus and Neptune.',
         events=[('1979-07-09', 'Jupiter flyby', '599'), ('1981-08-26', 'Saturn flyby', '699'),
                 ('1986-01-24', 'Uranus flyby (first and only visit)', '799'),
                 ('1989-08-25', 'Neptune flyby (first and only visit)', '899'),
                 ('2007-08-30', 'Crossed the termination shock', None),
                 ('2018-11-05', 'Crossed the heliopause into interstellar space', None)]),
    dict(name='Pioneer 10', id=-23, launch='1972-03-03 01:49', step=5,
         desc='First craft through the asteroid belt and first to fly past Jupiter.',
         events=[('1972-07-15', 'First spacecraft to enter the asteroid belt', None),
                 ('1973-12-04', 'Jupiter flyby (first ever)', '599'),
                 ('1983-06-13', "Crossed Neptune's orbit, leaving the planetary region", None),
                 ('2003-01-23', 'Last signal received', None)]),
    dict(name='Pioneer 11', id=-24, launch='1973-04-06 02:11', step=5,
         desc='Second Jupiter flyby, then the first spacecraft to visit Saturn.',
         events=[('1974-12-03', 'Jupiter flyby', '599'), ('1979-09-01', 'Saturn flyby (first ever)', '699'),
                 ('1995-09-30', 'Last contact', None)]),
    dict(name='New Horizons', id=-98, launch='2006-01-19 19:00', step=5,
         desc='First mission to Pluto, then on to the Kuiper Belt object Arrokoth.',
         events=[('2007-02-28', 'Jupiter gravity assist', '599'), ('2015-07-14 11:49', 'Pluto flyby', '999'),
                 ('2019-01-01 05:33', 'Arrokoth flyby (most distant object ever visited)', None)]),
    dict(name='Parker Solar Probe', id=-96, launch='2018-08-12 07:31', step=2,
         desc='Dives through the solar corona; the closest and fastest human-made object.',
         events=[('2018-10-03', 'Venus flyby 1', '299'), ('2018-11-06', 'First perihelion', None),
                 ('2021-04-28', 'First spacecraft to fly through the solar corona', None),
                 ('2024-11-06', 'Venus flyby 7 (final)', '299'),
                 ('2024-12-24', 'Record perihelion: 6.1 million km above the surface, 191 km/s', None)]),
    dict(name='Europa Clipper', id=-159, launch='2024-10-14 16:06', step=5,
         desc="NASA's Europa mission, studying whether Jupiter's ice moon could support life.",
         events=[('auto', 'Mars gravity assist', '499', ('2025-02-01', '2025-04-01')),
                 ('auto', 'Earth gravity assist', '399', ('2026-11-01', '2027-01-31')),
                 ('auto', 'Jupiter arrival', '599', ('2030-01-01', '2030-08-01'))]),
    dict(name='Psyche', id=-255, launch='2023-10-13 14:19', step=5,
         desc='Electric-propulsion mission to the metal-rich asteroid 16 Psyche.',
         events=[('auto', 'Mars gravity assist', '499', ('2026-03-01', '2026-08-01')),
                 ('end', 'Trajectory ends on final approach to asteroid 16 Psyche (arrival planned 2029)',
                  None)]),
    dict(name='Lucy', id=-49, launch='2021-10-16 09:34', step=5,
         desc="First mission to Jupiter's Trojan asteroids, touring eight asteroids in all.",
         events=[('auto', 'Earth gravity assist 1', '399', ('2022-09-01', '2022-11-30')),
                 ('2023-11-01', 'Dinkinesh flyby (found the moon Selam)', None),
                 ('auto', 'Earth gravity assist 2', '399', ('2024-11-01', '2025-01-31')),
                 ('2025-04-20', 'Donaldjohanson flyby', None),
                 ('2027-08-12', 'Eurybates and its moon Queta flyby', None),
                 ('2027-09-15', 'Polymele flyby', None), ('2028-04-18', 'Leucus flyby', None),
                 ('2028-11-11', 'Orus flyby', None),
                 ('auto', 'Earth gravity assist 3', '399', ('2030-11-01', '2031-02-28')),
                 ('2033-03-02', 'Patroclus-Menoetius binary flyby', None)]),
    dict(name='JUICE', id=-28, launch='2023-04-14 12:14', step=5,
         desc="ESA's Jupiter Icy Moons Explorer, bound for Ganymede, Callisto and Europa.",
         events=[('auto', 'Lunar-Earth double flyby', '399', ('2024-07-15', '2024-09-30')),
                 ('auto', 'Venus gravity assist', '299', ('2025-07-15', '2025-10-15')),
                 ('auto', 'Earth gravity assist', '399', ('2026-08-15', '2026-11-15')),
                 ('auto', 'Final Earth gravity assist', '399', ('2028-11-01', '2029-03-31')),
                 ('end', 'Jupiter arrival (end of the published trajectory)', None)]),
    # ---- added 2026-10-12: missions that orbit, land or sit at L2, and the classics
    dict(name='Juno', id=-61, launch='2011-08-05 16:25', step=1, agency='NASA', status='Orbiting Jupiter',
         local=dict(center='599', key='jupiter', since='2016-07-05 12:00', pj=True),
         desc="Jupiter polar orbiter: skims the cloud tops every few weeks, mapping gravity, magnetism and the deep atmosphere.",
         events=[('auto', 'Earth gravity assist', '399', ('2013-09-15', '2013-10-31')),
                 ('2016-07-05 03:53', 'Jupiter orbit insertion', '599'),
                 ('2021-06-07', 'Ganymede flyby', None),
                 ('2022-09-29', 'Europa flyby at 352 km', None),
                 ('2023-12-30', 'Io flyby at 1,500 km', None),
                 ('end', 'End of the published trajectory', None)]),
    dict(name='James Webb Space Telescope', id=-170, launch='2021-12-25 12:20', step=5, agency='NASA / ESA / CSA',
         status='Observing from Sun-Earth L2', alias=['JWST', 'Webb'],
         desc="The largest space telescope, in a halo orbit around the Sun-Earth L2 point about 1.5 million km beyond Earth.",
         events=[('2022-01-24', 'Arrived at Sun-Earth L2', None),
                 ('2022-07-12', 'First full-colour science images released', None)]),
    dict(name='BepiColombo', id=-121, launch='2018-10-20 01:45', step=2, agency='ESA / JAXA', status='Arriving at Mercury',
         desc="Two orbiters riding together to Mercury on ion engines, after one Earth, two Venus and six Mercury flybys.",
         events=[('auto', 'Earth flyby', '399', ('2020-03-20', '2020-04-30')),
                 ('auto', 'Venus flyby 1', '299', ('2020-09-20', '2020-11-10')),
                 ('auto', 'Venus flyby 2', '299', ('2021-07-20', '2021-08-31')),
                 ('auto', 'Mercury flyby 1', '199', ('2021-09-15', '2021-10-15')),
                 ('auto', 'Mercury flyby 2', '199', ('2022-06-08', '2022-07-08')),
                 ('auto', 'Mercury flyby 3', '199', ('2023-06-05', '2023-07-05')),
                 ('auto', 'Mercury flyby 4', '199', ('2024-08-20', '2024-09-20')),
                 ('auto', 'Mercury flyby 5', '199', ('2024-11-16', '2024-12-16')),
                 ('auto', 'Mercury flyby 6', '199', ('2024-12-24', '2025-01-23')),
                 ('end', 'End of the published trajectory', None)]),
    dict(name='Solar Orbiter', id=-144, launch='2020-02-10 04:03', step=5, agency='ESA / NASA', status='Orbiting the Sun',
         desc="Takes the closest pictures of the Sun and, with Venus flybys tilting its orbit, the first views of its poles.",
         events=[('auto', 'Venus flyby 1', '299', ('2020-12-10', '2021-01-15')),
                 ('auto', 'Venus flyby 2', '299', ('2021-07-25', '2021-08-25')),
                 ('auto', 'Earth flyby', '399', ('2021-11-10', '2021-12-15')),
                 ('2022-03-26', 'First close perihelion: 0.32 AU from the Sun', None),
                 ('auto', 'Venus flyby 3', '299', ('2022-08-20', '2022-09-20')),
                 ('auto', 'Venus flyby 4: orbit tilted to 17 degrees for the first look at the poles', '299',
                  ('2025-02-01', '2025-03-05'))]),
    dict(name='Hera', id=-91, launch='2024-10-07 14:52', step=5, agency='ESA', status='Cruise to Didymos',
         desc="Planetary-defence follow-up: surveys the asteroid pair Didymos and Dimorphos after NASA's DART impact.",
         events=[('auto', 'Mars flyby (and a close look at the moon Deimos)', '499', ('2025-02-20', '2025-04-01')),
                 ('end', 'End of the published trajectory', None)]),
    dict(name='OSIRIS-APEX', id=-64, launch='2016-09-08 23:05', step=5, agency='NASA', status='Cruise to Apophis',
         alias=['OSIRIS-REx'],
         desc="As OSIRIS-REx it brought 121 g of asteroid Bennu to Earth; renamed OSIRIS-APEX, it is bound for Apophis.",
         events=[('auto', 'Earth gravity assist', '399', ('2017-09-01', '2017-10-15')),
                 ('2018-12-03', 'Arrived at asteroid Bennu', None),
                 ('2020-10-20', 'Touched Bennu and collected the sample', None),
                 ('2021-05-10', 'Left Bennu for home', None),
                 ('2023-09-24', 'Sample capsule landed in Utah; the craft flew on as OSIRIS-APEX', None),
                 ('end', 'End of the published trajectory', None)]),
    dict(name='Hayabusa2', id=-37, launch='2014-12-03 04:22', step=5, agency='JAXA', status='Extended mission',
         desc="Returned samples of asteroid Ryugu in 2020, then flew on toward the small fast-spinning asteroid 1998 KY26.",
         events=[('auto', 'Earth swing-by', '399', ('2015-11-15', '2015-12-20')),
                 ('2018-06-27', 'Arrived at asteroid Ryugu', None),
                 ('2019-02-22', 'First touchdown on Ryugu', None),
                 ('2019-07-11', 'Second touchdown, sampling the crater it made', None),
                 ('2020-12-05', 'Sample capsule landed in Woomera, Australia', None),
                 ('end', 'End of the published trajectory', None)]),
    dict(name='Cassini', id=-82, launch='1997-10-15 08:43', step=2, agency='NASA / ESA / ASI', status='Ended 2017',
         desc="Thirteen years orbiting Saturn; dropped ESA's Huygens onto Titan and ended by diving into Saturn.",
         events=[('auto', 'Venus flyby 1', '299', ('1998-04-10', '1998-05-10')),
                 ('auto', 'Venus flyby 2', '299', ('1999-06-10', '1999-07-10')),
                 ('auto', 'Earth flyby', '399', ('1999-08-05', '1999-09-01')),
                 ('2000-12-30', 'Jupiter flyby', '599'),
                 ('2004-07-01 02:48', 'Saturn orbit insertion', None),
                 ('2005-01-14', 'Huygens probe landed on Titan', None),
                 ('2017-09-15 10:31', 'Grand Finale: plunged into Saturn', None)]),
    dict(name='Rosetta', id=-226, launch='2004-03-02 07:17', step=5, agency='ESA', status='Ended 2016',
         desc="First spacecraft to orbit a comet (67P) and to put a lander, Philae, on one.",
         events=[('auto', 'Earth flyby 1', '399', ('2005-02-20', '2005-03-20')),
                 ('auto', 'Mars flyby', '499', ('2007-02-10', '2007-03-10')),
                 ('auto', 'Earth flyby 2', '399', ('2007-11-01', '2007-11-30')),
                 ('2008-09-05', 'Steins flyby', None),
                 ('auto', 'Earth flyby 3', '399', ('2009-11-01', '2009-11-30')),
                 ('2010-07-10', 'Lutetia flyby', None),
                 ('2014-08-06', 'Arrived at comet 67P/Churyumov-Gerasimenko', None),
                 ('2014-11-12', 'Philae landed on the comet', None),
                 ('2016-09-30', 'Mission ended with a controlled landing on 67P', None)]),
    dict(name='Dawn', id=-203, launch='2007-09-27 11:34', step=5, agency='NASA', status='Ended 2018',
         desc="The only craft to orbit two worlds beyond the Earth-Moon system: the asteroid Vesta and the dwarf planet Ceres.",
         events=[('auto', 'Mars gravity assist', '499', ('2009-02-01', '2009-03-05')),
                 ('2011-07-16', 'Entered orbit around Vesta', None),
                 ('2012-09-05', 'Left Vesta', None),
                 ('2015-03-06', 'Entered orbit around Ceres', None),
                 ('2018-11-01', 'Ran out of fuel; still circling Ceres', None)]),
    dict(name='Galileo', id=-77, launch='1989-10-18 16:53', step=5, agency='NASA', status='Ended 2003',
         desc="First Jupiter orbiter; its probe was the first to enter a giant planet's atmosphere.",
         events=[('auto', 'Venus flyby', '299', ('1990-01-25', '1990-02-25')),
                 ('auto', 'Earth flyby 1', '399', ('1990-11-25', '1990-12-25')),
                 ('1991-10-29', 'Gaspra flyby (first close look at an asteroid)', None),
                 ('auto', 'Earth flyby 2', '399', ('1992-11-25', '1992-12-25')),
                 ('1993-08-28', 'Ida flyby: found its moon Dactyl', None),
                 ('1995-12-07', 'Arrived at Jupiter; its probe entered the atmosphere', None),
                 ('2003-09-21', 'Plunged into Jupiter', None)]),
    dict(name='Ulysses', id=-55, launch='1990-10-06 11:47', step=5, agency='ESA / NASA', status='Ended 2009',
         desc="Used Jupiter to swing out of the planets' plane and fly over both poles of the Sun.",
         events=[('1992-02-08', 'Jupiter flyby, out of the ecliptic', '599'),
                 ("1994-09-13", "First pass over the Sun's south pole", None),
                 ("1995-07-31", "First pass over the Sun's north pole", None),
                 ('2009-06-30', 'Mission ended', None)]),
    # ---- added 2026-10-17: ISRO's missions, every one Horizons carries (searched by name: Chandrayaan, Aditya,
    # Mangalyaan). Left out: the Chandrayaan-2 lander (-153, a 4-day track to the failed landing). Launch times and
    # the lander/landing times are from Horizons' own notes on each craft.
    dict(name='Chandrayaan-2', id=-152, launch='2019-07-22 09:13', step=2, since='2019-08-14 06:00', agency='ISRO',
         status='Orbiting the Moon', alias=['Chandrayaan', 'Chandrayaan 2', 'CH-2'],
         local=dict(center='301', key='moon', since='2019-08-20 06:00', step=3),
         desc="India's second Moon mission: its orbiter has mapped the Moon from a 100 km polar orbit since 2019; its Vikram lander was lost in the landing attempt.",
         events=[('2019-08-14', 'Left Earth orbit for the Moon', None),
                 ('2019-08-20 03:32', 'Entered lunar orbit', None),
                 ('2019-09-02 07:45', 'Vikram lander separated from the orbiter', None),
                 ('2019-09-06 20:23', 'Vikram lost 2 km above the surface in its landing attempt', None),
                 ('end', 'End of the published trajectory', None)]),
    dict(name='Chandrayaan-3 propulsion module', id=-169, launch='2023-07-14 09:05', step=0.25, since='2023-08-01 06:00',
         agency='ISRO', status='Back in Earth orbit since 2023', alias=['Chandrayaan-3', 'CH-3 PM', 'Chandrayaan 3'],
         local=dict(center='301', key='moon', since='2023-08-05 18:00', until='2023-10-13 00:00', step=0.25),
         desc="Carried the Vikram lander and Pragyan rover to the Moon, then left lunar orbit for a high Earth orbit, where its SHAPE instrument studies Earth as a distant planet.",
         events=[('2023-08-01', 'Left Earth orbit for the Moon', None),
                 ('2023-08-05', 'Entered lunar orbit', None),
                 ('2023-08-17', 'Vikram lander separated', None),
                 ('2023-08-23 12:32', 'Vikram landed near the lunar south pole (Shiv Shakti Point)', None),
                 ('2023-10-13', 'Left low lunar orbit, looping past the Moon four times on its way out', None),
                 ('end', 'Back in Earth orbit: the published trajectory ends', None)]),
    dict(name='Vikram lander (Chandrayaan-3)', id=-158, launch='2023-07-14 09:05', step=0.25, since='2023-08-01 06:00',
         until='2023-08-23 06:00', agency='ISRO', status='Landed 2023 near the lunar south pole',
         alias=['Vikram', 'Chandrayaan-3 lander', 'Pragyan'],
         local=dict(center='301', key='moon', since='2023-08-05 18:00', until='2023-08-23 06:00', step=0.25),
         desc="India's first soft landing on the Moon, and the first anywhere near its south pole; the Pragyan rover drove off it to study the soil.",
         events=[('2023-08-01', 'Left Earth orbit for the Moon (riding the propulsion module)', None),
                 ('2023-08-05', 'Entered lunar orbit', None),
                 ('2023-08-17', 'Separated from the propulsion module', None),
                 ('2023-08-23 12:32', 'Landed at Shiv Shakti Point, 69.4 S 32.3 E (the drawn track ends in its last orbit)', None)]),
    dict(name='Aditya-L1', id=-156, launch='2023-09-02 06:20', step=2, since='2023-09-19 00:00', agency='ISRO',
         status='Observing the Sun from Sun-Earth L1', alias=['Aditya L1', 'Aditya'],
         desc="India's first solar observatory: watches the Sun's corona, flares and solar wind nonstop from a halo orbit around Sun-Earth L1, 1.5 million km sunward of Earth.",
         events=[('2023-09-19', 'Left Earth orbit for L1', None),
                 ('2024-01-06', 'Entered its halo orbit around Sun-Earth L1', None),
                 ('end', 'End of the published trajectory', None)]),
    dict(name='Mars Orbiter Mission', id=-3, launch='2013-11-05 09:08', step=2, since='2013-12-01 00:00', agency='ISRO',
         status='Ended 2022', alias=['Mangalyaan', 'MOM'],
         local=dict(center='499', key='mars', since='2014-09-24 06:00', step=3),
         desc="Mangalyaan, India's first interplanetary mission: reached Mars orbit at the first attempt in 2014 and worked there for seven and a half years.",
         events=[('2013-11-30', 'Left Earth for Mars', None),
                 ('2014-09-24 02:10', 'Entered Mars orbit, at the first attempt', None),
                 ('2022-10-02', 'Mission declared over (contact was lost in April 2022)', None)]),
    dict(name='Chandrayaan-1', id=-86, launch='2008-10-22 00:52', step=2, agency='ISRO', status='Silent since 2009',
         alias=['Chandrayaan 1', 'CH-1'],
         local=dict(center='301', key='moon', since='2016-07-03 00:00', step=3),
         desc="India's first Moon mission found signs of water on the Moon; contact was lost in 2009, and NASA radar found the silent craft still circling the Moon in 2016.",
         events=[('2008-11-08', 'Entered lunar orbit', None),
                 ('2008-11-14', 'Its Moon Impact Probe struck near the south pole', None),
                 ('2009-08-29', 'Contact lost', None),
                 ('start', 'Found again by NASA radar, still in lunar orbit (the published track starts)', None)]),
]


# agency and status for the first ten (the later entries carry their own)
STATUS = {'Voyager 1': ('NASA', 'In interstellar space'), 'Voyager 2': ('NASA', 'In interstellar space'),
          'Pioneer 10': ('NASA', 'Silent since 2003'), 'Pioneer 11': ('NASA', 'Silent since 1995'),
          'New Horizons': ('NASA', 'In the Kuiper Belt'), 'Parker Solar Probe': ('NASA', 'Orbiting the Sun'),
          'Europa Clipper': ('NASA', 'Cruise to Jupiter'), 'Psyche': ('NASA', 'Cruise to asteroid Psyche'),
          'Lucy': ('NASA', 'Touring Trojan asteroids'), 'JUICE': ('ESA', 'Cruise to Jupiter')}


def step_str(step):
    """Horizons STEP_SIZE for a step in days ('5 d'; under a day in hours, '6 h')."""
    return f'{step} d' if step >= 1 else f'{round(step * 24)} h'


def jd_of(s):
    d = dt.datetime.strptime(s, '%Y-%m-%d %H:%M') if ' ' in s else dt.datetime.strptime(s, '%Y-%m-%d')
    return (d - dt.datetime(2000, 1, 1, 12)).total_seconds() / 86400 + 2451545.0


def date_of(jd):
    return (dt.datetime(2000, 1, 1, 12) + dt.timedelta(days=jd - 2451545.0)).strftime('%Y-%m-%d %H:%M')


_last = [0.0]


def horizons(command, start, stop, step):
    params = dict(format='json', COMMAND=f"'{command}'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'",
                  EPHEM_TYPE="'VECTORS'", CENTER="'500@10'", REF_PLANE="'ECLIPTIC'", REF_SYSTEM="'ICRF'",
                  VEC_TABLE="'1'", OUT_UNITS="'AU-D'", CSV_FORMAT="'YES'", VEC_LABELS="'NO'",
                  START_TIME=f"'{start}'", STOP_TIME=f"'{stop}'", STEP_SIZE=f"'{step}'")
    url = API + '?' + urllib.parse.urlencode(params)
    key = re.sub(r'[^0-9A-Za-z_-]', '_', f'{command}_{start}_{stop}_{step}')
    path = os.path.join(CACHE, key + '_' + hashlib.sha1(url.encode()).hexdigest()[:8] + '.json')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    wait = 1.0 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    print(f'  horizons {command} {start} .. {stop} step {step}')
    req = urllib.request.Request(url, headers={'User-Agent': 'open-overwatch make_spacecraft.py'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read().decode('utf-8'))
            break
        except Exception as e:
            if attempt == 2:
                raise
            print('    retry after', e)
            time.sleep(5)
    _last[0] = time.time()
    os.makedirs(CACHE, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    return data


def coverage_error(data, which):
    """Parse 'No ephemeris for target ... prior to|after A.D. 1977-SEP-05 13:59:24.3830 TDB'."""
    text = (data.get('error') or '') + (data.get('result') or '')
    m = re.search(which + r' A\.D\. (\d{4})-([A-Z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2})', text)
    if not m:
        return None
    mon = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split().index(m.group(2)) + 1
    d = dt.datetime(int(m.group(1)), mon, int(m.group(3)), int(m.group(4)), int(m.group(5)), int(m.group(6)))
    return (d - dt.datetime(2000, 1, 1, 12)).total_seconds() / 86400 + 2451545.0


def parse_vectors(data):
    res = data.get('result') or ''
    if '$$SOE' not in res:
        return None
    body = res.split('$$SOE', 1)[1].split('$$EOE', 1)[0]
    rows = []
    for line in body.strip().splitlines():
        p = [s.strip() for s in line.split(',')]
        rows.append((float(p[0]), float(p[2]), float(p[3]), float(p[4])))
    return rows


def fetch_track(craft):
    cid, step = str(craft['id']), craft['step']
    probe = horizons(cid, '1950-01-01', '2035-01-01', '1000 d')
    start = coverage_error(probe, 'prior to')
    if start is None:
        sys.exit(f"{craft['name']}: could not read coverage start from Horizons:\n{probe.get('error') or probe.get('result', '')[:800]}")
    # first grid point >= 6 h after coverage start (and at or after `since`); the last at or before 2035 (and `until`)
    t0 = GRID0 + math.ceil((max(start + 0.25, jd_of(craft.get('since', '1900-01-01'))) - GRID0) / step) * step
    stop = GRID0 + math.floor((min(LIMIT_JD, jd_of(craft.get('until', '2100-01-01'))) - GRID0) / step) * step
    fmt = (lambda jd: f'JD{jd:.1f}') if step >= 1 else (lambda jd: f'JD{jd:.4f}')
    for _ in range(3):
        data = horizons(cid, fmt(t0), fmt(stop), step_str(step))
        rows = parse_vectors(data)
        if rows:
            break
        end = coverage_error(data, 'after')
        if end is None:
            sys.exit(f"{craft['name']}: Horizons error:\n{data.get('error') or data.get('result', '')[:800]}")
        stop = GRID0 + math.floor((end - 0.25 - GRID0) / step) * step
    else:
        sys.exit(f"{craft['name']}: no data")
    for a, b in zip(rows, rows[1:]):
        assert abs(b[0] - a[0] - step) < 1e-6, (craft['name'], a[0], b[0])
    if len(rows) > MAX_POINTS:
        print(f"  warning: {craft['name']} has {len(rows)} points (> {MAX_POINTS})")
    return start, rows


def horizons_q(params, key):
    """A cached Horizons call with arbitrary parameters (elements, planet-centred vectors)."""
    url = API + '?' + urllib.parse.urlencode(params)
    path = os.path.join(CACHE, re.sub(r'[^0-9A-Za-z_-]', '_', key) + '_' + hashlib.sha1(url.encode()).hexdigest()[:8] + '.json')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    wait = 1.0 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    print(f'  horizons {key}')
    req = urllib.request.Request(url, headers={'User-Agent': 'open-overwatch make_spacecraft.py'})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read().decode('utf-8'))
    _last[0] = time.time()
    os.makedirs(CACHE, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    return data


def fetch_local(craft, end_jd):
    """Osculating elements around the planet (or the Moon), one set a day or every `step` days: {center, gm, t0_jd, step_days, el, pj}."""
    L = craft['local']
    step = L.get('step', 1)
    t0 = GRID0 + math.ceil((jd_of(L['since']) - GRID0) / step) * step   # first grid time (0h TDB for daily sets) after `since`
    if L.get('until'):
        end_jd = min(end_jd, GRID0 + math.floor((jd_of(L['until']) - GRID0) / step) * step)
    span = (f"'JD{t0:.1f}'", f"'JD{end_jd:.1f}'") if step >= 1 else (f"'JD{t0:.4f}'", f"'JD{end_jd:.4f}'")
    key = f"el_{craft['id']}_{L['center']}_{t0}_{end_jd}" + ('' if step == 1 else f'_{step}')
    data = horizons_q(dict(format='json', COMMAND=f"'{craft['id']}'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'", EPHEM_TYPE="'ELEMENTS'",
                           CENTER=f"'500@{L['center']}'", REF_PLANE="'ECLIPTIC'", REF_SYSTEM="'ICRF'", OUT_UNITS="'KM-S'", CSV_FORMAT="'YES'",
                           START_TIME=span[0], STOP_TIME=span[1], STEP_SIZE=f"'{step_str(step)}'"), key)
    res = data['result']
    gm = float(re.search(r'Keplerian GM\s*:\s*([0-9.Ee+-]+)', res).group(1))
    body = res.split('$$SOE', 1)[1].split('$$EOE', 1)[0]
    el = []
    for line in body.strip().splitlines():
        c = [x.strip() for x in line.split(',')]
        jd, ec, qr, inc, om, w, tp = float(c[0]), float(c[2]), float(c[3]), float(c[4]), float(c[5]), float(c[6]), float(c[7])
        if L.get('pj'):
            el.append([round(qr), round(ec, 7), round(inc, 5), round(om % 360, 5), round(w % 360, 5), round(tp, 5)])   # ~1 km
        else:   # sets 3 days apart are good to ~300 km (checked against Horizons vectors): coarser is plenty
            el.append([round(qr), round(ec, 6), round(inc, 4), round(om % 360, 4), round(w % 360, 4), round(tp, 5)])
        assert abs(jd - (t0 + (len(el) - 1) * step)) < 1e-6, (craft['name'], jd)
    if not L.get('pj'):
        return dict(center=L['key'], gm=gm, t0_jd=t0, step_days=step, el=el, pj=[])
    # each perijove once (the daily sets name it from either side: take it from the set nearest to it), then element
    # sets every 30 minutes for 3 hours either side of it (fetched every 15 minutes for 6 hours): near the planet its
    # oblateness turns the osculating orbit fast, and a set an hour away already misses the pass by ~1,000 km
    by = {}
    for k, e in enumerate(el):
        if e[1] >= 1:
            continue
        key = round(e[5] / 3)
        if key not in by or abs(t0 + k - e[5]) < abs(t0 + by[key][0] - by[key][1]):
            by[key] = (k, e[5])
    tps = sorted(v[1] for v in by.values() if t0 + 1 < v[1] < t0 + len(el) - 2)
    tps = [t for i, t in enumerate(tps) if i == 0 or t - tps[i - 1] > 2]
    pj = []
    for tp in tps:
        a = round(tp * 96) / 96 - 0.25   # on a 15-minute grid
        d = horizons_q(dict(format='json', COMMAND=f"'{craft['id']}'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'", EPHEM_TYPE="'ELEMENTS'",
                            CENTER=f"'500@{L['center']}'", REF_PLANE="'ECLIPTIC'", REF_SYSTEM="'ICRF'", OUT_UNITS="'KM-S'", CSV_FORMAT="'YES'",
                            START_TIME=f"'JD{a:.6f}'", STOP_TIME=f"'JD{a + 0.5:.6f}'", STEP_SIZE="'15 m'"), f"elpj15_{craft['id']}_{a:.4f}")
        sets = []
        for line in d['result'].split('$$SOE', 1)[1].split('$$EOE', 1)[0].strip().splitlines():
            c = [x.strip() for x in line.split(',')]
            sets.append([round(float(c[3])), round(float(c[2]), 7), round(float(c[4]), 5), round(float(c[5]) % 360, 5), round(float(c[6]) % 360, 5), round(float(c[7]), 6)])
        # keep every other set for 3 h either side (checked against the fixture: worst 122 km off Horizons over the
        # day around a pass, vs 66 km for all of them at twice the size)
        pj.append(dict(tp=round(tp, 6), t0=round(a + 0.125, 6), step=1 / 48, el=sets[12:37:2]))
    return dict(center=L['key'], gm=gm, t0_jd=t0, step_days=1, el=el, pj=pj)


# Horizons vectors around the centre body for a few days of each kind of ISRO orbit -> test/fixtures/horizons_isro_orbits.json
# (the orbits drawn from the sets every 3 days, or 6 hours, are checked against them: test/whereis.test.mjs)
LOCAL_CHECKS = [('Chandrayaan-2', '2026-10-01', '2026-10-05', '20 m', 6), ('Mars Orbiter Mission', '2018-03-01', '2018-03-08', '30 m', 6),
                ('Chandrayaan-3 propulsion module', '2023-08-25', '2023-08-27', '20 m', 6)]


def local_fixture(crafts):
    by = {c['name']: c for c in crafts}
    if not all(n in by for n, *_ in LOCAL_CHECKS):
        return
    out = {'source': 'JPL Horizons vectors around the centre body (500@301 Moon, 500@499 Mars), ecliptic J2000, km, JD TDB', 'craft': {}}
    for name, a, b, step, every in LOCAL_CHECKS:
        c = by[name]
        data = horizons_q(dict(format='json', COMMAND=f"'{c['id']}'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'", EPHEM_TYPE="'VECTORS'",
                               CENTER=f"'500@{c['local']['center']}'", REF_PLANE="'ECLIPTIC'", REF_SYSTEM="'ICRF'", VEC_TABLE="'1'",
                               OUT_UNITS="'KM-S'", CSV_FORMAT="'YES'", VEC_LABELS="'NO'", START_TIME=f"'{a}'", STOP_TIME=f"'{b}'", STEP_SIZE=f"'{step}'"),
                         f"chk_{c['id']}_{a}")
        rows = parse_vectors(data)[::every]
        out['craft'][name] = {'center': c['local']['key'], 'rows': [[r[0], round(r[1], 1), round(r[2], 1), round(r[3], 1)] for r in rows]}
    path = os.path.join(ROOT, 'test', 'fixtures', 'horizons_isro_orbits.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f"  fixture {os.path.basename(path)}: {', '.join(n for n, *_ in LOCAL_CHECKS)}")


def perijove_fixture(craft, local, n=3):
    """20-minute planet-centred Horizons vectors (km, TDB) for +-1 day around three perijoves -> the test fixture."""
    tps = [p['tp'] for p in local['pj']]
    pick = [tps[1], tps[len(tps) // 2], tps[-2]] if len(tps) > 3 else tps[:n]
    out = {'source': f"JPL Horizons, {craft['name']} around {local['center']} (500@{craft['local']['center']}), ecliptic J2000, km, JD TDB", 'passes': []}
    for tp in pick:
        a, b = tp - 1, tp + 1
        data = horizons_q(dict(format='json', COMMAND=f"'{craft['id']}'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'", EPHEM_TYPE="'VECTORS'",
                               CENTER=f"'500@{craft['local']['center']}'", REF_PLANE="'ECLIPTIC'", REF_SYSTEM="'ICRF'", VEC_TABLE="'1'",
                               OUT_UNITS="'KM-S'", CSV_FORMAT="'YES'", VEC_LABELS="'NO'", START_TIME=f"'JD{a:.6f}'", STOP_TIME=f"'JD{b:.6f}'", STEP_SIZE="'20 m'"),
                         f"pj_{craft['id']}_{tp}")
        out['passes'].append({'tp': tp, 'rows': [[r[0], round(r[1], 2), round(r[2], 2), round(r[3], 2)] for r in parse_vectors(data)]})
    path = os.path.join(ROOT, 'test', 'fixtures', 'horizons_juno_perijoves.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f"  fixture {os.path.basename(path)}: perijoves {[date_of(t) for t in pick]}")


def lagrange3(times, xyz, t):
    """Quadratic interpolation of a uniform series at time t."""
    step = times[1] - times[0]
    i = min(max(int(round((t - times[0]) / step)), 1), len(times) - 2)
    u = (t - times[i]) / step
    w = (u * (u - 1) / 2, 1 - u * u, u * (u + 1) / 2)
    return tuple(sum(w[k] * xyz[i - 1 + k][c] for k in range(3)) for c in range(3))


def closest(rows, body_rows, lo, hi):
    """Closest approach between craft samples and a body inside [lo, hi] -> (jd, dist AU).
    Refined with a parabola through d^2 of the three samples around the minimum (exact for a straight-line
    pass, d^2 = b^2 + v^2 (t - tc)^2)."""
    bt = [r[0] for r in body_rows]
    bx = [r[1:] for r in body_rows]
    sep = lambda r: math.dist(r[1:], lagrange3(bt, bx, r[0]))
    cand = [(i, sep(r)) for i, r in enumerate(rows) if lo <= r[0] <= hi]
    if not cand:
        return None
    i, d = min(cand, key=lambda c: c[1])
    if not 0 < i < len(rows) - 1:
        return rows[i][0], d
    y0, y1, y2 = sep(rows[i - 1]) ** 2, d * d, sep(rows[i + 1]) ** 2
    den = y0 - 2 * y1 + y2
    if den <= 0:
        return rows[i][0], d
    off = max(-1.0, min(1.0, 0.5 * (y0 - y2) / den))
    ymin = y1 - 0.25 * (y0 - y2) * off
    return rows[i][0] + off * (rows[1][0] - rows[0][0]), math.sqrt(max(ymin, 0.0))


def main():
    global LIMIT_JD
    LIMIT_JD = jd_of('2035-01-01')
    only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
    if only and only - {c['name'] for c in CRAFT}:
        sys.exit(f"--only: no craft called {', '.join(sorted(only - {c['name'] for c in CRAFT}))}")
    crafts = [c for c in CRAFT if not only or c['name'] in only]
    tracks = {}
    for c in crafts:
        print(c['name'])
        tracks[c['name']] = fetch_track(c)

    # bodies for flyby checks / auto event dates: one 5-day series covering every craft
    first = min(rows[0][0] for _, rows in tracks.values()) - 10
    bodies = sorted({e[2] for c in crafts for e in c['events'] if e[2]})
    body_rows = {}
    for b in bodies:
        lo = GRID0 + math.floor((first - GRID0) / 5) * 5
        data = horizons(b, f'JD{lo:.1f}', f'JD{LIMIT_JD:.1f}', '5 d')
        body_rows[b] = parse_vectors(data)
        if not body_rows[b]:
            sys.exit(f'body {b}: {data.get("error") or data.get("result", "")[:800]}')

    out = []
    print('\nEvents (curated date vs closest approach on the sampled track):')
    for c in crafts:
        start, rows = tracks[c['name']]
        events = [[round(jd_of(c['launch']), 4), 'Launch']]
        for e in c['events']:
            date, text, body = e[0], e[1], e[2]
            if date == 'end':
                jd = rows[-1][0]
            elif date == 'start':
                jd = rows[0][0]
            elif date == 'auto':
                lo, hi = jd_of(e[3][0]), jd_of(e[3][1])
                ca = closest(rows, body_rows[body], lo, hi)
                if ca is None:
                    print(f"  {c['name']}: {text}: outside the track, dropped")
                    continue
                jd = ca[0]
                print(f"  {c['name']:18s} {text:34s} auto  {date_of(jd)}  {ca[1] * 149597870.7:12,.0f} km")
            else:
                jd = jd_of(date)
                if body:
                    ca = closest(rows, body_rows[body], jd - 20, jd + 20)
                    if ca:
                        print(f"  {c['name']:18s} {text:34s} {date[:10]}  ca {date_of(ca[0])}  "
                              f"{ca[1] * 149597870.7:12,.0f} km")
            events.append([round(jd, 4), text])
        events.sort()
        step = c['step']
        xyz = []
        for r in rows:
            xyz.extend(round(v, 5) for v in r[1:])
        if c.get('local'):
            local = fetch_local(c, rows[-1][0])
            print(f"  {c['name']}: {len(local['el'])} element sets every {local['step_days']} d around {local['center']}, GM {local['gm']}")
            if local['pj']:
                perijove_fixture(c, local)
        out.append(dict(name=c['name'], id=c['id'], launch_jd=round(jd_of(c['launch']), 4), desc=c['desc'],
                        events=events, t0_jd=rows[0][0], step_days=step, n=len(rows), end_jd=rows[-1][0],
                        coverage_start_jd=round(start, 4), agency=c.get('agency') or STATUS[c['name']][0],
                        status=c.get('status') or STATUS[c['name']][1], alias=c.get('alias', []), xyz=xyz,
                        **({'local': local} if c.get('local') else {})))

    local_fixture(crafts)
    if only:   # merge into the file as it is, in CRAFT order
        with open(OUT, encoding='utf-8') as f:
            have = {o['name']: o for o in json.load(f)}
        have.update({o['name']: o for o in out})
        out = [have[c['name']] for c in CRAFT if c['name'] in have]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))

    print('\nTracks:')
    for o in out:
        print(f"  {o['name']:18s} {date_of(o['t0_jd'])[:10]} .. {date_of(o['end_jd'])[:10]}  "
              f"{o['n']:5d} pts @ {o['step_days']} d")
    tc = jd_of(CHECK_DATE)
    print(f'\nHeliocentric distance on {CHECK_DATE} 00:00 TDB:')
    for o in out:
        if o['t0_jd'] <= tc <= o['end_jd']:
            n, s = o['n'], o['step_days']
            pts = [o['xyz'][3 * i:3 * i + 3] for i in range(n)]
            p = lagrange3([o['t0_jd'] + i * s for i in range(n)], pts, tc)
            print(f"  {o['name']:18s} {math.hypot(*p):8.3f} AU")
    print(f'\nspacecraft.json {os.path.getsize(OUT):,} B')


if __name__ == '__main__':
    main()
