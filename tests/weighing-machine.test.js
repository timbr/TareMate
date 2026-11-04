import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, step, computeNet, summary, PHASES } from '../src/weighing-machine.js';
import { createReadingFilter } from '../src/reading-filter.js';
import { createStabilityDetector } from '../src/stability-detector.js';
import fs from 'node:fs';

const STABLE = (median) => ({ stable: true, median, reason: 'stable' });

/** Build a machine that has a running camera and a captured tare. */
function withTare(tare, config = {}) {
  let s = initialState(config);
  s = step(s, { type: 'CAMERA_ON' }).state;
  s = step(s, { type: 'READING', time: 0, value: tare }).state;
  s = step(s, { type: 'CAPTURE_TARE', time: 0, stability: STABLE(tare) }).state;
  return s;
}

/** Feed accepted readings (one per 200 ms) and collect effects. */
function feed(s, values, t0 = 200) {
  const effects = [];
  let t = t0;
  for (const v of values) {
    const ev = v === null
      ? { type: 'READING', time: t, value: null, uncertain: true, reason: 'test' }
      : { type: 'READING', time: t, value: v };
    const r = step(s, ev);
    s = r.state; effects.push(...r.effects);
    t += 200;
  }
  return { s, effects, t };
}

const repeat = (v, n) => Array(n).fill(v);
const types = (effects) => effects.map((e) => e.type);

test('1. tare -32.0, current -32.0 => net 0.0', () => {
  assert.equal(computeNet(-32.0, -32.0, 'increase'), 0);
  const s = withTare(-32.0);
  assert.equal(feed(s, [-32.0]).s.net, 0);
});

test('2. tare -32.0, current -22.0, increasing => net 10.0', () => {
  assert.equal(computeNet(-22.0, -32.0, 'increase'), 10);
});

test('3. tare -32.0, current -7.0, increasing => net 25.0', () => {
  assert.equal(computeNet(-7.0, -32.0, 'increase'), 25);
});

test('4. tare -32.0, current -42.0, decreasing => net 10.0', () => {
  assert.equal(computeNet(-42.0, -32.0, 'decrease'), 10);
  const s = withTare(-32.0, { direction: 'decrease' });
  assert.equal(feed(s, repeat(-42.0, 12)).s.net, 10);
});

test('5. small fluctuation around tare does not start filling', () => {
  const s = withTare(-32.0);
  const { s: out, effects } = feed(s, [-32.0, -32.5, -32.0, -31.5, -32.0, -32.5, -32.0, -31.5, -32.0]);
  assert.equal(out.phase, PHASES.TARE_CAPTURED);
  assert.ok(!types(effects).includes('FILLING_STARTED'));
  assert.equal(out.net, 0); // -0.5 clamped as noise
});

test('6. one isolated outlier does not trigger filling or target', () => {
  const s = withTare(-32.0);
  const { s: out, effects } = feed(s, [-32.0, -32.0, -7.0, -32.0, -32.0]);
  assert.equal(out.phase, PHASES.TARE_CAPTURED);
  assert.ok(!types(effects).includes('FILLING_STARTED'));
  assert.ok(!types(effects).includes('TARGET_REACHED'));
  // Also during filling: a single jump to target must not count.
  const f = feed(s, repeat(-27.0, 12)).s;
  assert.equal(f.phase, PHASES.FILLING);
  const g = feed(f, [-26.5, -7.0, -26.5, -26.0], 2000);
  assert.ok(!types(g.effects).includes('TARGET_REACHED'));
  assert.equal(g.s.phase, PHASES.FILLING);
});

test('7. invalid/stale reading => uncertain, not zero', () => {
  const s = feed(withTare(-32.0), repeat(-20.0, 12)).s;
  const { s: out } = feed(s, [null], 5000);
  assert.equal(out.uncertain, true);
  assert.equal(summary(out).displayState, 'READING_UNCERTAIN');
  assert.equal(out.net, 12); // last known net kept, not replaced by 0
  assert.equal(out.gross, -20.0);
});

test('8. tare does not change during filling', () => {
  let s = feed(withTare(-32.0), repeat(-25.0, 12)).s;
  assert.equal(s.phase, PHASES.FILLING);
  const r = step(s, { type: 'CAPTURE_TARE', time: 9999, stability: STABLE(-25.0) });
  assert.equal(r.state.tare, -32.0);
  assert.equal(r.effects[0].type, 'TARE_REJECTED');
  s = feed(r.state, repeat(-24.0, 20), 10000).s;
  assert.equal(s.tare, -32.0);
});

test('9. target reached triggers once', () => {
  const s = feed(withTare(-32.0), repeat(-20.0, 12)).s;
  const { s: out, effects } = feed(s, [...repeat(-7.0, 12), -7.5, -7.0, ...repeat(-7.0, 12)], 5000);
  assert.equal(types(effects).filter((t) => t === 'TARGET_REACHED').length, 1);
  assert.equal(out.phase, PHASES.TARGET_REACHED);
});

test('10. reset clears tare and milestone flags', () => {
  let s = feed(withTare(-32.0), [...repeat(-20.0, 12), ...repeat(-11.0, 12), ...repeat(-7.0, 12)]).s;
  assert.ok(s.milestonesDone.length > 0);
  assert.equal(s.targetAnnounced, true);
  s = step(s, { type: 'NEW_SACK' }).state;
  assert.equal(s.tare, null);
  assert.deepEqual(s.milestonesDone, []);
  assert.equal(s.targetAnnounced, false);
  assert.equal(s.overAnnounced, false);
  assert.equal(s.phase, PHASES.WAITING_FOR_TARE);
});

