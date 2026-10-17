// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// A calendar file (iCalendar, RFC 5545) with a reminder: the one alert that reaches a phone with the site closed and no
// server of ours. DOM-free. events: [{ uid, start, end (ms), title, details, alarmMin }].

const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');   // 20270802T100639Z
const text = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
/** Lines longer than 75 octets are folded (a space starts each continuation). */
function fold(line) {
  const out = []; let cur = '', n = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (n + b > 75) { out.push(cur); cur = ' '; n = 1; }
    cur += ch; n += b;
  }
  out.push(cur); return out.join('\r\n');
}

export function makeIcs(events, { now = Date.now() } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Open Overwatch//Sky alerts//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${text(e.uid)}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end ?? e.start + 5 * 60e3)}`,
      `SUMMARY:${text(e.title)}`);
    if (e.details) L.push(`DESCRIPTION:${text(e.details)}`);
    if (e.alarmMin != null) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(e.title)}`, `TRIGGER:-PT${Math.max(0, Math.round(e.alarmMin))}M`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/**
 * Tab reminders [{ tag, at (ms), title, body }] at `now` → { due, pending, next }: what to show now, what is still to
 * come (soonest first) and the ms until the first of those (null for none). Each fires once: the caller stores
 * `pending` (so `due` is gone) before it shows `due`, and a second tab or a late timer then finds nothing to repeat.
 * One that came due while the tab slept (timers stall; a phone may reload the page) is still due up to `grace` ms
 * late, with `late` (ms) when it is over a minute late; older ones are dropped. A tag listed twice keeps the last.
 */
export function reminderPlan(list, now, { grace = 12 * 3600e3 } = {}) {
  const byTag = new Map();
  for (const a of Array.isArray(list) ? list : []) if (a && a.tag != null && Number.isFinite(a.at)) { byTag.delete(String(a.tag)); byTag.set(String(a.tag), a); }
  const due = [], pending = [];
  for (const a of byTag.values()) {
    if (a.at > now) pending.push(a);
    else if (now - a.at <= grace) due.push(now - a.at > 60e3 ? { ...a, late: now - a.at } : a);
  }
  pending.sort((x, y) => x.at - y.at);
  return { due, pending, next: pending.length ? pending[0].at - now : null };
}
