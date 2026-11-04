// TareMate - reading filter.
//
// Turns a stream of raw recogniser results into "accepted" readings.
// A value is accepted only after `agree` consecutive valid frames produce the
// same text. Invalid frames break the run. If nothing valid has been accepted
// for `uncertainAfterMs`, or frames are stale, the filter reports uncertain.
// Pure: no timers, no DOM. Feed it results with timestamps (ms).

export const FILTER_DEFAULTS = {
  agree: 3,              // consecutive identical valid reads to accept
  uncertainAfterMs: 2500, // no accepted reading for this long => uncertain
};

export function createReadingFilter(opts = {}) {
  const o = { ...FILTER_DEFAULTS, ...opts };
  let runText = null, runCount = 0, runValue = null;
  let accepted = null; // {value, text, timestamp}
  let lastAcceptTime = -Infinity;
  let lastRaw = null;

  return {
    options: o,
    /**
     * @param {{valid:boolean,value:number|null,text:string,timestamp:number}} r
     * @param {{fresh?:boolean}} meta  fresh=false when the camera frame did not change
     * @returns {{accepted: object|null, isNew: boolean, uncertain: boolean, reason: string}}
     */
    push(r, meta = {}) {
      lastRaw = r;
      const now = r.timestamp;
      let isNew = false;
      if (meta.fresh === false) {
        // A frozen frame is not evidence of anything; break the run.
        runText = null; runCount = 0;
      } else if (r.valid) {
        if (r.text === runText) runCount++;
        else { runText = r.text; runCount = 1; runValue = r.value; }
        if (runCount >= o.agree) {
          if (!accepted || accepted.text !== runText) isNew = true;
          accepted = { value: runValue, text: runText, timestamp: now };
          lastAcceptTime = now;
        }
      } else {
        runText = null; runCount = 0;
      }
      const age = now - lastAcceptTime;
      const uncertain = !accepted || age > o.uncertainAfterMs || meta.fresh === false;
      let reason = 'ok';
      if (meta.fresh === false) reason = 'camera frame not updating';
      else if (!accepted) reason = 'no reading yet';
      else if (age > o.uncertainAfterMs) reason = `no confirmed reading for ${(age / 1000).toFixed(1)} s`;
      return { accepted: uncertain ? null : accepted, lastAccepted: accepted, isNew, uncertain, reason, raw: r };
    },
    /** Call periodically even without frames (e.g. camera stalled). */
    check(now) {
      const age = now - lastAcceptTime;
      return !accepted || age > o.uncertainAfterMs;
    },
    reset() {
      runText = null; runCount = 0; runValue = null; accepted = null; lastAcceptTime = -Infinity;
    },
    get lastRaw() { return lastRaw; },
  };
}
