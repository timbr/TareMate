// TareMate - weighing state machine.
//
// Pure and DOM-free. `step(state, event)` returns {state, effects}; effects
// are notifications (tare captured, milestone, target, ...) that the UI and
// audio layers react to. Nothing here knows about cameras or audio.
//
// Phases:
//   NO_CAMERA        camera not running
//   CALIBRATING      setup screen open
//   WAITING_FOR_TARE camera running, no tare for this sack
//   TARE_CAPTURED    tare locked, waiting for filling to begin
//   FILLING          net weight moving towards target
//   TARGET_REACHED   target reached this cycle (over-target is a flag)
//   PAUSED           operator paused monitoring
// READING_UNCERTAIN is reported by `displayState()` whenever the latest
// reading is missing / stale / unconfirmed, on top of the phase.

export const PHASES = Object.freeze({
  NO_CAMERA: 'NO_CAMERA',
  CALIBRATING: 'CALIBRATING',
  WAITING_FOR_TARE: 'WAITING_FOR_TARE',
  TARE_CAPTURED: 'TARE_CAPTURED',
  FILLING: 'FILLING',
  TARGET_REACHED: 'TARGET_REACHED',
  PAUSED: 'PAUSED',
});

export const MACHINE_DEFAULTS = {
  targetKg: 25.0,
  direction: 'increase', // display value increases as material is added
  noiseKg: 0.5,          // small negative net within this is clamped to 0
  negativeWarnKg: 2.0,   // net below -this => direction/config warning
  fillStartKg: 1.0,      // net must exceed this to enter FILLING
  sustainMs: 500,        // fill start / target must hold this long
  overMarginKg: 1.0,     // over-target warning at target + this
  maxJumpKg: 5.0,        // bigger jumps between readings need longer confirmation
  jumpConfirmMs: 1500,
  speechMilestones: [20, 22],
  beepLevels: [23, 24, 24.5],
  checkScaleFromKg: 20,  // uncertainty above this net => CHECK SCALE alert
};

export function initialState(config = {}) {
  return {
    config: { ...MACHINE_DEFAULTS, ...config },
    phase: PHASES.NO_CAMERA,
    pausedFrom: null,
    tare: null,
    gross: null,
    net: null,
    uncertain: true,
    uncertainReason: 'camera not started',
    milestonesDone: [],
    targetAnnounced: false,
    overAnnounced: false,
    over: false,
    checkScaleActive: false,
    directionWarning: false,
    pending: null, // {kind, since}
    lastValue: null,
    lastValueTime: null,
    jumpSince: null,
  };
}

/** Net material weight for a gross reading given the tare and direction. */
export function computeNet(gross, tare, direction = 'increase') {
  const raw = direction === 'decrease' ? tare - gross : gross - tare;
  return Math.round(raw * 100) / 100;
}

/** Clamp small negative noise to zero; report large negatives. */
export function normaliseNet(net, cfg) {
  if (net < 0 && net >= -cfg.noiseKg) return { net: 0, warning: false };
  return { net, warning: net < -cfg.negativeWarnKg };
}

export function approachLevel(net, cfg) {
  if (net == null) return 0;
  let level = 0;
  cfg.beepLevels.forEach((t, i) => { if (net >= t) level = i + 1; });
  return level;
}

export function displayState(state) {
  if (state.phase === PHASES.PAUSED || state.phase === PHASES.NO_CAMERA || state.phase === PHASES.CALIBRATING) {
    return state.phase;
  }
  if (state.uncertain) return 'READING_UNCERTAIN';
  return state.phase;
}

function clearCycle(s) {
  return {
    ...s,
    tare: null,
    net: null,
    milestonesDone: [],
    targetAnnounced: false,
    overAnnounced: false,
    over: false,
    checkScaleActive: false,
    directionWarning: false,
    pending: null,
    jumpSince: null,
  };
}

/**
 * Events:
 *  {type:'CAMERA_ON'} {type:'CAMERA_OFF'} {type:'CALIBRATE'} {type:'CALIBRATION_DONE'}
 *  {type:'READING', time, value|null, uncertain, reason}
 *      value = latest *accepted* (consensus) gross reading
 *  {type:'CAPTURE_TARE', time, stability:{stable, median, reason}}
 *  {type:'NEW_SACK'} {type:'PAUSE'} {type:'RESUME'} {type:'SET_CONFIG', config}
 */
