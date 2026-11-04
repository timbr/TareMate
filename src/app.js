// TareMate - application wiring: camera -> crop -> reader -> filter ->
// stability -> weighing machine -> UI + audio.

import { Camera, CameraError } from './camera.js';
import { grabRoi, clampRoi, fingerprint } from './frame-processing.js';
import { readWeight, segment, glyphVector } from './weight-reader.js';
import { DEFAULT_TEMPLATES } from './digit-templates.js';
import { createReadingFilter } from './reading-filter.js';
import { createStabilityDetector } from './stability-detector.js';
import { initialState, step, summary, PHASES, MACHINE_DEFAULTS } from './weighing-machine.js';
import { AudioFeedback } from './audio-feedback.js';
import { loadSettings, saveSettings, resetSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, dp = 1) => (v == null || Number.isNaN(v) ? '--' : v.toFixed(dp));
const fmtTare = (v) => (v == null ? 'not set' : `${Number.isInteger(v * 10) ? v.toFixed(1) : v.toFixed(2)} kg`);

let settings = loadSettings();
const video = $('video');
const camera = new Camera(video);
const audio = new AudioFeedback();
const workCanvas = document.createElement('canvas');

let filter, stability, machine;
let loopTimer = null;
let lastFrameCount = -1;
let lastPrint = null;
let lastChangeTime = 0;
let lastImg = null;
let lastRaw = null;
let lastFilter = null;
let lastStab = { stable: false, reason: '--' };
let recentValid = [];
let messageTimer = null;
let wakeLock = null;
let fileMode = false;
let view = 'start';

function rebuildPipeline(keepMachine = true) {
  filter = createReadingFilter(settings.filter);
  stability = createStabilityDetector(settings.stability);
  if (!keepMachine || !machine) machine = initialState(settings.machine);
  else machine = step(machine, { type: 'SET_CONFIG', config: settings.machine }).state;
}
rebuildPipeline(false);

function persist() { saveSettings(settings); }

// ---------------------------------------------------------------- views
function setView(v) {
  view = v;
  document.body.className = `view-${v}`;
  if (v === 'setup') { dispatch({ type: 'CALIBRATE' }); positionRoiBox(); populateSetup(); }
  if (v === 'main') dispatch({ type: 'CALIBRATION_DONE' });
  render();
}

// ---------------------------------------------------------------- machine
function dispatch(ev) {
  const r = step(machine, ev);
  machine = r.state;
  for (const e of r.effects) onEffect(e);
  return r.effects;
}

function onEffect(e) {
  audio.handleEffect(e);
  const msgs = {
    TARE_CAPTURED: `Tare captured: ${fmtTare(e.tare)}. Start filling.`,
    TARE_REJECTED: e.reason,
    FILLING_STARTED: 'Filling detected.',
    TARGET_REACHED: 'TARGET REACHED - stop filling and check the scale.',
    OVER_TARGET: 'OVER TARGET - check the scale.',
    CHECK_SCALE: `CHECK SCALE - reading lost (${e.reason}).`,
    READING_RECOVERED: 'Reading recovered.',
    DIRECTION_WARNING: 'Net weight is strongly negative - check the direction setting and tare.',
    CYCLE_RESET: 'New sack: attach the empty sack, let it settle, then capture tare.',
  };
  if (msgs[e.type]) showMessage(msgs[e.type], e.type === 'TARE_REJECTED' ? 6000 : 8000);
}

function showMessage(text, ms = 6000) {
  $('message').textContent = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { $('message').textContent = ''; }, ms);
}

// ---------------------------------------------------------------- processing loop
function templates() { return [...DEFAULT_TEMPLATES, ...(settings.customTemplates || [])]; }

function startLoop() {
  clearInterval(loopTimer);
  loopTimer = setInterval(tick, Math.round(1000 / Math.max(1, Math.min(15, settings.sampleFps))));
}

