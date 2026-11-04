// TareMate - stability detector.
//
// Keeps a time window of valid readings (fresh frames only) and decides
// whether the display is stable. Pure: feed {value, timestamp} samples.
//
// Stable means, over the last `windowMs`:
//   - at least `minReadings` valid readings,
//   - readings cover most of the window (no long gaps),
//   - at least `inlierFrac` of them lie within `toleranceKg` of the median,
//   - and the inliers' spread (max - min) is within `toleranceKg`.
// The scale in the commissioning video flickers by one count (0.5 kg) at
// rest, e.g. -32.0 / -32.5, so the default tolerance is 0.5 kg.

export const STABILITY_DEFAULTS = {
  windowMs: 2500,
  toleranceKg: 0.5,
  minReadings: 8,
  inlierFrac: 0.85,
  maxGapMs: 800,
};

export function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function createStabilityDetector(opts = {}) {
  const o = { ...STABILITY_DEFAULTS, ...opts };
  let samples = [];

  function prune(now) {
    samples = samples.filter((s) => now - s.timestamp <= o.windowMs);
  }

  return {
    options: o,
    add(value, timestamp) {
      samples.push({ value, timestamp });
      prune(timestamp);
    },
    /** Invalid or stale frame: it is a gap, not a reading. */
    gap(timestamp) { prune(timestamp); },
    reset() { samples = []; },
    evaluate(now) {
      prune(now);
      const n = samples.length;
      if (n < o.minReadings) {
        return { stable: false, reason: `waiting for readings (${n}/${o.minReadings})`, count: n };
      }
      const first = samples[0].timestamp;
      if (now - first < o.windowMs * 0.8) {
        return { stable: false, reason: 'not enough history', count: n };
      }
      let maxGap = 0;
      for (let i = 1; i < n; i++) maxGap = Math.max(maxGap, samples[i].timestamp - samples[i - 1].timestamp);
      maxGap = Math.max(maxGap, now - samples[n - 1].timestamp);
      if (maxGap > o.maxGapMs) {
        return { stable: false, reason: 'readings interrupted', count: n };
      }
      const values = samples.map((s) => s.value);
      const med = median(values);
      const inliers = values.filter((v) => Math.abs(v - med) <= o.toleranceKg + 1e-9);
      if (inliers.length < o.inlierFrac * n) {
        return { stable: false, reason: 'reading is moving', count: n, median: med };
      }
      const spread = Math.max(...inliers) - Math.min(...inliers);
      if (spread > o.toleranceKg + 1e-9) {
        return { stable: false, reason: `spread ${spread.toFixed(1)} kg exceeds tolerance`, count: n, median: med };
      }
      return { stable: true, reason: 'stable', count: n, median: median(inliers), spread };
    },
  };
}