export function step(state, event) {
  const effects = [];
  let s = state;
  const cfg = s.config;
  switch (event.type) {
    case 'CAMERA_ON':
      if (s.phase === PHASES.NO_CAMERA) s = { ...s, phase: s.tare != null ? PHASES.TARE_CAPTURED : PHASES.WAITING_FOR_TARE };
      break;
    case 'CAMERA_OFF':
      s = { ...s, phase: PHASES.NO_CAMERA, uncertain: true, uncertainReason: 'camera not running' };
      break;
    case 'CALIBRATE':
      if (s.phase !== PHASES.CALIBRATING) s = { ...s, phase: PHASES.CALIBRATING, pausedFrom: s.phase };
      break;
    case 'CALIBRATION_DONE':
      if (s.phase === PHASES.CALIBRATING) {
        const back = s.pausedFrom && s.pausedFrom !== PHASES.NO_CAMERA ? s.pausedFrom : PHASES.WAITING_FOR_TARE;
        s = { ...s, phase: back, pausedFrom: null };
      }
      break;
    case 'PAUSE':
      if (s.phase !== PHASES.PAUSED && s.phase !== PHASES.NO_CAMERA) {
        s = { ...s, pausedFrom: s.phase, phase: PHASES.PAUSED };
        effects.push({ type: 'PAUSED' });
      }
      break;
    case 'RESUME':
      if (s.phase === PHASES.PAUSED) {
        s = { ...s, phase: s.pausedFrom || PHASES.WAITING_FOR_TARE, pausedFrom: null, pending: null };
        effects.push({ type: 'RESUMED' });
      }
      break;
    case 'SET_CONFIG':
      s = { ...s, config: { ...cfg, ...event.config } };
      break;
    case 'NEW_SACK':
      s = clearCycle(s);
      if (s.phase !== PHASES.NO_CAMERA && s.phase !== PHASES.CALIBRATING) s.phase = PHASES.WAITING_FOR_TARE;
      if (s.phase === PHASES.CALIBRATING) s.pausedFrom = PHASES.WAITING_FOR_TARE;
      effects.push({ type: 'CYCLE_RESET' });
      break;
    case 'CAPTURE_TARE': {
      const allowed = s.phase === PHASES.WAITING_FOR_TARE || s.phase === PHASES.TARE_CAPTURED;
      if (!allowed) {
        const why = s.phase === PHASES.FILLING || s.phase === PHASES.TARGET_REACHED
          ? 'Filling in progress - press NEW SACK first'
          : `Not available while ${s.phase.replace(/_/g, ' ').toLowerCase()}`;
        effects.push({ type: 'TARE_REJECTED', reason: why });
        break;
      }
      if (s.uncertain) {
        effects.push({ type: 'TARE_REJECTED', reason: `No reliable reading: ${s.uncertainReason}` });
        break;
      }
      const st = event.stability;
      if (!st || !st.stable) {
        effects.push({ type: 'TARE_REJECTED', reason: `Display not stable: ${st ? st.reason : 'unknown'}` });
        break;
      }
      s = clearCycle(s);
      s.tare = Math.round(st.median * 100) / 100;
      s.phase = PHASES.TARE_CAPTURED;
      s.net = s.gross != null ? normaliseNet(computeNet(s.gross, s.tare, cfg.direction), cfg).net : 0;
      effects.push({ type: 'TARE_CAPTURED', tare: s.tare });
      break;
    }
    case 'READING':
      s = onReading(s, event, effects);
      break;
    default:
      throw new Error(`unknown event ${event.type}`);
  }
  return { state: s, effects };
}

