// TareMate - persisted settings (localStorage). Everything stays on the device.

import { MACHINE_DEFAULTS } from './weighing-machine.js';
import { STABILITY_DEFAULTS } from './stability-detector.js';
import { FILTER_DEFAULTS } from './reading-filter.js';
import { READER_DEFAULTS } from './weight-reader.js';

const KEY = 'taremate.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  cameraId: null,
  zoom: null,
  // ROI as fractions of the video frame (0..1). Null until calibrated.
  roi: null,
  sampleFps: 5,
  machine: { ...MACHINE_DEFAULTS },
  stability: { ...STABILITY_DEFAULTS },
  filter: { ...FILTER_DEFAULTS },
  reader: { ...READER_DEFAULTS },
  customTemplates: [], // taught on this device: {digit, aspect, vec}
  audio: { volume: 1.0, muted: false, speech: true },
});

function merge(defaults, saved) {
  const out = { ...defaults };
  for (const k of Object.keys(saved || {})) {
    const d = defaults[k], v = saved[k];
    out[k] = d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' && !Array.isArray(v)
      ? { ...d, ...v } : v;
  }
  return out;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return merge(structuredClone(DEFAULT_SETTINGS), raw ? JSON.parse(raw) : {});
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return structuredClone(DEFAULT_SETTINGS);
}
