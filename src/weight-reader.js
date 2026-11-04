// TareMate - weight reader.
//
// Specialised recogniser for the large dot-matrix weight digits on the
// Auto Scale PRO-WEIGH 2000 display (blue characters on a pale LCD).
//
// Pure module: works on any ImageData-like object {width, height, data}
// (RGBA, as returned by canvas getImageData). No DOM or camera access, so it
// runs in the browser and under Node for tests.
//
// Pipeline:
//   1. "Ink" map = how much bluer than red/green each pixel is.
//   2. Otsu threshold -> binary mask; low contrast => no reading.
//   3. Connected components -> classify as digit / decimal dot / minus / noise.
//   4. Each digit is resampled to a small grid and matched against templates
//      using normalised cross-correlation.
//   5. Structural validation: optional minus, 1-3 digits, a dot, one decimal.
//
// The confidence returned is the weakest digit's match score combined with
// its margin over the runner-up. It is NOT a calibrated probability.

import { DEFAULT_TEMPLATES, GLYPH_W, GLYPH_H } from './digit-templates.js';

export { GLYPH_W, GLYPH_H };

export const READER_DEFAULTS = {
  minContrast: 40,      // blue-excess units between background and ink
  minScore: 0.75,       // minimum NCC for a digit match
  minMargin: 0.08,      // best minus second-best NCC
  minDigitHeightFrac: 0.35, // digit height as fraction of ROI height
  allowedLastDigits: '05',  // display resolution 0.5 kg; '' disables check
  requireSign: true,    // display always shows '+' or '-' in front of the number
  minValue: -150,
  maxValue: 150,
};

/** Blue-excess "ink" value per pixel. */
export function inkMap(img) {
  const { width, height, data } = img;
  const n = width * height;
  const ink = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    // Characters are saturated blue; LCD background is a pale grey/green.
    ink[i] = b - (r * 0.75 + g * 0.25);
  }
  return ink;
}

/** Otsu threshold over an array of values. Returns {threshold, separation}. */
export function otsu(values) {
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  if (!(max > min)) return { threshold: max, lo: min, hi: max };
  const bins = 128;
  const hist = new Float64Array(bins);
  const scale = (bins - 1) / (max - min);
  for (const v of values) hist[Math.round((v - min) * scale)]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = -1, bestT = 0;
  for (let t = 0; t < bins; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  const threshold = min + (bestT + 0.5) / scale;
  // class means for contrast measurement
  let sLo = 0, nLo = 0, sHi = 0, nHi = 0;
  for (const v of values) {
    if (v > threshold) { sHi += v; nHi++; } else { sLo += v; nLo++; }
  }
  return { threshold, lo: nLo ? sLo / nLo : min, hi: nHi ? sHi / nHi : max };
}

/** 8-connected components of a binary mask. */
export function components(mask, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  const comps = [];
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = comps.length;
    const c = { id, x0: width, y0: height, x1: -1, y1: -1, area: 0 };
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const x = i % width, y = (i - x) / width;
      c.area++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (mask[j] && labels[j] === -1) { labels[j] = id; stack.push(j); }
        }
      }
    }
    c.w = c.x1 - c.x0 + 1;
    c.h = c.y1 - c.y0 + 1;
    comps.push(c);
  }
  return { comps, labels };
}

/**
 * Resample a component's bounding box into a GLYPH_W x GLYPH_H grid of
 * normalised ink (0..1), area-averaged. Only pixels of that component count.
 */
export function glyphVector(norm, labels, width, comp) {
  const out = new Float32Array(GLYPH_W * GLYPH_H);
  const sx = comp.w / GLYPH_W, sy = comp.h / GLYPH_H;
  for (let gy = 0; gy < GLYPH_H; gy++) {
    const ya = comp.y0 + gy * sy, yb = ya + sy;
    for (let gx = 0; gx < GLYPH_W; gx++) {
      const xa = comp.x0 + gx * sx, xb = xa + sx;
      let acc = 0, wsum = 0;
      for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
        const wy = Math.min(yb, y + 1) - Math.max(ya, y);
        if (wy <= 0) continue;
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          const wx = Math.min(xb, x + 1) - Math.max(xa, x);
          if (wx <= 0) continue;
          const i = y * width + x;
          const v = labels[i] === comp.id ? norm[i] : 0;
          acc += v * wx * wy; wsum += wx * wy;
        }
      }
      out[gy * GLYPH_W + gx] = wsum ? acc / wsum : 0;
    }
  }
  return out;
}

