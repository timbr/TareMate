import { rawFrames } from './rawframes.mjs';
import { segment } from '../src/weight-reader.js';
const [file, w, h] = [process.argv[2], 210, +(process.argv[3]||60)];
const hist = {};
let out = [];
for (const { index, img } of rawFrames(file, w, h)) {
  const s = segment(img);
  const key = s.error ? s.error : `d${s.digits.length} dot${s.dots.length} m${s.minuses.length} s${s.strays.length}`;
  hist[key] = (hist[key] || 0) + 1;
  if (index % 50 === 0) out.push(`${index} ${key} c=${s.contrast?.toFixed(0)} H=${s.H} ${s.digits?.map(c=>`${c.x0},${c.y0},${c.w}x${c.h}`).join(' ')}`);
}
console.log(out.join('\n')); console.log(hist);
