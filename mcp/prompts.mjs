// Ready-made questions (MCP prompts): hosts list them as slash commands or a menu, and each turns a place or a country into
// the request that walks Claude through the right tools in a good order, ending on the globe. The text is the request a
// person would type; arguments are quoted into it as data (one line, cut to 120 characters), never as instructions.
const clean = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/["“”]/g, "'").trim().slice(0, 120);

export const PROMPTS = Object.freeze([
  {
    name: 'situation_report',
    title: 'Situation report for a place',
    description: 'What is happening at and around a place right now: weather, earthquakes, fires, storms, natural events, and the live transit, cameras and traffic where there are some.',
    arguments: [{ name: 'place', description: 'A city, region or landmark ("Lisbon", "Northern California").', required: true }],
    render: a => `Give me a situation report for "${clean(a.place)}" right now, from Open Overwatch's live data. Use weather for the conditions and the next days; earthquakes (the last week, around the place); wildfires; tropical_storms; natural_events nearby; and, where the place has them, transit_vehicles, traffic_cameras (look at the picture you get) and road_speeds (skip any that say the place is outside their coverage, without apologising). Lead with what matters most, keep it short, give the numbers and times with their sources, and say plainly when something is quiet. Finish by calling show_on_globe on the place so I can see it, and give me its link.`,
  },
  {
    name: 'sky_tonight',
    title: "What's in the sky tonight",
    description: 'Tonight from a place: when it gets dark, the clouds, the planets and the Moon, bright satellite passes, meteor showers and the aurora chance.',
    arguments: [{ name: 'place', description: 'Where you will look up from ("Austin", "Reykjavik").', required: true }],
    render: a => `What can I see in the sky tonight from "${clean(a.place)}"? Use night_sky first (darkness, clouds, planets, the Moon, bright passes, showers, the aurora), then sun_and_moon for the exact twilight times, solar_system for anything bright worth pointing out, meteor_showers if one is near its peak, and aurora if the place is far enough north or south. Put it in the order I would see things through the night, in local time, with where to look (direction and height). Then show the night on the globe with show_on_globe and give me the link.`,
  },
  {
    name: 'country_brief',
    title: 'Brief me on a country',
    description: 'A one-page briefing on a country: facts and figures, what is happening there now, and its cables to the world.',
    arguments: [{ name: 'country', description: 'A country name or ISO code ("Chile", "JP").', required: true }],
    render: a => `Brief me on "${clean(a.country)}". Start with country_briefing; then, where it adds something, wildfires and volcanoes in the country, tropical_storms near it, and submarine_cables at its capital or main port. Keep it to one page: the facts first, then what is happening now, then one line on anything unusual. Show the country on the globe with show_on_globe (its country card) and give me the link.`,
  },
  {
    name: 'space_now',
    title: "What's happening in space",
    description: 'Who is up there, where the ISS is, the next launches, close calls in orbit, asteroids passing by and the space weather.',
    arguments: [],
    render: () => `What is happening in space right now? Use people_in_space, where_is_satellite (the ISS), launches (the next few days), close_approaches (the closest few), asteroid_flybys and aurora (the Kp index). Give me a short digest with times in UTC, flag anything unusual (a very close approach, a strong geomagnetic storm, an asteroid inside the Moon's distance), and end by following the ISS on the globe with show_on_globe.`,
  },
  {
    name: 'trip_check',
    title: 'Check a trip between two places',
    description: 'Distance and travel time between two places, the weather at both ends, daylight on the way, and anything that could get in the way.',
    arguments: [{ name: 'from', description: 'Where the trip starts.', required: true }, { name: 'to', description: 'Where it ends.', required: true },
      { name: 'by', description: 'drive, cycle, walk or air (default drive).', required: false }],
    render: a => { const by = /^(drive|cycle|walk|air)$/.test(clean(a.by)) ? clean(a.by) : 'drive'; return `I am going from "${clean(a.from)}" to "${clean(a.to)}" (${by}). Use distance (by ${by}) for how far and how long, weather at both places for the coming days, and sun_and_moon at the destination for when it gets dark. Then check for anything in the way near either end or along the line: earthquakes, wildfires, tropical_storms and natural_events. Tell me plainly whether anything should change my plans. Finish with the distance tool's globe link, which draws the route.`; },
  },
]);
