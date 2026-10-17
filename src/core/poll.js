// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Feeds on timers that rest while the page is hidden: a background tab asks nothing (a phone's battery, and the feeds'
// own servers), and coming back runs each feed whose time came while it was hidden once, a moment apart rather than all
// in the same instant. A feed can keep running hidden (keep(): an armed alert or a followed plane needs its fixes), and
// one whose error says it can never answer here (permanent(e), by default a not-carried feed on the website) stops for
// the visit. DOM-free: the page hands in its clock and timers and says when it hides (document.hidden).

/** A poller: add(ms, fn, opts) runs fn now and every ms (from the start of one run to the next, never two at once);
 *  setHidden(true/false) pauses and resumes. opts: keep() (run even while hidden), permanent(e) (stop for good on this
 *  error), onError(e, fails) (an ordinary failure, fails in a row), onStop(e) (stopped by a permanent error), start
 *  (false: the first run waits ms). Each feed returned has stop(), and stopped / fails / at (when its last run began). */
export function createPoller({ now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = id => clearTimeout(id), stagger = 1500 } = {}) {
  const feeds = new Set();
  let hidden = false;
  const schedule = (f, ms) => { if (f.timer) clearTimer(f.timer); f.timer = setTimer(() => run(f), Math.max(0, ms)); };
  function run(f) {
    f.timer = 0;
    if (f.stopped || f.busy) return;
    if (hidden && !f.keep()) { f.waiting = true; return; }   // its time came while hidden: it runs when the page shows again
    f.waiting = false; f.busy = true; f.at = now();
    Promise.resolve().then(f.fn).then(() => { f.fails = 0; }, e => {
      if (f.permanent(e)) { f.stop(); f.onStop(e); return; }
      f.onError(e, ++f.fails);
    }).finally(() => { f.busy = false; if (!f.stopped) schedule(f, f.at + f.ms - now()); });
  }
  return {
    feeds,
    get hidden() { return hidden; },
    add(ms, fn, { keep = () => false, permanent = e => !!(e && e.notCarried), onError = () => {}, onStop = () => {}, start = true } = {}) {
      const f = { ms, fn, keep, permanent, onError, onStop, fails: 0, at: start ? -Infinity : now(), timer: 0, busy: false, waiting: false, stopped: false,
        stop() { f.stopped = true; f.waiting = false; if (f.timer) clearTimer(f.timer); f.timer = 0; feeds.delete(f); } };
      feeds.add(f);
      if (start) run(f); else schedule(f, ms);
      return f;
    },
    /** The page hid or showed. Showing runs the feeds that came due meanwhile, `stagger` ms apart, in the order added. */
    setHidden(h) {
      hidden = !!h; if (hidden) return;
      let k = 0;
      for (const f of feeds) if (f.waiting) { f.waiting = false; schedule(f, k++ * stagger); }
    },
  };
}
