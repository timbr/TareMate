// Run the reader over raw frame dump and print run-length timeline.
import fs from 'node:fs';
import { rawFrames } from './rawframes.mjs';
import { readWeight } from '../src/weight-reader.js';
const [file, h, fps] = [process.argv[2], +process.argv[3], +(process.argv[4] || 5)];
const rows = [];
for (const { index, img } of rawFrames(file, 210, h)) {
  const r = readWeight(img, { timestamp: index });
  rows.push({ i: index, t: (index / fps).toFixed(1), valid: r.valid, text: r.text, reason: r.reason, conf: r.confidence });
}
if (process.argv[5]) fs.writeFileSync(process.argv[5], JSON.stringify(rows));
let runs = [];
for (const r of rows) {
  const k = r.valid ? r.text : `x(${r.reason}${r.text ? ':' + r.text : ''})`;
  const last = runs.at(-1);
  if (last && last.k === k) { last.n++; last.minc = Math.min(last.minc, r.conf); } else runs.push({ k, n: 1, t: r.t, minc: r.conf });
}
console.log(runs.map((r) => `${r.t}s ${r.k} x${r.n}${r.k.startsWith('x') ? '' : ' c>=' + r.minc.toFixed(2)}`).join('\n'));
const v = rows.filter((r) => r.valid).length;
console.log(`valid ${v}/${rows.length}`);