test('11. new cycle captures a different (drifted) tare', () => {
  let s = feed(withTare(-32.0), repeat(-7.0, 12)).s;
  s = step(s, { type: 'NEW_SACK' }).state;
  s = feed(s, repeat(-33.5, 12), 10000).s;
  s = step(s, { type: 'CAPTURE_TARE', time: 12000, stability: STABLE(-33.5) }).state;
  assert.equal(s.tare, -33.5);
  s = feed(s, repeat(-23.5, 12), 13000).s;
  assert.equal(s.net, 10);
});

test('12. over-target warning is distinct from target event', () => {
  const s = feed(withTare(-32.0), repeat(-20.0, 12)).s;
  const { effects } = feed(s, [...repeat(-7.0, 12), ...repeat(-5.5, 12), ...repeat(-5.0, 12)], 5000);
  const t = types(effects);
  assert.equal(t.filter((x) => x === 'TARGET_REACHED').length, 1);
  assert.equal(t.filter((x) => x === 'OVER_TARGET').length, 1);
  assert.ok(t.indexOf('TARGET_REACHED') < t.indexOf('OVER_TARGET'));
});

test('tare capture refused when display not stable or uncertain', () => {
  let s = step(initialState(), { type: 'CAMERA_ON' }).state;
  let r = step(s, { type: 'CAPTURE_TARE', time: 0, stability: STABLE(-32) });
  assert.equal(r.effects[0].type, 'TARE_REJECTED'); // uncertain: no reading yet
  s = step(s, { type: 'READING', time: 0, value: -32 }).state;
  r = step(s, { type: 'CAPTURE_TARE', time: 0, stability: { stable: false, reason: 'reading is moving' } });
  assert.equal(r.effects[0].type, 'TARE_REJECTED');
  assert.match(r.effects[0].reason, /moving/);
});

test('milestones announced once each; check-scale when uncertain near target', () => {
  const s = feed(withTare(-32.0), repeat(-25.0, 12)).s;
  const { s: s2, effects } = feed(s, [...repeat(-21.0, 4), ...repeat(-17.0, 4), ...repeat(-14.0, 4), ...repeat(-12.0, 4), ...repeat(-11.5, 2), ...repeat(-12.0, 4), ...repeat(-10.0, 4), -10.0, -9.5], 3000);
  const ms = effects.filter((e) => e.type === 'MILESTONE').map((e) => e.kg);
  assert.deepEqual(ms, [20, 22]);
  const r = feed(s2, [null, null], 9000);
  assert.deepEqual(types(r.effects), ['CHECK_SCALE']);
  assert.equal(summary(r.s).approachLevel, 0); // no reassuring beeps while uncertain
});

test('large negative net raises a direction warning (not hidden)', () => {
  const s = withTare(-32.0); // direction increase
  const { s: out, effects } = feed(s, repeat(-40.0, 12));
  assert.equal(out.net, -8);
  assert.ok(types(effects).includes('DIRECTION_WARNING'));
});

test('pause ignores readings; resume restores phase', () => {
  let s = feed(withTare(-32.0), repeat(-25.0, 12)).s;
  s = step(s, { type: 'PAUSE' }).state;
  const { s: p, effects } = feed(s, repeat(-7.0, 12), 5000);
  assert.ok(!types(effects).includes('TARGET_REACHED'));
  assert.equal(p.phase, PHASES.PAUSED);
  s = step(p, { type: 'RESUME' }).state;
  assert.equal(s.phase, PHASES.FILLING);
});

test('replay of the commissioning video readings', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../test-assets/video-readings.json', import.meta.url)));
  const filter = createReadingFilter();
  const stab = createStabilityDetector();
  let s = step(initialState({ targetKg: 24.0 }), { type: 'CAMERA_ON' }).state;
  const effects = [];
  let tareTried = false;
  data.frames.forEach((text, i) => {
    const t = i * 200;
    const raw = { valid: text !== null, value: text === null ? null : parseFloat(text), text: text ?? '', timestamp: t };
    const f = filter.push(raw);
    if (raw.valid) stab.add(raw.value, t); else stab.gap(t);
    const r = step(s, { type: 'READING', time: t, value: f.accepted?.value ?? null, uncertain: f.uncertain, reason: f.reason });
    s = r.state; effects.push(...r.effects);
    // Operator presses capture tare at ~29 s (sack settled at -32.0)
    if (!tareTried && t >= 29000) {
      tareTried = true;
      const res = step(s, { type: 'CAPTURE_TARE', time: t, stability: stab.evaluate(t) });
      s = res.state; effects.push(...res.effects);
    }
  });
  const t = types(effects);
  assert.ok(t.includes('TARE_CAPTURED'), 'tare captured');
  assert.equal(s.tare, -32.0);
  assert.equal(t.filter((x) => x === 'FILLING_STARTED').length, 1);
  assert.equal(t.filter((x) => x === 'TARGET_REACHED').length, 1, 'target 24 reached exactly once');
  assert.ok(!t.includes('DIRECTION_WARNING'));
  const ms = effects.filter((e) => e.type === 'MILESTONE').map((e) => e.kg);
  assert.deepEqual(ms, [20, 22]);
});
