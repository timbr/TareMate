// Collect digit glyphs from structurally plausible frames, k-means cluster them,
// and write a contact sheet (PGM) of cluster members for manual labelling.
import fs from 'node:fs';
import { rawFrames, writePGM } from './rawframes.mjs';
import { segment, glyphVector, GLYPH_W, GLYPH_H } from '../src/weight-reader.js';
const [file, h, outDir, K] = [process.argv[2], +process.argv[3], process.argv[4], +(process.argv[5] || 18)];
const glyphs = [];
for (const { index, img } of rawFrames(file, 210, h)) {
  const s = segment(img);
  if (s.error || s.strays.length || s.digits.length < 2 || s.digits.length > 3) continue;
  const last = s.digits.at(-1), prev = s.digits.at(-2);
  if (!s.dots.some((c) => c.x0 > prev.x1 - 1 && c.x1 < last.x0 + 1)) continue;
  s.digits.forEach((c, pos) => {
    if (c.w > 0.75 * c.h) return; // merged/ghost blobs
    glyphs.push({ frame: index, pos: pos - s.digits.length, aspect: c.w / c.h, vec: Array.from(glyphVector(s.norm, s.labels, s.width, c)) });
  });
}
const feat = (g) => [...g.vec, g.aspect * 3];
const dist = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
// k-means++ init
let cents = [feat(glyphs[0])];
while (cents.length < K) {
  let far = null, fd = -1;
  for (const g of glyphs) { const d = Math.min(...cents.map((c) => dist(feat(g), c))); if (d > fd) { fd = d; far = g; } }
  cents.push(feat(far));
}
for (let it = 0; it < 30; it++) {
  const sums = cents.map((c) => ({ n: 0, s: c.map(() => 0) }));
  for (const g of glyphs) {
    const f = feat(g); let bi = 0, bd = Infinity;
    cents.forEach((c, i) => { const d = dist(f, c); if (d < bd) { bd = d; bi = i; } });
    g.cluster = bi; sums[bi].n++; f.forEach((v, j) => (sums[bi].s[j] += v));
  }
  cents = sums.map((s, i) => (s.n ? s.s.map((v) => v / s.n) : cents[i]));
}
// Sheet: one row per cluster, up to 12 members, each glyph GLYPH_W*3 x GLYPH_H*3
const cw = GLYPH_W * 3 + 2, ch = GLYPH_H * 3 + 2, cols = 13;
const W = cw * cols, H = ch * K;
const px = new Uint8Array(W * H).fill(60);
const put = (row, col, vec) => {
  for (let y = 0; y < GLYPH_H * 3; y++) for (let x = 0; x < GLYPH_W * 3; x++)
    px[(row * ch + y) * W + col * cw + x] = Math.round(255 * vec[Math.floor(y / 3) * GLYPH_W + Math.floor(x / 3)]);
};
const summary = [];
for (let k = 0; k < K; k++) {
  const mem = glyphs.filter((g) => g.cluster === k);
  put(k, 0, cents[k]);
  const step = Math.max(1, Math.floor(mem.length / 12));
  for (let j = 0; j < 12 && j * step < mem.length; j++) put(k, j + 1, mem[j * step].vec);
  summary.push(`cluster ${k}: n=${mem.length} aspect=${(cents[k].at(-1) / 3).toFixed(2)} pos=${[...new Set(mem.map((g) => g.pos))]}`);
}
writePGM(`${outDir}/clusters.pgm`, W, H, px);
fs.writeFileSync(`${outDir}/glyphs.json`, JSON.stringify(glyphs));
console.log(summary.join('\n'), '\ntotal', glyphs.length);