function tick() {
  const now = performance.now();
  if (!camera.running && !fileMode) {
    if (machine.phase !== PHASES.NO_CAMERA) dispatch({ type: 'CAMERA_OFF' });
    render();
    return;
  }
  // A frame is fresh if the browser presented a new video frame or the
  // cropped pixels changed (real sensors always add some noise). A frozen
  // stream shows neither.
  const img = settings.roi ? grabRoi(video, settings.roi, workCanvas) : null;
  const print = img ? fingerprint(img) : null;
  if (camera.frameCount !== lastFrameCount || (print !== null && print !== lastPrint)) lastChangeTime = now;
  lastFrameCount = camera.frameCount;
  lastPrint = print;
  const fresh = !video.paused && now - lastChangeTime < 1500;
  let raw;
  if (!settings.roi) {
    raw = { valid: false, value: null, text: '', reason: 'display area not set - open setup', confidence: 0, timestamp: now };
  } else {
    lastImg = img;
    raw = img
      ? readWeight(img, { ...settings.reader, templates: templates(), timestamp: now })
      : { valid: false, value: null, text: '', reason: 'no video frame', confidence: 0, timestamp: now };
  }
  lastRaw = raw;
  const f = filter.push(raw, { fresh });
  lastFilter = f;
  if (fresh && raw.valid) stability.add(raw.value, now); else stability.gap(now);
  lastStab = stability.evaluate(now);
  recentValid.push(fresh && raw.valid ? 1 : 0);
  if (recentValid.length > 50) recentValid.shift();

  let reason = f.reason;
  if (!fresh) reason = video.paused ? 'preview paused' : 'camera frame not updating';
  else if (f.uncertain && !raw.valid && raw.reason) reason = `${f.reason} (${raw.reason})`;
  dispatch({ type: 'READING', time: now, value: f.accepted?.value ?? null, uncertain: f.uncertain || !fresh, reason });
  render();
}

// ---------------------------------------------------------------- rendering
const BANNERS = {
  NO_CAMERA: ['s-off', '■', 'CAMERA OFF'],
  CALIBRATING: ['s-off', '⚙', 'SETUP'],
  WAITING_FOR_TARE: ['s-wait', '①', 'ATTACH EMPTY SACK, THEN CAPTURE TARE'],
  TARE_CAPTURED: ['s-tare', '✔', 'TARE LOCKED - START FILLING'],
  FILLING: ['s-fill', '▲', 'FILLING'],
  TARGET_REACHED: ['s-target', '★', 'TARGET REACHED'],
  OVER: ['s-over', '⚠', 'OVER TARGET'],
  READING_UNCERTAIN: ['s-uncertain', '?', 'NO RELIABLE READING'],
  CHECK_SCALE: ['s-checkscale', '⚠', 'CHECK SCALE'],
  PAUSED: ['s-paused', '❚❚', 'PAUSED - NOT MONITORING'],
};

function render() {
  const sm = summary(machine);
  let key = sm.displayState;
  if (key === 'TARGET_REACHED' && sm.over) key = 'OVER';
  if (key === 'READING_UNCERTAIN' && sm.checkScale) key = 'CHECK_SCALE';
  const [cls, icon, text] = BANNERS[key] || BANNERS.NO_CAMERA;
  const banner = $('banner');
  banner.className = `banner ${cls}`;
  $('bannerIcon').textContent = icon;
  $('bannerText').textContent = text;
  $('chip').textContent = key.replace(/_/g, ' ');

  const cfg = machine.config;
  const hasTare = machine.tare != null;
  const net = hasTare ? sm.net : null;
  $('netValue').textContent = fmt(net);
  $('netValue').parentElement.classList.toggle('stale', machine.uncertain && hasTare);
  const pf = $('progressFill');
  pf.style.width = `${Math.round((hasTare ? sm.progress : 0) * 100)}%`;
  pf.className = 'pfill' + (sm.over ? ' over' : machine.phase === PHASES.TARGET_REACHED ? ' done' : sm.approachLevel ? ' near' : '');
  $('remaining').textContent = !hasTare
    ? `Target ${fmt(cfg.targetKg)} kg`
    : sm.over ? `${fmt(net - cfg.targetKg)} kg OVER target`
      : machine.phase === PHASES.TARGET_REACHED ? 'Target reached'
        : `${fmt(sm.remaining)} kg remaining`;
  $('grossValue').textContent = machine.gross == null ? '--' : `${fmt(machine.gross)} kg`;
  $('tareValue').textContent = fmtTare(machine.tare);
  $('targetValue').textContent = `${fmt(cfg.targetKg)} kg`;
  $('readingStatus').textContent = machine.uncertain ? 'UNCERTAIN' : 'OK';
  $('readingStatus').className = machine.uncertain ? 'bad' : 'ok';

  const canTare = machine.phase === PHASES.WAITING_FOR_TARE || machine.phase === PHASES.TARE_CAPTURED;
  const btnTare = $('btnTare');
  btnTare.disabled = !canTare;
  btnTare.textContent = machine.phase === PHASES.TARE_CAPTURED ? 'RE-CAPTURE TARE' : 'CAPTURE TARE';
  if (canTare && !$('message').textContent) {
    $('message').textContent = machine.uncertain
      ? `Tare unavailable: ${machine.uncertainReason}`
      : lastStab.stable ? 'Display stable - ready to capture tare' : `Waiting for stable display: ${lastStab.reason}`;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { $('message').textContent = ''; }, 900);
  }
  $('btnPause').textContent = machine.phase === PHASES.PAUSED ? 'RESUME' : 'PAUSE';
  $('btnMute').textContent = settings.audio.muted ? '🔇' : '🔊';
  $('btnMute').setAttribute('aria-label', settings.audio.muted ? 'Unmute sound' : 'Mute sound');

  audio.setApproachLevel(machine.phase === PHASES.PAUSED ? 0 : sm.approachLevel);

  if (view === 'main' && lastImg) drawImg($('roiThumb'), lastImg);
  if (view === 'setup') renderDiagnostics();
}

