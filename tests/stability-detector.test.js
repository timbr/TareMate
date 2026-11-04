import test from 'node:test';
import assert from 'node:assert/strict';
import { createStabilityDetector, median } from '../src/stability-detector.js';

function run(values, periodMs = 200, opts) {
  const d = createStabilityDetector(opts);
  let t = 0;
  for (const v of values) {
    if (v === null) d.gap(t); else d.add(v, t);
    t += periodMs;
  }
  return d.evaluate(t - periodMs);
}

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([-32, -32.5]), -32.25);
});

test('identical readings over full window are stable', () => {
  const r = run(Array(15).fill(-32.0));
  assert.equal(r.stable, true);
  assert.equal(r.median, -32.0);
});

test('one-count flicker (-32.0/-32.5) is stable', () => {
  const seq = [];
  for (let i = 0; i < 15; i++) seq.push(i % 3 ? -32.0 : -32.5);
  const r = run(seq);
  assert.equal(r.stable, true);
  assert.equal(r.median, -32.0);
});

test('an occasional OCR outlier does not break stability or move the median', () => {
  const seq = Array(15).fill(-32.0);
  seq[7] = -7.0;
  const r = run(seq);
  assert.equal(r.stable, true);
  assert.equal(r.median, -32.0);
});

test('a rising (filling) sequence is not stable', () => {
  const seq = Array.from({ length: 15 }, (_, i) => -32 + i * 0.5);
  assert.equal(run(seq).stable, false);
});

test('a swinging sack (noise > tolerance) is not stable', () => {
  const seq = [-32, -30.5, -33, -31, -34, -32, -30, -33.5, -31.5, -32, -34, -30, -32.5, -31, -33];
  assert.equal(run(seq).stable, false);
});

test('too few readings / gaps are not stable', () => {
  assert.equal(run(Array(4).fill(-32)).stable, false);
  const seq = Array(15).fill(-32.0);
  for (let i = 5; i < 10; i++) seq[i] = null;
  const r = run(seq);
  assert.equal(r.stable, false);
});
