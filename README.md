# TareMate

A camera-based weighing assistant for filling sacks to a target weight (default 25.0 kg).
It's a local-first PWA: plain HTML, CSS and JavaScript, no framework, no server and no cloud. All image
processing runs on the phone, and camera frames are never stored or sent anywhere.

> **Advisory aid only.** This is not a certified or legal-for-trade weighing instrument. The scale
> stays the source of truth. Keep it in view and stay in control of filling.

## Running it

```bash
npm test                 # 29 tests: weighing logic, stability, filter, recogniser on real frames
node tools/serve.mjs     # dev server on http://localhost:8080
```

### On the Pixel (development, over USB)

The camera only works in a secure context (HTTPS or `localhost`). With USB debugging on:

```bash
adb reverse tcp:8080 tcp:8080
```

Then open `http://localhost:8080` in Chrome on the phone. Use Chrome menu → *Add to Home screen* /
*Install app* to install it.

### Permanent install

Host the folder on any static HTTPS host (GitHub Pages, Netlify, an internal web server) and open it
once on the phone. After the first load the service worker caches the app, so it works offline.
Bump `VERSION` in `service-worker.js` with each release.

### Demo without the scale

`http://localhost:8080/?demo=test-assets/demo.mp4` plays a 960×540 clip of the commissioning
video through the full pipeline. The crop box still has to be set in setup. In setup you can also
choose any video file from the phone instead of the live camera.

## Using it

1. **START** starts the camera, unlocks sound and keeps the screen awake.
2. The first time, setup opens. Drag a box over the large digits **and** the minus sign. Keep it
   inside the LCD's blue border and away from `GROSS kg`. Check that *Frame result* shows `valid`.
3. Attach the empty sack, wait for it to settle, then press **CAPTURE TARE**. Tare is only
   accepted when the display is stable. The message line explains why it's refused when it isn't.
4. Fill. Spoken "20 kilograms" and "22 kilograms", then beeps that speed up from 23 kg, then the
   target alarm, and a separate over-target siren.
5. **NEW SACK** clears the tare and all milestone flags for the next sack.

The layout is designed for a phone mounted in **landscape** (the installed app locks to landscape).

### If the phone position changes

Re-draw the crop box in setup. If the viewing angle makes the digits look different, show a steady
reading, type it into **Teach digits** (for example `-32.5`) and press *Teach*. This stores the digit
shapes on the phone, and they're used alongside the built-in ones. Do this a few times with
readings that between them contain every digit.

## What the commissioning video showed

(`photos and video/PXL_20261104_121605137.mp4`, 207 s, analysed at 5 fps = 1037 frames)

| Question from the brief | Finding |
|---|---|
| Display type | Dot-matrix graphic LCD, blue bitmap font on a pale panel. Separate sign character at the far left (`-`, and `+` was seen briefly). |
| Direction | Display **increases** as material is added (−32.0 → −7.5). Default direction = `increase`. Confirm with a real test. |
| Resolution | **0.5 kg**: every reading ends in `.0` or `.5`. |
| Noise at rest | Flickers by one count (−32.0 / −32.5), so stability tolerance defaults to 0.5 kg. |
| Hanging the sack | Brief swings to −35.0 and one frame of `+48.5`. |
| Transitions | The LCD ghosts old and new digits for a frame or two. These frames are rejected or filtered out. |
| Dirt | A permanent fleck on the decimal digit. Handled by matching the last digit against 0 and 5 only. |

### Recognition approach

The brief's suggested order was Tesseract.js, then OpenCV.js, then a specialised recogniser. Because
this display has one fixed bitmap font and a tiny character set, I went straight to a **specialised
template recogniser**. Tesseract.js was **not benchmarked**. The template recogniser needs no
WASM/OCR download, runs in about a millisecond per frame, and gives per-digit match scores, which
make ghosted frames easy to reject. Pipeline (`src/weight-reader.js`):

blue-excess ink map → Otsu threshold → remove border lines → connected components → classify each
component as digit, decimal point, minus or plus → match each digit to 10×16 templates
(`src/digit-templates.js`, built from the video by `tools/build-templates.mjs`) → structural checks
(sign visible, decimal point, last digit 0/5, plausible range).

Results on the video:

- **90%** of frames give a valid frame-level reading. The rest are rejected, mostly as transitions.
- After 3-frame consensus (`src/reading-filter.js`), **every accepted value change during the fill
  (30 of them) matched the frame by eye: no false accepted readings.** Single ghosted frames
  that pass at frame level (e.g. −17.0 between −18.0 and −16.5) never survive consensus.
- Replaying the whole video through the state machine (`tests/weighing-machine.test.js`, last
  test) gives: tare −32.0, filling detected once, milestones 20 and 22 announced once each, and
  the target (set to 24 kg for this clip) reached exactly once.

These numbers come from **one handheld video**. Re-check them from the real mount position and
lighting (setup shows a live *valid rate*), then do supervised fills with known weights before
relying on the app.

## Layout

```text
index.html, styles/app.css, manifest.webmanifest, service-worker.js, icons/
src/
  app.js               wiring and UI rendering
  camera.js            getUserMedia, camera choice, zoom, frame counting, error messages
  frame-processing.js  ROI crop and scale to 60 px high, frame fingerprint
  weight-reader.js     recogniser (pure, runs in Node too)
  digit-templates.js   generated digit templates
  reading-filter.js    N-frame consensus, staleness and uncertainty
  stability-detector.js  windowed stability, median tare
  weighing-machine.js  pure state machine: tare, net, fill, milestones, target, over
  audio-feedback.js    Web Audio tones and speech
  settings.js          localStorage settings
tests/                 node:test suites
test-assets/           verified frames (frames.rgb/.json), per-frame readings, demo.mp4
tools/                 dev server, video analysis, template builder, icon script (Python via uv)
```

Regenerate the icons with: `uv venv .venv && uv pip install --python .venv pillow && uv run --python .venv python tools/make_icons.py`.

## Pixel 9 notes

- The Pixel 9 exposes several rear cameras. `facingMode: environment` normally picks the main
  one. If the phone has to sit close to the display and the image is soft, pick another camera in
  setup, or mount the phone further back and use the **Zoom** slider (shown when Chrome supports it).
- Keep the phone on a charger during long sessions. Camera plus screen on will warm it up.
  Thermal behaviour over a full shift hasn't been tested.
- Monitoring needs the app open in the foreground with the screen on. Screen Wake Lock is
  requested automatically. If that fails a message says so, and you should set a long screen timeout.

## Not done yet / still to check on site

- Recognition from the real mount position, angle and lighting (glare on the window).
- Direction confirmed with a real fill (the video suggests `increase`).
- Speaker loudness in the working environment.
- Reading the `STABLE` indicator isn't implemented. Stability comes from the readings alone.
- Automatic tare capture isn't implemented. Tare is manual by design for this prototype.
