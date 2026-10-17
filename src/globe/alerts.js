// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Alerts without a server: a calendar file with a reminder (reaches the phone with the site closed), and browser
// notifications while the page is open (re-armed from localStorage on the next visit). Phones only show page
// notifications through a service worker (notify-sw.js, which does nothing else); iPhones only for a home-screen app.
// Reminders fire once (core/ics.js reminderPlan): one missed while the tab or the computer slept fires when the page
// wakes or is opened again, marked late, and a second open tab does not repeat it.
import { toast, store } from './env.js';
import { makeIcs, reminderPlan } from '../core/ics.js';

const MAX_WAIT = 2 ** 31 - 1;   // setTimeout's limit (~24.8 days)
const LOOK = 30e3;              // while one waits, also look every 30 s: a sleeping tab or computer stalls its timer
let regP = null, timer = 0, poll = 0, wired = false;

/** The alerts worker, registered and active (showNotification needs an active one), or null. One promise for all:
 *  a reminder due the moment the page loads waits for the worker instead of missing it. */
function worker() {
  if (!regP && navigator.serviceWorker) {
    const reg = navigator.serviceWorker.register(new URL('./notify-sw.js', import.meta.url).href);
    regP = Promise.race([reg, new Promise(ok => setTimeout(() => ok(null), 8000))]).then(async r => {   // a stalled fetch: on without it
      if (!r) return null;
      const w = !r.active && (r.installing || r.waiting);
      if (w) await new Promise(ok => { const t = setTimeout(ok, 5000); w.addEventListener('statechange', () => { if (w.state === 'activated' || w.state === 'redundant') { clearTimeout(t); ok(); } }); });
      return r.active ? r : null;
    }).catch(() => null).then(r => { if (!r) regP = null; return r; });   // none: try again next time
  }
  return regP || Promise.resolve(null);
}

async function permission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { return false; } }
  if (Notification.permission !== 'granted') return false;
  await worker();
  return true;
}

async function show(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') { toast(`${title} · ${body}`, 12000); return; }   // blocked since: say it on the page
  const o = { body, tag, icon: 'brand/emblem/emblem-256.png', badge: 'brand/emblem/emblem-256.png', data: { url: location.href.split('#')[0] } };
  const fallback = () => { try { new Notification(title, o); } catch (e) { toast(`${title} · ${body}`, 12000); } };
  const reg = await worker();
  if (reg) await reg.showNotification(title, o).catch(fallback); else fallback();
}

const hm = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** Show what is due (each once), keep the rest, and wait for the next. */
function check() {
  clearTimeout(timer); timer = 0;
  const { due, pending, next } = reminderPlan(store.get('alerts', []), Date.now());
  store.set('alerts', pending);   // claimed before shown: another tab, or a late timer, finds nothing to repeat
  for (const a of due) show(a.title, a.late ? `${a.body} (due ${hm(a.at)}: missed while the page was asleep or closed)` : a.body, a.tag);
  if (next != null) timer = setTimeout(check, Math.min(next, MAX_WAIT));
  if (pending.length && !poll) poll = setInterval(check, LOOK); else if (!pending.length && poll) { clearInterval(poll); poll = 0; }
}
function wire() {
  if (wired) return; wired = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  addEventListener('pageshow', check); addEventListener('focus', check);
  addEventListener('storage', e => { if (e.key == null || e.key === 'oo3d.alerts') check(); });   // another tab set or fired one
}

export const Alerts = {
  get list() { return reminderPlan(store.get('alerts', []), Date.now()).pending; },
  has(tag) { return this.list.some(a => a.tag === tag); },
  /** Notify at `at` (ms) while this page is open. Returns false (with a message) if notifications are blocked. */
  async remind(a) {
    if (!(await permission())) { toast('Notifications are blocked or not supported here: use "Add to calendar" instead', 5000); return false; }
    if (a.at - Date.now() > MAX_WAIT) { toast('That is more than 24 days away: too far for a tab reminder. Use "Calendar" instead', 5000); return false; }
    store.set('alerts', [...store.get('alerts', []).filter(x => x && x.tag !== a.tag), a]); wire(); check();
    toast(`Reminder set for ${hm(a.at)} · keep this tab open (or add it to your calendar)`, 5000);
    return true;
  },
  forget(tag) { store.set('alerts', store.get('alerts', []).filter(a => a && a.tag !== tag)); check(); },
  /** Notify now (aurora watch). */
  async now(title, body, tag) { if (await permission()) show(title, body, tag); else toast(`${title} · ${body}`, 12000); },
  permission,
  /** Download a calendar file: [{ uid, start, end, title, details, alarmMin }]. */
  calendar(events, name = 'sky-alert.ics') {
    const url = URL.createObjectURL(new Blob([makeIcs(events)], { type: 'text/calendar' })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10e3);
    const m = events[0] && events[0].alarmMin; toast(`Calendar file saved: open it to add the event${m != null ? ` (reminder ${m} minutes before)` : ''}`, 5000);
  },
  /** Re-arm saved reminders and show any missed while the page was closed (page load). */
  init() {
    wire(); check();
    if (this.list.length && 'Notification' in window && Notification.permission === 'granted') worker();   // ready before the first is due
  },
};
