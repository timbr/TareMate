// TareMate - find the weight digits in a whole camera frame.
//
// Pure module (no DOM): takes an ImageData-like {width, height, data} of the
// full frame (ideally downscaled to ~640 px wide) and returns suggested ROIs
// as fractions of the frame, covering the sign slot and the weight digits.
//
// Method:
//   1. "Blue ink" map (same measure as the reader) and a local-contrast mask.
//      A backlit LCD shows up as one big bright-blue blob; each such blob is
//      re-thresholded on its own (Otsu) so the digits separate from the panel.
//   2. Look for the weight's structure: 2-4 tall digits of equal height in a
//      row, a small decimal point before the last one, and (usually) a minus
//      to the left.
//   3. The display layout is fixed (sign slot far left, digits right aligned,
//      "kg" further right), so the ROI is laid out from the last digit.
//
// Candidates are only suggestions: the caller confirms one by running the
// reader on the crop (see app.js autoLocate()).

import { components, otsu, suppressLines, removeThinRows } from './weight-reader.js';

export const LOCATOR_DEFAULTS = {
  window: 0.06,      // local-mean window radius as a fraction of frame width
  offset: 18,        // ink must exceed the local mean by this much
  minInk: 30,        // and be at least this blue in absolute terms
  minRegionContrast: 25,
  minDigitH: 0.03,   // digit height as a fraction of frame height
  maxDigitH: 0.6,
  signSpanH: 3.6,    // ROI left edge = last digit right edge - this * H (at least)
  rightPadH: 0.28,
  vPadH: 0.22,
};

function inkOf(r, g, b) { return b - (r * 0.75 + g * 0.25); }

/** Mean filter via integral image. */
function boxMean(src, w, h, rad) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
      const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Clear horizontal runs longer than maxX and vertical runs longer than maxY
 * (panel borders, button outlines). Digit strokes are much shorter.
 */
export function removeLongRuns(mask, w, h, maxX, maxY) {
  const kill = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && mask[y * w + x];
      if (on && start < 0) start = x;
      if (!on && start >= 0) { if (x - start > maxX) for (let k = start; k < x; k++) kill[y * w + k] = 1; start = -1; }
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && mask[y * w + x];
      if (on && start < 0) start = y;
      if (!on && start >= 0) { if (y - start > maxY) for (let k = start; k < y; k++) kill[k * w + x] = 1; start = -1; }
    }
  }
  for (let i = 0; i < mask.length; i++) if (kill[i]) mask[i] = 0;
}

/** Search a component list for "digits + decimal point (+ minus)" rows. */
function findChains(comps, o, W, Hh, cands, weight) {
  const minH = o.minDigitH * Hh, maxH = o.maxDigitH * Hh;
  const tall = comps.filter((c) => c.h >= minH && c.h <= maxH &&
    c.w / c.h >= 0.12 && c.w / c.h <= 0.85 && c.area >= 0.12 * c.w * c.h && c.area <= 0.8 * c.w * c.h);
  for (const last of tall) {
    const H = last.h;
    const dot = comps.find((d) => d.x1 < last.x0 && d.x1 >= last.x0 - 0.45 * H &&
      d.h <= 0.3 * H && d.w <= 0.3 * H && d.w >= 0.04 * H && d.area >= 2 &&
      d.y0 >= last.y0 - 0.1 * H && d.y1 <= last.y1 + 0.1 * H);
    if (!dot) continue;
    const chain = [last];
    let edge = dot.x0;
    for (;;) {
      const prev = tall.filter((c) => !chain.includes(c) && c.x1 <= edge + 1 && c.x1 >= edge - 0.6 * H &&
        Math.abs(c.h - H) <= 0.15 * H && Math.abs(c.y0 - last.y0) <= 0.15 * H)
        .sort((a, b) => b.x1 - a.x1)[0];
      if (!prev) break;
      chain.unshift(prev);
      edge = prev.x0;
      if (chain.length >= 4) break;
    }
    if (chain.length < 2) continue;
    const first = chain[0];
    const mid = (last.y0 + last.y1) / 2;
    const minus = comps.find((c) => c.x1 < first.x0 && c.x0 >= last.x1 - (o.signSpanH + 0.6) * H &&
      c.w >= 1.4 * c.h && c.w >= 0.2 * H && c.w <= 0.8 * H && c.h <= 0.3 * H &&
      Math.abs((c.y0 + c.y1) / 2 - mid) < 0.25 * H);
    const right = last.x1 + o.rightPadH * H;
    const left = Math.min(minus ? minus.x0 - 0.3 * H : Infinity, last.x1 - o.signSpanH * H, first.x0 - 0.3 * H);
    const top = last.y0 - o.vPadH * H, bot = last.y1 + o.vPadH * H;
    const x0 = Math.max(0, left), x1 = Math.min(W, right), y0 = Math.max(0, top), y1 = Math.min(Hh, bot);
    if (x1 - x0 < 2 * H || y1 - y0 < H) continue;
    const heightAgree = 1 - chain.reduce((s, c) => s + Math.abs(c.h - H), 0) / (chain.length * H);
    const score = weight * (minus ? 1 : 0.6) * heightAgree * Math.min(1, H / (0.06 * Hh) + 0.5);
    cands.push({ roi: { x: x0 / W, y: y0 / Hh, w: (x1 - x0) / W, h: (y1 - y0) / Hh }, score, H: H / Hh, digits: chain.length, sign: !!minus });
  }
}