/** Zero-mean normalised cross-correlation of two equal-length vectors. */
export function ncc(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * Classify one digit glyph against templates.
 * templates: array of {digit: '0'..'9', aspect: w/h, vec: number[]}
 */
export function classifyGlyph(vec, aspect, templates) {
  const best = {};
  for (const t of templates) {
    let s = ncc(vec, t.vec);
    // Penalise aspect mismatch (separates narrow '1' from the rest).
    s -= Math.min(0.5, Math.abs(Math.log(aspect / t.aspect)) * 0.5);
    if (best[t.digit] === undefined || s > best[t.digit]) best[t.digit] = s;
  }
  const ranked = Object.entries(best).sort((a, b) => b[1] - a[1]);
  const [d1, s1] = ranked[0] || ['?', 0];
  const s2 = ranked[1] ? ranked[1][1] : -1;
  return { digit: d1, score: s1, margin: s1 - s2, runnerUp: ranked[1] ? ranked[1][0] : null };
}

function fail(reason, extra = {}) {
  return { valid: false, value: null, text: extra.text ?? '', confidence: 0, reason, ...extra };
}

/**
 * Clear rows / columns that are mostly ink - the blue display border or frame
 * edge creeping into a loose crop. Digit rows never exceed ~45% ink.
 */
export function suppressLines(mask, width, height) {
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) n += mask[y * width + x];
    if (n > 0.6 * width) for (let x = 0; x < width; x++) mask[y * width + x] = 0;
  }
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = 0; y < height; y++) n += mask[y * width + x];
    if (n > 0.85 * height) for (let y = 0; y < height; y++) mask[y * width + x] = 0;
  }
}

/**
 * Remove pixels that are only one pixel tall vertically (thin horizontal
 * slivers from the display border / glare edges that would otherwise bridge
 * neighbouring digits). Digit strokes are several pixels thick.
 */
export function removeThinRows(mask, width, height) {
  const keep = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const up = y > 0 && mask[i - width];
      const down = y < height - 1 && mask[i + width];
      keep[i] = up || down ? 1 : 0;
    }
  }
  mask.set(keep);
}

/**
 * Segment the ROI into glyph components. Exposed for template building and
 * diagnostics.
 */
export function segment(img, opts = {}) {
  const o = { ...READER_DEFAULTS, ...opts };
  const { width, height } = img;
  const ink = inkMap(img);
  const { threshold, lo, hi } = otsu(ink);
  const contrast = hi - lo;
  if (contrast < o.minContrast) return { error: 'low contrast', contrast };
  const norm = new Float32Array(ink.length);
  const mask = new Uint8Array(ink.length);
  for (let i = 0; i < ink.length; i++) {
    norm[i] = Math.max(0, Math.min(1, (ink[i] - lo) / (hi - lo)));
    mask[i] = ink[i] > threshold ? 1 : 0;
  }
  suppressLines(mask, width, height);
  removeThinRows(mask, width, height);
  const { comps, labels } = components(mask, width, height);
  const minArea = Math.max(3, (width * height) / 4000);
  const big = comps.filter((c) => c.area >= minArea);
  // Ignore components spanning most of the ROI width (borders, glare streaks).
  const H = Math.max(0, ...big.filter((c) => c.w < 0.5 * width).map((c) => c.h));
  if (H < height * o.minDigitHeightFrac) {
    return { error: 'no digits', contrast, comps: big, norm, labels, width, height };
  }
  // Digits: tall components sharing the main text band.
  let digits = big.filter((c) => c.h >= 0.7 * H && c.w <= 1.2 * H);
  // keep those vertically aligned with the tallest
  if (!digits.length) return { error: 'no digits', contrast, comps: big, norm, labels, width, height };
  const tallest = digits.reduce((a, c) => (c.h > a.h ? c : a), digits[0]);
  const bandTop = tallest.y0, bandBot = tallest.y1;
  digits = digits.filter((c) => Math.abs(c.y0 - bandTop) < 0.2 * H && Math.abs(c.y1 - bandBot) < 0.2 * H);
  digits.sort((a, b) => a.x0 - b.x0);
  const bandMid = (bandTop + bandBot) / 2;
  const small = big.filter((c) => !digits.includes(c));
  const dots = small.filter((c) => c.h <= 0.3 * H && c.w <= 0.3 * H && c.w >= 0.04 * H &&
    c.y0 >= bandTop - 0.05 * H && c.y1 <= bandBot + 0.05 * H && c.w / c.h > 0.4 && c.w / c.h < 2.5);
  const minuses = small.filter((c) => c.w >= 1.5 * c.h && c.h <= 0.3 * H && c.w >= 0.25 * H &&
    Math.abs((c.y0 + c.y1) / 2 - bandMid) < 0.3 * H);
  const pluses = small.filter((c) => !minuses.includes(c) && c.h >= 0.15 * H && c.h <= 0.45 * H &&
    c.w / c.h > 0.6 && c.w / c.h < 1.6 && Math.abs((c.y0 + c.y1) / 2 - bandMid) < 0.3 * H &&
    c.area < 0.7 * c.w * c.h);
  // Stray ink overlapping the digit band between/inside digits suggests a
  // transitioning (ghosted) display.
  const strays = small.filter((c) => !dots.includes(c) && !minuses.includes(c) && !pluses.includes(c) &&
    c.y1 >= bandTop && c.y0 <= bandBot &&
    digits.length && c.x1 >= digits[0].x0 && c.x0 <= digits[digits.length - 1].x1 &&
    c.area >= 0.02 * H * H);
  return { contrast, H, digits, dots, minuses, pluses, strays, norm, labels, width, height, comps: big };
}

