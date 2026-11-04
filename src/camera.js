// TareMate - camera lifecycle: selection, start/stop, zoom, frame freshness.

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.track = null;
    this.frameCount = 0;     // frames presented since start
    this.lastFrameTime = 0;  // performance.now() of last presented frame
    this.onEnded = null;
    this._rvfc = null;
  }

  static async list() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }

  /** Start the camera. Prefers the saved device, otherwise the rear camera. */
  async start(deviceId = null) {
    if (!window.isSecureContext) throw new CameraError('insecure', 'The camera needs HTTPS (or localhost). Open TareMate from its https:// address.');
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported', 'This browser does not support camera access.');
    this.stop();
    const base = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    const attempts = deviceId
      ? [{ ...base, deviceId: { exact: deviceId } }, { ...base, facingMode: { ideal: 'environment' } }]
      : [{ ...base, facingMode: { ideal: 'environment' } }, { ...base }, true];
    let lastErr;
    for (const video of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        break;
      } catch (e) {
        lastErr = e;
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break;
      }
    }
    if (!this.stream) throw CameraError.from(lastErr);
    this.track = this.stream.getVideoTracks()[0];
    this.track.addEventListener('ended', () => this.onEnded?.('Camera stream ended'));
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this._watchFrames();
    // Continuous autofocus helps at close range where supported.
    try {
      const caps = this.track.getCapabilities?.() || {};
      if (caps.focusMode?.includes('continuous')) await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch { /* optional */ }
    return this.settings();
  }

  _watchFrames() {
    const v = this.video;
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const cb = () => {
        this.frameCount++;
        this.lastFrameTime = performance.now();
        if (this.stream) this._rvfc = v.requestVideoFrameCallback(cb);
      };
      this._rvfc = v.requestVideoFrameCallback(cb);
    } else {
      // Fallback: treat currentTime advancing as new frames.
      let last = -1;
      const tick = () => {
        if (!this.stream) return;
        if (v.currentTime !== last) { last = v.currentTime; this.frameCount++; this.lastFrameTime = performance.now(); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  settings() {
    const s = this.track?.getSettings?.() || {};
    return { deviceId: s.deviceId, width: s.width, height: s.height, label: this.track?.label || '' };
  }

  zoomCapability() {
    const caps = this.track?.getCapabilities?.() || {};
    return caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: this.track.getSettings().zoom } : null;
  }

  async setZoom(z) {
    if (!this.track) return;
    try { await this.track.applyConstraints({ advanced: [{ zoom: z }] }); } catch { /* unsupported */ }
  }

  get running() { return !!this.stream && this.track?.readyState === 'live'; }

  /** ms since a new frame was presented. */
  frameAge() { return performance.now() - this.lastFrameTime; }

  stop() {
    if (this._rvfc && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this._rvfc);
    this._rvfc = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
  }
}

export class CameraError extends Error {
  constructor(code, message) { super(message); this.code = code; }
  static from(e) {
    if (!e) return new CameraError('unknown', 'Camera could not be started.');
    switch (e.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new CameraError('denied', 'Camera permission was refused. Allow camera access for this site in Chrome (padlock icon > Permissions), then press Start again.');
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new CameraError('missing', 'No suitable camera was found on this device.');
      case 'NotReadableError':
      case 'AbortError':
        return new CameraError('busy', 'The camera is in use by another app or failed to start. Close other camera apps and try again.');
      default:
        return new CameraError('unknown', `Camera failed to start: ${e.message || e.name}`);
    }
  }
}