/**
 * @returns {Array<{roi:{x,y,w,h}, score:number, H:number, digits:number, sign:boolean}>}
 *          candidates, best first (may be empty)
 */
export function locateDisplay(img, opts = {}) {
  const o = { ...LOCATOR_DEFAULTS, ...opts };
  const { width: W, height: Hh, data } = img;
  const n = W * Hh;
  const ink = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) ink[i] = inkOf(data[p], data[p + 1], data[p + 2]);
  const mean = boxMean(ink, W, Hh, Math.max(4, Math.round(o.window * W)));
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = ink[i] > mean[i] + o.offset && ink[i] > o.minInk ? 1 : 0;
  const { comps: coarse } = components(mask, W, Hh);
  const cands = [];
  // Pale (unlit) panel: the digits are separate blobs once border lines are gone.
  const lines = mask.slice();
  removeLongRuns(lines, W, Hh, Math.round(o.maxDigitH * Hh * 0.9), Math.round(o.maxDigitH * Hh));
  removeLongRuns(lines, W, Hh, Math.round(0.09 * W), Math.round(0.16 * Hh));
  findChains(components(lines, W, Hh).comps, o, W, Hh, cands, 0.9);
  // Backlit panel: re-threshold inside each big rectangular blue blob.
  for (const reg of coarse) {
    const ar = reg.w / reg.h;
    if (!(reg.area >= 0.004 * n && ar >= 1.3 && ar <= 7 && reg.area >= 0.35 * reg.w * reg.h)) continue;
    const ox = reg.x0, oy = reg.y0, rw = reg.w, rh = reg.h;
    const vals = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) vals[y * rw + x] = ink[(y + oy) * W + x + ox];
    const { threshold, lo, hi } = otsu(vals);
    if (hi - lo < o.minRegionContrast) continue;
    const m = new Uint8Array(rw * rh);
    // Clear the panel's own border so it cannot bridge the digits.
    const mx = Math.max(2, Math.round(0.03 * rw)), my = Math.max(2, Math.round(0.06 * rh));
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      m[i] = vals[i] > threshold && x >= mx && x < rw - mx && y >= my && y < rh - my ? 1 : 0;
    }
    suppressLines(m, rw, rh);
    removeThinRows(m, rw, rh);
    const comps = components(m, rw, rh).comps.map((c) => ({ ...c, x0: c.x0 + ox, x1: c.x1 + ox, y0: c.y0 + oy, y1: c.y1 + oy }));
    findChains(comps, o, W, Hh, cands, 1);
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) {
    if (!out.some((k) => Math.abs(k.roi.x - c.roi.x) < 0.02 && Math.abs(k.roi.y - c.roi.y) < 0.02)) out.push(c);
  }
  return out.slice(0, 5);
}