function drawImg(canvas, img) {
  if (canvas.width !== img.width || canvas.height !== img.height) { canvas.width = img.width; canvas.height = img.height; }
  canvas.getContext('2d').putImageData(img, 0, 0);
}

function renderDiagnostics() {
  if (lastImg) {
    drawImg($('roiCanvas'), lastImg);
    const seg = segment(lastImg, settings.reader);
    const mc = $('maskCanvas');
    mc.width = lastImg.width; mc.height = lastImg.height;
    const ctx = mc.getContext('2d');
    const out = ctx.createImageData(lastImg.width, lastImg.height);
    if (seg.norm) {
      for (let i = 0; i < seg.norm.length; i++) {
        const on = seg.labels[i] >= 0;
        const v = on ? 255 : Math.round(seg.norm[i] * 90);
        out.data.set([v, v, v, 255], i * 4);
      }
    }
    ctx.putImageData(out, 0, 0);
    const box = (c, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(c.x0 + 0.5, c.y0 + 0.5, c.w - 1, c.h - 1); };
    (seg.digits || []).forEach((c) => box(c, '#00e5ff'));
    (seg.dots || []).forEach((c) => box(c, '#ffd400'));
    (seg.minuses || []).forEach((c) => box(c, '#ff4d4d'));
    (seg.pluses || []).forEach((c) => box(c, '#4dff88'));
    (seg.strays || []).forEach((c) => box(c, '#ff00ff'));
  }
  const r = lastRaw;
  $('dRaw').textContent = r ? (r.text || '(none)') : '--';
  $('dValid').textContent = r ? (r.valid ? 'valid' : `rejected: ${r.reason}`) : '--';
  $('dValid').className = r?.valid ? 'ok' : 'bad';
  $('dConf').textContent = r ? r.confidence.toFixed(2) + ' (match quality, not a probability)' : '--';
  $('dScores').textContent = r?.digitScores ? r.digitScores.join('  ') : '--';
  $('dAccepted').textContent = lastFilter
    ? (lastFilter.accepted ? `${lastFilter.accepted.text} kg` : `none - ${lastFilter.reason}`) : '--';
  $('dStable').textContent = lastStab.stable ? `STABLE, median ${fmtTare(lastStab.median)}` : lastStab.reason;
  $('dStable').className = lastStab.stable ? 'ok' : 'bad';
  $('dFrames').textContent = `${camera.frameCount} shown, last ${Math.round(camera.frameAge())} ms ago, ${video.videoWidth}x${video.videoHeight}`;
  const rate = recentValid.length ? recentValid.reduce((a, b) => a + b, 0) / recentValid.length : 0;
  $('dRate').textContent = `${Math.round(rate * 100)}%`;
}

// ---------------------------------------------------------------- camera
async function startCamera(deviceId = settings.cameraId) {
  fileMode = false;
  video.loop = false;
  video.removeAttribute('src');
  try {
    const s = await camera.start(deviceId);
    settings.cameraId = s.deviceId || null;
    persist();
    if (settings.zoom != null) await camera.setZoom(settings.zoom);
    dispatch({ type: 'CAMERA_ON' });
    $('stageMsg').hidden = true;
    await refreshCameraList();
    return true;
  } catch (e) {
    const msg = e instanceof CameraError ? e.message : `Camera error: ${e.message}`;
    $('startError').textContent = msg;
    $('stageMsg').textContent = msg; $('stageMsg').hidden = false;
    showMessage(msg, 15000);
    dispatch({ type: 'CAMERA_OFF' });
    return false;
  }
}

