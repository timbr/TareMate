// Replays per-frame reader output through the consensus filter; prints accepted value changes.
import fs from 'node:fs';
import { createReadingFilter } from '../src/reading-filter.js';
const rows = JSON.parse(fs.readFileSync(process.argv[2]));
const f = createReadingFilter({ agree: +(process.argv[3] || 3) });
let out = [], unc = 0;
for (const r of rows) {
  const res = f.push({ valid: r.valid, value: r.valid ? parseFloat(r.text) : null, text: r.text, timestamp: r.i * 200 });
  if (res.uncertain) unc++;
  if (res.isNew) out.push(`${r.i} ${r.t}s ${res.accepted.text}`);
}
console.log(out.join('\n')); console.log('uncertain frames', unc, 'of', rows.length);
