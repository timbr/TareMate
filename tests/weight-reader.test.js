import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readWeight } from '../src/weight-reader.js';
import { createReadingFilter } from '../src/reading-filter.js';

const meta = JSON.parse(fs.readFileSync(new URL('../test-assets/frames.json', import.meta.url)));
const raw = fs.readFileSync(new URL('../test-assets/frames.rgb', import.meta.url));

function frame(k) {
  const { width: w, height: h } = meta;
  const data = new Uint8ClampedArray(w * h * 4);
  const off = k * w * h * 3;
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = raw[off + i * 3];
    data[i * 4 + 1] = raw[off + i * 3 + 1];
    data[i * 4 + 2] = raw[off + i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

test('reads every verified frame from the commissioning video', () => {
  meta.frames.forEach((f, k) => {
    const r = readWeight(frame(k));
    assert.equal(r.valid, true, `frame ${f.frame} (${f.seconds}s): ${r.reason} ${r.text}`);
    assert.equal(r.text, f.expected, `frame ${f.frame}`);
    assert.equal(r.value, parseFloat(f.expected));
    assert.ok(r.confidence > 0 && r.confidence <= 1);
  });
});

test('returns a structured result', () => {
  const r = readWeight(frame(0), { timestamp: 123 });
  for (const k of ['value', 'text', 'confidence', 'timestamp', 'valid']) assert.ok(k in r, k);
  assert.equal(r.timestamp, 123);
});

test('blank / uniform image is rejected, not read as zero', () => {
  const w = 210, h = 60, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([190, 185, 200, 255], i * 4);
  const r = readWeight({ width: w, height: h, data });
  assert.equal(r.valid, false);
  assert.equal(r.value, null);
});

test('mostly-covered display is rejected', () => {
  const img = frame(5);
  // Paint over the right half (e.g. a hand or glare across the digits)
  for (let y = 0; y < img.height; y++) for (let x = 120; x < img.width; x++) img.data.set([240, 240, 240, 255], (y * img.width + x) * 4);
  assert.equal(readWeight(img).valid, false);
});

test('reading filter needs consecutive agreement and reports staleness', () => {
  const f = createReadingFilter({ agree: 3, uncertainAfterMs: 1000 });
  const ok = (v, t) => ({ valid: true, value: v, text: v.toFixed(1), timestamp: t });
  assert.equal(f.push(ok(-32, 0)).uncertain, true);
  assert.equal(f.push(ok(-7, 200)).uncertain, true);      // outlier breaks run
  f.push(ok(-32, 400)); f.push(ok(-32, 600));
  const r = f.push(ok(-32, 800));
  assert.equal(r.uncertain, false);
  assert.equal(r.accepted.value, -32);
  assert.equal(f.push(ok(-7, 1000)).accepted.value, -32); // single outlier ignored
  const stale = f.push(ok(-32, 1200), { fresh: false });
  assert.equal(stale.uncertain, true);
  assert.match(stale.reason, /not updating/);
  const bad = { valid: false, value: null, text: '', timestamp: 0 };
  let last;
  for (let t = 1400; t <= 3000; t += 200) last = f.push({ ...bad, timestamp: t });
  assert.equal(last.uncertain, true);
});