camera.onEnded = (why) => {
  dispatch({ type: 'CAMERA_OFF' });
  audio.play('check');
  showMessage(`${why}. Monitoring stopped - press Restart camera in setup.`, 20000);
};

async function startFile(src) {
  camera.stop();
  fileMode = true;
  video.srcObject = null;
  video.src = src;
  video.loop = true;
  video.muted = true;
  await video.play();
  camera.frameCount = 0;
  camera.lastFrameTime = performance.now();
  // Reuse the camera's frame counter for freshness.
  const cb = () => { camera.frameCount++; camera.lastFrameTime = performance.now(); if (fileMode) video.requestVideoFrameCallback(cb); };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(cb);
  dispatch({ type: 'CAMERA_ON' });
  $('camInfo').textContent = 'Playing a test video file (not the live camera).';
}

async function refreshCameraList() {
  const sel = $('selCamera');
  const cams = await Camera.list();
  sel.innerHTML = '';
  cams.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = c.deviceId;
    o.textContent = c.label || `Camera ${i + 1}`;
    if (c.deviceId === settings.cameraId) o.selected = true;
    sel.appendChild(o);
  });
  const s = camera.settings();
  $('camInfo').textContent = camera.running ? `${s.label || 'camera'} - ${s.width}x${s.height}` : '';
  const z = camera.zoomCapability();
  $('zoomRow').hidden = !z;
  if (z) {
    const r = $('rngZoom');
    r.min = z.min; r.max = z.max; r.step = z.step; r.value = settings.zoom ?? z.value ?? z.min;
    $('zoomOut').textContent = `${(+r.value).toFixed(1)}x`;
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) { showMessage('Screen keep-awake is not supported: set the screen timeout manually.', 8000); return; }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {
    showMessage(`Could not keep the screen awake (${e.message}). Set the screen timeout manually.`, 8000);
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    if (!wakeLock && view !== 'start') await requestWakeLock();
    if (view !== 'start' && !fileMode && !camera.running) await startCamera();
  }
});