/**
 * Read the weight from an ROI image.
 * @returns {{valid, value, text, confidence, reason, digits?, timestamp}}
 */
export function readWeight(img, options = {}) {
  const o = { ...READER_DEFAULTS, ...options };
  const templates = options.templates || DEFAULT_TEMPLATES;
  const timestamp = options.timestamp ?? Date.now();
  const seg = segment(img, o);
  if (seg.error) return { ...fail(seg.error), timestamp, contrast: seg.contrast };
  const { digits, dots, minuses, pluses, strays, norm, labels, width } = seg;
  if (digits.length < 2) return { ...fail('too few digits'), timestamp };
  if (digits.length > 4) return { ...fail('too many digits'), timestamp };
  if (strays.length) return { ...fail('display changing / stray marks'), timestamp };

  const last = digits[digits.length - 1], prev = digits[digits.length - 2];
  const dot = dots.find((c) => c.x0 > prev.x1 - 1 && c.x1 < last.x0 + 1);
  if (!dot) return { ...fail('no decimal point'), timestamp };

  // The decimal digit can only be one of allowedLastDigits (0/5 on this
  // scale), so compare it against those templates only.
  const lastTemplates = o.allowedLastDigits
    ? templates.filter((t) => o.allowedLastDigits.includes(t.digit))
    : templates;
  const results = digits.map((c, i) => {
    const vec = glyphVector(norm, labels, width, c);
    return classifyGlyph(vec, c.w / c.h, i === digits.length - 1 ? lastTemplates : templates);
  });
  let text = '';
  results.forEach((r, i) => {
    if (i === results.length - 1) text += '.';
    text += r.digit;
  });
  // Sign slot sits well to the left of the digits.
  const minus = minuses.find((c) => c.x1 < digits[0].x0);
  const plus = pluses.find((c) => c.x1 < digits[0].x0);
  const sign = minus && !plus ? '-' : plus && !minus ? '+' : null;
  if (sign === '-') text = '-' + text;

  const worst = results.reduce((a, r) => (r.score < a.score ? r : a), results[0]);
  const worstMargin = Math.min(...results.map((r) => r.margin));
  const confidence = Math.max(0, Math.min(1, Math.min(worst.score, 0.5 + worstMargin)));
  const base = { text, sign, confidence, timestamp, digitScores: results.map((r) => +r.score.toFixed(3)) };

  if (worst.score < o.minScore) return { ...fail('digit not recognised', base), text };
  if (worstMargin < o.minMargin) return { ...fail('ambiguous digit', base), text };
  if (o.requireSign && !sign) return { ...fail('sign not visible', base), text };
  if (!/^-?\d{1,3}\.\d$/.test(text)) return { ...fail('malformed', base), text };
  if (digits.length > 2 && text.replace('-', '')[0] === '0') return { ...fail('leading zero', base), text };
  if (o.allowedLastDigits && !o.allowedLastDigits.includes(text[text.length - 1])) {
    return { ...fail('unexpected decimal digit', base), text };
  }
  const value = parseFloat(text);
  if (!(value >= o.minValue && value <= o.maxValue)) return { ...fail('implausible value', base), text };
  return { valid: true, value, ...base, reason: 'ok' };
}
