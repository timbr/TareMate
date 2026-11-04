// Re-cluster a subset of glyphs (by cluster ids) into k groups and render a sheet.
import fs from 'node:fs';
import { writePGM } from './rawframes.mjs';
import { GLYPH_W, GLYPH_H } from '../src/weight-reader.js';
const [dir, ids, K, tag] = [process.argv[2], process.argv[3].split(',').map(Number), +process.argv[4], process.argv[5]];
const all = JSON.parse(fs.readFileSync(`${dir}/glyphs.json`));
const glyphs = all.filter((g) => ids.includes(g.cluster));
const dist = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
let cents = [glyphs[0].vec];
while (cents.length < K) { let far, fd = -1; for (const g of glyphs) { const d = Math.min(...cents.map((c) => dist(g.vec, c))); if (d > fd) { fd = d; far = g; } } cents.push(far.vec); }
for (let it = 0; it < 30; it++) {
  const sums = cents.map((c) => ({ n: 0, s: c.map(() => 0) }));
  for (const g of glyphs) { let bi = 0, bd = Infinity; cents.forEach((c, i) => { const d = dist(g.vec, c); if (d < bd) { bd = d; bi = i; } }); g.sub = bi; sums[bi].n++; g.vec.forEach((v, j) => (sums[bi].s[j] += v)); }
  cents = sums.map((s, i) => (s.n ? s.s.map((v) => v / s.n) : cents[i]));
}
const cw = GLYPH_W * 3 + 2, ch = GLYPH_H * 3 + 2, cols = 17, W = cw * cols, H = ch * K;
const px = new Uint8Array(W * H).fill(60);
const put = (r, c, v) => { for (let y = 0; y < GLYPH_H * 3; y++) for (let x = 0; x < GLYPH_W * 3; x++) px[(r * ch + y) * W + c * cw + x] = Math.round(255 * v[Math.floor(y / 3) * GLYPH_W + Math.floor(x / 3)]); };
for (let k = 0; k < K; k++) { const m = glyphs.filter((g) => g.sub === k); put(k, 0, cents[k]); const st = Math.max(1, Math.floor(m.length / 16)); for (let j = 0; j < 16 && j * st < m.length; j++) put(k, j + 1, m[j * st].vec); console.log(`sub ${k}: n=${m.length}`); }
writePGM(`${dir}/sub_${tag}.pgm`, W, H, px);
fs.writeFileSync(`${dir}/sub_${tag}.json`, JSON.stringify(glyphs.map((g) => ({ frame: g.frame, pos: g.pos, cluster: g.cluster, sub: g.sub }))));
