// End-to-end check on a phone video: locate the display automatically (once a
// second, keeping the last good box), crop it the way the app does, read it,
// and run the 3-frame consensus filter.
// usage: node tools/eval-auto.mjs <video.mp4> [glyphs-out.json] [--templates file.json]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { locateDisplay } from '../src/display-locator.js';
import { readWeight, segment, glyphVector } from '../src/weight-reader.js';
import { createReadingFilter } from '../src/reading-filter.js';

const args = process.argv.slice(2);
const video = args[0];
const glyphOut = args[1] && !args[1].startsWith('--') ? args[1] : null;
const ti = args.indexOf('--templates');
const templates = ti >= 0 ? JSON.parse(fs.readFileSync(args[ti + 1])) : undefined;
const W = 960, H = 540, FPS = 5, fsz = W * H * 3;

export function cropScaled(rgb, W, H, roi, outH = 60, maxW = 360) {
  const px = roi.x * W, py = roi.y * H, pw = roi.w * W, ph = roi.h * H;
  const ow = Math.max(8, Math.min(maxW, Math.round(pw * outH / ph)));
  const data = new Uint8ClampedArray(ow * outH * 4);
  const sx = pw / ow, sy = ph / outH;
  for (let oy = 0; oy < outH; oy++) for (let ox = 0; ox < ow; ox++) {
    // bilinear sample at cell centre (good enough for a ~1:1 to 2:1 scale)
    const fx = px + (ox + 0.5) * sx - 0.5, fy = py + (oy + 0.5) * sy - 0.5;
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const ax = Math.min(1, Math.max(0, fx - x0)), ay = Math.min(1, Math.max(0, fy - y0));
    for (let c = 0; c < 3; c++) {
      const v = (rgb[(y0 * W + x0) * 3 + c] * (1 - ax) + rgb[(y0 * W + x0 + 1) * 3 + c] * ax) * (1 - ay) +
        (rgb[((y0 + 1) * W + x0) * 3 + c] * (1 - ax) + rgb[((y0 + 1) * W + x0 + 1) * 3 + c] * ax) * ay;
      data[(oy * ow + ox) * 4 + c] = v;
    }
    data[(oy * ow + ox) * 4 + 3] = 255;
  }
  return { width: ow, height: outH, data };
}

function toImage(rgb, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = rgb[i * 3]; data[i * 4 + 1] = rgb[i * 3 + 1]; data[i * 4 + 2] = rgb[i * 3 + 2]; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}

const ff = spawn('ffmpeg', ['-v', 'error', '-i', video, '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
let pending = Buffer.alloc(0), k = 0, roi = null, located = 0, valid = 0;
const filter = createReadingFilter({ agree: 3 });
const accepted = [];
const glyphs = [];
const reasons = {};
function frame(rgb) {
  const t = k / FPS;
  if (k % FPS === 0 || !roi) {
    const c = locateDisplay(toImage(rgb, W, H));
    if (c.length) { roi = c[0].roi; located++; }
  }
  if (roi) {
    const img = cropScaled(rgb, W, H, roi);
    const r = readWeight(img, { timestamp: t * 1000, templates });
    if (r.valid) valid++; else reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    const f = filter.push(r, { fresh: true });
    if (f.isNew) accepted.push(`${t.toFixed(1)}:${f.accepted.value}`);
    if (glyphOut && r.text && /^-?\d{1,3}\.\d$/.test(r.text)) {
      const s = segment(img);
      if (!s.error && !s.strays.length) {
        const digitsText = r.text.replace('-', '').replace('.', '');
        if (digitsText.length === s.digits.length) {
          s.digits.forEach((c, pos) => glyphs.push({ t, k, text: r.text, valid: r.valid, label: digitsText[pos], pos: pos - s.digits.length,
            score: r.digitScores?.[pos], aspect: c.w / c.h, vec: Array.from(glyphVector(s.norm, s.labels, s.width, c)) }));
        }
      }
    }
  }
  k++;
}
ff.stdout.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= fsz) { frame(pending.subarray(0, fsz)); pending = pending.subarray(fsz); }
});
ff.on('close', () => {
  console.log(`frames ${k}  valid ${valid} (${(100 * valid / k).toFixed(0)}%)  located-checks ${located}`);
  console.log('rejections', JSON.stringify(reasons));
  console.log('accepted changes', accepted.length, accepted.join(' '));
  if (glyphOut) fs.writeFileSync(glyphOut, JSON.stringify(glyphs));
});
