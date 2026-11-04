// TareMate - audio feedback: Web Audio tones + Speech Synthesis.
//
// Must be unlocked from a user gesture (Start button). Tones always work even
// if speech synthesis is unavailable. Only one alert sequence plays at a time;
// approach beeps are suppressed while an alert or speech is playing.

export class AudioFeedback {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 1;
    this.muted = false;
    this.speechEnabled = true;
    this.busyUntil = 0;      // ctx time until which an alert is playing
    this.level = 0;          // approach beep level 0..3
    this._beepTimer = null;
    this._nextBeep = 0;
    this.intervals = [0, 1400, 700, 300]; // ms between approach beeps per level
  }

  /** Call from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this._applyGain();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // Prime speech synthesis (Chrome on Android needs a gesture-initiated utterance).
    if (this.speechEnabled && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
    if (!this._beepTimer) this._beepTimer = setInterval(() => this._tickBeeps(), 50);
    return true;
  }

  get speechAvailable() { return 'speechSynthesis' in window; }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this._applyGain(); }
  setMuted(m) { this.muted = !!m; this._applyGain(); if (m && this.speechAvailable) speechSynthesis.cancel(); }
  _applyGain() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }

  tone(freq, start, dur, type = 'square', vol = 0.6) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.setValueAtTime(vol, t0 + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    this.busyUntil = Math.max(this.busyUntil, t0 + dur);
  }

  /** Play a named pattern, replacing any queued speech. */
  play(kind) {
    if (!this.ctx) return;
    const T = (f, s, d, ty, v) => this.tone(f, s, d, ty, v);
    switch (kind) {
      case 'tare':        T(1047, 0, 0.12, 'sine'); T(1319, 0.16, 0.18, 'sine'); break;
      case 'fill':        T(784, 0, 0.12, 'sine'); break;
      case 'beep':        T(1760, 0, 0.09, 'square', 0.5); break;
      case 'target':      // distinctive rising triad, twice
        for (const off of [0, 0.75]) { T(880, off, 0.18, 'square'); T(1175, off + 0.2, 0.18, 'square'); T(1568, off + 0.4, 0.3, 'square'); }
        break;
      case 'over':        // harsh low alternating siren
        for (let i = 0; i < 6; i++) T(i % 2 ? 330 : 440, i * 0.25, 0.22, 'sawtooth', 0.7);
        break;
      case 'check':       T(523, 0, 0.3, 'triangle', 0.7); T(392, 0.4, 0.5, 'triangle', 0.7); break;
      case 'error':       T(220, 0, 0.35, 'sawtooth', 0.6); break;
      case 'test':        T(660, 0, 0.15, 'sine'); T(880, 0.2, 0.15, 'sine'); T(1760, 0.4, 0.1, 'square'); break;
      default: break;
    }
  }

  say(text, { interrupt = true } = {}) {
    if (!this.speechEnabled || this.muted || !this.speechAvailable) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = 1.0;
    u.volume = this.volume;
    speechSynthesis.speak(u);
  }

  setApproachLevel(level) {
    if (level !== this.level) { this.level = level; this._nextBeep = 0; }
  }

  _tickBeeps() {
    if (!this.ctx || !this.level || this.muted) return;
    const now = performance.now();
    if (now < this._nextBeep) return;
    const speaking = this.speechAvailable && speechSynthesis.speaking;
    if (this.ctx.currentTime < this.busyUntil || speaking) { this._nextBeep = now + 150; return; }
    this.play('beep');
    this._nextBeep = now + this.intervals[Math.min(this.level, this.intervals.length - 1)];
  }

  /** React to weighing-machine effects. Keeps target logic out of audio. */
  handleEffect(e) {
    switch (e.type) {
      case 'TARE_CAPTURED': this.play('tare'); this.say('Tare captured'); break;
      case 'TARE_REJECTED': this.play('error'); break;
      case 'FILLING_STARTED': this.play('fill'); break;
      case 'MILESTONE': this.say(`${e.kg} kilograms`); break;
      case 'TARGET_REACHED': this.setApproachLevel(0); this.play('target'); setTimeout(() => this.say('Target reached'), 1400); break;
      case 'OVER_TARGET': this.play('over'); setTimeout(() => this.say('Over target'), 1500); break;
      case 'CHECK_SCALE': this.setApproachLevel(0); this.play('check'); this.say('Check scale'); break;
      case 'DIRECTION_WARNING': this.play('error'); this.say('Check direction setting'); break;
      default: break;
    }
  }

  test() {
    this.unlock();
    this.play('test');
    setTimeout(() => this.say('TareMate sound test'), 700);
  }
}
