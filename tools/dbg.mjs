import { rawFrames, writePGM } from './rawframes.mjs';
import { segment, readWeight } from '../src/weight-reader.js';
const [file, h, want, out] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
for (const { index, img } of rawFrames(file, 210, h)) {
  if (index !== want) continue;
  const s = segment(img);
  console.log(readWeight(img).reason, 'H', s.H, 'contrast', s.contrast?.toFixed(0));
  const show = (c) => `${c.x0},${c.y0} ${c.w}x${c.h} a${c.area}`;
  console.log('digits', s.digits?.map(show)); console.log('dots', s.dots?.map(show)); console.log('minus', s.minuses?.map(show));
  console.log('all', s.comps.map(show).join(' | '));
  const g = new Uint8Array(210 * h); for (let i = 0; i < g.length; i++) g[i] = s.labels[i] >= 0 ? 255 : Math.round(s.norm[i] * 80);
  if (out) writePGM(out, 210, h, g);
}
