// Write test-assets/frames.rgb (+ frames.json) from a raw ROI dump and a list of
// visually verified frame indices/labels.
import fs from 'node:fs';
const [src, w, h] = [process.argv[2], 210, 60];
const labels = JSON.parse(process.argv[3]);
const buf = fs.readFileSync(src), fsz = w * h * 3;
const parts = [], meta = [];
for (const [idx, text] of labels) { parts.push(buf.subarray(idx * fsz, (idx + 1) * fsz)); meta.push({ frame: idx, seconds: idx / 5, expected: text }); }
fs.writeFileSync('test-assets/frames.rgb', Buffer.concat(parts));
fs.writeFileSync('test-assets/frames.json', JSON.stringify({ width: w, height: h, format: 'rgb24', frames: meta }, null, 1));
console.log('wrote', meta.length);
