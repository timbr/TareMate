// Run the display locator over a raw rgb24 dump of full frames.
// usage: node tools/eval-locator.mjs frames.rgb W H [outDir]
import fs from 'node:fs';
import { rawFrames } from './rawframes.mjs';
import { locateDisplay } from '../src/display-locator.js';
const [file, W, H, out] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
const buf = fs.readFileSync(file);
const fsz = W * H * 3;
let found = 0, total = 0;
for (let k = 0; (k + 1) * fsz <= buf.length; k++) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i*4]=buf[k*fsz+i*3]; data[i*4+1]=buf[k*fsz+i*3+1]; data[i*4+2]=buf[k*fsz+i*3+2]; data[i*4+3]=255; }
  const t0 = performance.now();
  const c = locateDisplay({ width: W, height: H, data });
  const ms = performance.now() - t0;
  total++; if (c.length) found++;
  const r = c[0]?.roi;
  console.log(k, ms.toFixed(0) + 'ms', c.length, r ? `x${r.x.toFixed(3)} y${r.y.toFixed(3)} w${r.w.toFixed(3)} h${r.h.toFixed(3)} d${c[0].digits} s${c[0].sign} sc${c[0].score.toFixed(2)}` : '-');
  if (out && r) {
    const img = Buffer.from(buf.subarray(k * fsz, (k + 1) * fsz));
    const px = (x, y) => { if (x>=0&&y>=0&&x<W&&y<H) { const p=(y*W+x)*3; img[p]=255; img[p+1]=0; img[p+2]=255; } };
    const x0=Math.round(r.x*W), y0=Math.round(r.y*H), x1=Math.round((r.x+r.w)*W), y1=Math.round((r.y+r.h)*H);
    for (let x=x0;x<=x1;x++){px(x,y0);px(x,y1);} for (let y=y0;y<=y1;y++){px(x0,y);px(x1,y);}
    fs.writeFileSync(`${out}/loc_${k}.ppm`, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), img]));
  }
}
console.log(`found ${found}/${total}`);