function onReading(s, ev, effects) {
  const cfg = s.config;
  const t = ev.time;
  if (ev.uncertain || ev.value == null) {
    const wasUncertain = s.uncertain;
    s = { ...s, uncertain: true, uncertainReason: ev.reason || 'no reliable reading', pending: null };
    const active = s.phase === PHASES.FILLING || s.phase === PHASES.TARGET_REACHED;
    if (active && !s.checkScaleActive && (s.net ?? 0) >= cfg.checkScaleFromKg) {
      s.checkScaleActive = true;
      effects.push({ type: 'CHECK_SCALE', reason: s.uncertainReason });
    } else if (!wasUncertain) {
      effects.push({ type: 'UNCERTAIN', reason: s.uncertainReason });
    }
    return s;
  }

  // Valid accepted reading.
  const value = ev.value;
  s = { ...s, gross: value, uncertain: false, uncertainReason: '' };
  if (s.checkScaleActive) { s.checkScaleActive = false; effects.push({ type: 'READING_RECOVERED' }); }

  // Large jumps between accepted values (e.g. a sack swinging) need to hold
  // for longer before they count.
  let trusted = true;
  if (s.lastValue != null && Math.abs(value - s.lastValue) > cfg.maxJumpKg) {
    if (s.jumpSince == null || s.jumpValue !== value) { s.jumpSince = t; s.jumpValue = value; }
    trusted = t - s.jumpSince >= cfg.jumpConfirmMs;
  } else {
    s.jumpSince = null;
  }
  if (!trusted) return s;
  s.lastValue = value; s.lastValueTime = t; s.jumpSince = null;

  if (s.phase === PHASES.PAUSED || s.phase === PHASES.CALIBRATING || s.phase === PHASES.NO_CAMERA ||
      s.phase === PHASES.WAITING_FOR_TARE || s.tare == null) {
    return s;
  }

  const { net, warning } = normaliseNet(computeNet(value, s.tare, cfg.direction), cfg);
  s.net = net;
  if (warning !== s.directionWarning) {
    s.directionWarning = warning;
    if (warning) effects.push({ type: 'DIRECTION_WARNING', net });
  }

  if (s.phase === PHASES.TARE_CAPTURED) {
    if (net >= cfg.fillStartKg) {
      if (!s.pending || s.pending.kind !== 'fill') s.pending = { kind: 'fill', since: t };
      if (t - s.pending.since >= cfg.sustainMs) {
        s.phase = PHASES.FILLING; s.pending = null;
        effects.push({ type: 'FILLING_STARTED', net });
      }
    } else s.pending = null;
  }

  if (s.phase === PHASES.FILLING || s.phase === PHASES.TARGET_REACHED) {
    // Spoken milestones: once per cycle each.
    for (const m of cfg.speechMilestones) {
      if (net >= m && net < cfg.targetKg && !s.milestonesDone.includes(m)) {
        s.milestonesDone = [...s.milestonesDone, m];
        effects.push({ type: 'MILESTONE', kg: m });
      }
    }
    if (s.phase === PHASES.FILLING) {
      if (net >= cfg.targetKg) {
        if (!s.pending || s.pending.kind !== 'target') s.pending = { kind: 'target', since: t };
        if (t - s.pending.since >= cfg.sustainMs) {
          s.phase = PHASES.TARGET_REACHED; s.pending = null;
          if (!s.targetAnnounced) { s.targetAnnounced = true; effects.push({ type: 'TARGET_REACHED', net }); }
        }
      } else s.pending = null;
    }
    const overNow = net >= cfg.targetKg + cfg.overMarginKg;
    if (s.phase === PHASES.TARGET_REACHED) {
      s.over = overNow;
      if (overNow && !s.overAnnounced) { s.overAnnounced = true; effects.push({ type: 'OVER_TARGET', net }); }
    }
  }
  return s;
}

/** Derived numbers for display. */
export function summary(state) {
  const cfg = state.config;
  const net = state.net;
  return {
    displayState: displayState(state),
    gross: state.gross,
    tare: state.tare,
    net,
    target: cfg.targetKg,
    remaining: net == null ? null : Math.max(0, Math.round((cfg.targetKg - net) * 100) / 100),
    progress: net == null ? 0 : Math.max(0, Math.min(1, net / cfg.targetKg)),
    approachLevel: state.phase === PHASES.FILLING && !state.uncertain ? approachLevel(net, cfg) : 0,
    over: state.over,
    directionWarning: state.directionWarning,
    checkScale: state.checkScaleActive,
  };
}