// ---------------------------------------------------------------- ROI editing
function positionRoiBox() {
  const box = $('roiBox');
  const stage = $('stage');
  if (video.videoWidth) stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  if (!settings.roi) settings.roi = { x: 0.3, y: 0.4, w: 0.4, h: 0.15 };
  const r = settings.roi;
  box.hidden = false;
  Object.assign(box.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
}

video.addEventListener('loadedmetadata', positionRoiBox);

(function setupRoiDrag() {
  const stage = $('stage');
  const box = $('roiBox');
  let drag = null;
  const frac = (e) => {
    const b = stage.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  };
  stage.addEventListener('pointerdown', (e) => {
    if (view !== 'setup') return;
    const p = frac(e);
    const r = settings.roi || { x: p.x, y: p.y, w: 0.05, h: 0.05 };
    let mode = 'new';
    if (e.target.classList.contains('roihandle')) mode = 'resize';
    else if (e.target === box) mode = 'move';
    drag = { mode, start: p, roi: { ...r } };
    if (mode === 'new') settings.roi = { x: p.x, y: p.y, w: 0.03, h: 0.03 };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = frac(e);
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    const r = drag.roi;
    if (drag.mode === 'move') settings.roi = clampRoi({ ...r, x: r.x + dx, y: r.y + dy });
    else if (drag.mode === 'resize') settings.roi = clampRoi({ ...r, w: r.w + dx, h: r.h + dy });
    else settings.roi = clampRoi({ x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(dx), h: Math.abs(dy) });
    positionRoiBox();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    persist();
    filter.reset(); stability.reset();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
})();

// ---------------------------------------------------------------- teach digits
function teach() {
  const text = $('txtTeach').value.trim().replace(',', '.');
  const m = /^([+-]?)(\d{1,3})\.(\d)$/.exec(text);
  if (!m) { $('teachInfo').textContent = 'Enter the value exactly as displayed, e.g. -32.5'; return; }
  if (!lastImg) { $('teachInfo').textContent = 'No camera image yet.'; return; }
  const digitsText = m[2] + m[3];
  const seg = segment(lastImg, settings.reader);
  if (seg.error || !seg.digits) { $('teachInfo').textContent = `Cannot see the digits: ${seg.error || 'none found'}`; return; }
  if (seg.digits.length !== digitsText.length) {
    $('teachInfo').textContent = `Found ${seg.digits.length} digit shapes but "${text}" has ${digitsText.length}. Adjust the box or wait for a steady display.`;
    return;
  }
  const custom = [...(settings.customTemplates || [])];
  seg.digits.forEach((c, i) => {
    const vec = Array.from(glyphVector(seg.norm, seg.labels, seg.width, c), (v) => +v.toFixed(2));
    custom.push({ digit: digitsText[i], aspect: +(c.w / c.h).toFixed(3), vec, taught: Date.now() });
  });
  // Keep at most 6 taught examples per digit (newest).
  const byDigit = {};
  for (const t of custom.reverse()) { (byDigit[t.digit] ||= []).length < 6 && byDigit[t.digit].push(t); }
  settings.customTemplates = Object.values(byDigit).flat();
  persist();
  showTeachInfo(`Learnt ${digitsText.split('').join(', ')}.`);
}
function showTeachInfo(prefix = '') {
  const n = (settings.customTemplates || []).length;
  const ds = [...new Set((settings.customTemplates || []).map((t) => t.digit))].sort().join(' ');
  $('teachInfo').textContent = `${prefix} ${n ? `${n} taught examples (digits ${ds}) used alongside the built-in ones.` : 'Using built-in digit shapes only.'}`.trim();
}

// ---------------------------------------------------------------- setup form
const listNums = (s) => s.split(/[,\s]+/).filter((x) => x !== '').map(Number).filter((n) => Number.isFinite(n) && n > 0);

function populateSetup() {
  const m = settings.machine, st = settings.stability, f = settings.filter, r = settings.reader, a = settings.audio;
  $('numTarget').value = m.targetKg;
  $('selDirection').value = m.direction;
  $('numFillStart').value = m.fillStartKg;
  $('numOver').value = m.overMarginKg;
  $('txtMilestones').value = m.speechMilestones.join(', ');
  $('txtBeeps').value = m.beepLevels.join(', ');
  $('numNoise').value = m.noiseKg;
  $('numFps').value = settings.sampleFps;
  $('numAgree').value = f.agree;
  $('numUncertain').value = f.uncertainAfterMs;
  $('numWindow').value = st.windowMs;
  $('numTol').value = st.toleranceKg;
  $('numMinReads').value = st.minReadings;
  $('txtLastDigits').value = r.allowedLastDigits;
  $('chkSign').checked = r.requireSign;
  $('numMinScore').value = r.minScore;
  $('numMinMargin').value = r.minMargin;
  $('rngVolume').value = a.volume;
  $('chkSpeech').checked = a.speech;
  $('speechInfo').textContent = audio.speechAvailable ? '' : 'Speech is not available in this browser; tones only.';
  showTeachInfo();
  refreshCameraList();
}

function readSetup() {
  const num = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : d; };
  const m = settings.machine;
  settings.machine = {
    ...m,
    targetKg: num('numTarget', m.targetKg),
    direction: $('selDirection').value,
    fillStartKg: num('numFillStart', m.fillStartKg),
    overMarginKg: num('numOver', m.overMarginKg),
    speechMilestones: listNums($('txtMilestones').value),
    beepLevels: listNums($('txtBeeps').value).sort((x, y) => x - y),
    noiseKg: num('numNoise', m.noiseKg),
  };
  settings.sampleFps = num('numFps', settings.sampleFps);
  settings.filter = { ...settings.filter, agree: Math.round(num('numAgree', settings.filter.agree)), uncertainAfterMs: num('numUncertain', settings.filter.uncertainAfterMs) };
  settings.stability = { ...settings.stability, windowMs: num('numWindow', settings.stability.windowMs), toleranceKg: num('numTol', settings.stability.toleranceKg), minReadings: Math.round(num('numMinReads', settings.stability.minReadings)) };
  settings.reader = { ...settings.reader, allowedLastDigits: $('txtLastDigits').value.replace(/[^0-9]/g, ''), requireSign: $('chkSign').checked, minScore: num('numMinScore', settings.reader.minScore), minMargin: num('numMinMargin', settings.reader.minMargin) };
  settings.audio = { ...settings.audio, volume: num('rngVolume', 1), speech: $('chkSpeech').checked };
  applyAudio();
  persist();
  rebuildPipeline(true);
  startLoop();
}

function applyAudio() {
  audio.setVolume(settings.audio.volume);
  audio.setMuted(settings.audio.muted);
  audio.speechEnabled = settings.audio.speech;
}

$('screenSetup').addEventListener('change', (e) => {
  if (['selCamera', 'fileVideo', 'rngZoom', 'txtTeach'].includes(e.target.id)) return;
  readSetup();
});

// ---------------------------------------------------------------- buttons
$('btnStart').addEventListener('click', async () => {
  $('startError').textContent = '';
  audio.unlock();
  applyAudio();
  await requestWakeLock();
  // Phone is mounted in landscape; locking only works for the installed app.
  try { await screen.orientation?.lock?.('landscape'); } catch { /* not installed / unsupported */ }
  const demo = new URLSearchParams(location.search).get('demo');
  const ok = demo ? (await startFile(demo), true) : await startCamera();
  startLoop();
  if (ok) setView(settings.roi ? 'main' : 'setup');
  else setView('setup');
});

$('btnTare').addEventListener('click', () => {
  dispatch({ type: 'CAPTURE_TARE', time: performance.now(), stability: stability.evaluate(performance.now()) });
  render();
});
$('btnNewSack').addEventListener('click', () => { dispatch({ type: 'NEW_SACK' }); stability.reset(); render(); });
$('btnPause').addEventListener('click', () => {
  dispatch({ type: machine.phase === PHASES.PAUSED ? 'RESUME' : 'PAUSE' });
  render();
});
$('btnMute').addEventListener('click', () => {
  audio.unlock();
  settings.audio.muted = !settings.audio.muted;
  applyAudio(); persist(); render();
});
$('btnSetup').addEventListener('click', () => setView(view === 'setup' ? (camera.running || fileMode ? 'main' : 'start') : 'setup'));
$('btnDone').addEventListener('click', () => { readSetup(); setView(camera.running || fileMode ? 'main' : 'start'); });
$('btnRestartCam').addEventListener('click', async () => { await startCamera($('selCamera').value || null); startLoop(); });
$('selCamera').addEventListener('change', async (e) => { settings.zoom = null; await startCamera(e.target.value); startLoop(); });
$('btnPreview').addEventListener('click', () => {
  if (video.paused) { video.play(); $('btnPreview').textContent = 'Pause preview'; }
  else { video.pause(); $('btnPreview').textContent = 'Resume preview'; }
});
$('rngZoom').addEventListener('input', async (e) => {
  settings.zoom = +e.target.value;
  $('zoomOut').textContent = `${settings.zoom.toFixed(1)}x`;
  await camera.setZoom(settings.zoom);
  persist();
});
$('fileVideo').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (file) { await startFile(URL.createObjectURL(file)); startLoop(); }
});
$('btnTeach').addEventListener('click', teach);
$('btnClearTeach').addEventListener('click', () => { settings.customTemplates = []; persist(); showTeachInfo('Forgotten.'); });
$('btnTestSound').addEventListener('click', () => { applyAudio(); audio.test(); });
$('btnTargetDefault').addEventListener('click', () => { $('numTarget').value = MACHINE_DEFAULTS.targetKg; readSetup(); });
$('btnResetAll').addEventListener('click', () => {
  if (!confirm('Reset all TareMate settings, including the display box and taught digits?')) return;
  settings = resetSettings();
  rebuildPipeline(false);
  if (camera.running || fileMode) dispatch({ type: 'CAMERA_ON' });
  dispatch({ type: 'CALIBRATE' });
  populateSetup(); positionRoiBox(); startLoop();
});

// ---------------------------------------------------------------- PWA
if ('serviceWorker' in navigator && !location.search.includes('nosw')) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
$('buildInfo').textContent = 'TareMate 0.1.0';

applyAudio();
populateSetup();
setView('start');

// Debug handle for remote inspection (chrome://inspect); read-only use.
window.__taremate = { get raw() { return lastRaw; }, get filter() { return lastFilter; }, get machine() { return machine; }, get stab() { return lastStab; }, get frames() { return { count: camera.frameCount, lastChangeTime, now: performance.now() }; } };
