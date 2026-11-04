import { rawFrames } from './rawframes.mjs';
import { segment, glyphVector, classifyGlyph, readWeight } from '../src/weight-reader.js';
import { DEFAULT_TEMPLATES } from '../src/digit-templates.js';
const cnt = {};
for (const { index, img } of rawFrames(process.argv[2], 210, 60)) {
  const r = readWeight(img);
  if (r.reason !== 'ambiguous digit') continue;
  const s = segment(img);
  s.digits.forEach((c, p) => {
    const k = classifyGlyph(glyphVector(s.norm, s.labels, s.width, c), c.w / c.h, DEFAULT_TEMPLATES);
    if (k.margin < 0.08) { const key = `${k.digit}/${k.runnerUp} pos${p - s.digits.length}`; cnt[key] = (cnt[key] || 0) + 1; }
  });
}
console.log(Object.entries(cnt).sort((a, b) => b[1] - a[1]));
