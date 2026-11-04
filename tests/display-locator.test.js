// Display locator on whole camera frames from the four phone videos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { locateDisplay } from '../src/display-locator.js';

const meta = JSON.parse(fs.readFileSync(new URL('../test-assets/fullframes.json', import.meta.url)));
const buf = fs.readFileSync(new URL('../test-assets/fullframes.rgb', import.meta.url));
const { width: W, height: H } = meta;

function frame(k) {
  const fsz = W * H * 3;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = buf[k * fsz + i * 3]; data[i * 4 + 1] = buf[k * fsz + i * 3 + 1];
    data[i * 4 + 2] = buf[k * fsz + i * 3 + 2]; data[i * 4 + 3] = 255;
  }
  return { width: W, height: H, data };
}

meta.frames.forEach((f, k) => {
  test(`locates the weight digits in ${f.video} @${f.t}s`, () => {
    const c = locateDisplay(frame(k));
    assert.ok(c.length > 0, 'no candidate');
    const r = c[0].roi;
    assert.ok(Math.abs(r.x - f.roiXY[0]) < 0.02 && Math.abs(r.y - f.roiXY[1]) < 0.02,
      `box at ${r.x.toFixed(3)},${r.y.toFixed(3)} expected ~${f.roiXY}`);
    assert.ok(c[0].sign, 'minus sign should be inside the box');
  });
});

test('finds nothing in a blank frame', () => {
  const data = new Uint8ClampedArray(W * H * 4).fill(128);
  assert.equal(locateDisplay({ width: W, height: H, data }).length, 0);
});
