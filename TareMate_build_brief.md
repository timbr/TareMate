# TareMate

## Build brief for an LLM coding assistant

**Project name:** TareMate\
**Tagline:** A camera-based weighing assistant for filling sacks to a
target weight.\
**Target device:** Google Pixel 6 running Chrome / Android\
**Initial target:** 25.0 kg net material weight\
**Deployment:** Local-first Progressive Web App (PWA)

------------------------------------------------------------------------

## 1. Your role and overall objective

Build a small, dependable web application called **TareMate**. It uses
the Pixel 6 camera to watch the LCD display of an existing industrial
weighing scale, reads the displayed gross weight, captures the weight of
an empty valve sack as the tare, calculates the net material added, and
gives the operator visual and audible feedback as the net weight
approaches a target (initially 25.0 kg).

The application must run in the phone's browser. Do not start by
building a native Android app. The intended implementation is a PWA
using HTML, CSS and JavaScript, with all image processing and weighing
logic running locally on the phone. No server, account, cloud service or
internet connection should be needed during normal operation after the
app has loaded.

Build incrementally. The first milestone is a reliable live camera
preview and numerical reading. Do not build the full weighing workflow
before proving that the display can be read consistently from the actual
phone mount and lighting conditions.

The application is an operational aid, **not a replacement for a
verified/certified weighing instrument**. It must not claim that a
weight is legally certified or suitable for trade. The operator must
continue to use and observe the scale itself. Recognition failures,
stale frames and uncertain readings must be shown as uncertain rather
than silently treated as valid weights.

## 2. Physical setup and known scale details

The scale indicator is an **Auto Scale PRO-WEIGH 2000**.

The display has: - A large, prominent numerical weight reading,
including a decimal point. - A `GROSS kg` label. - Smaller status text
such as `STABLE` and `UNDER WEIGHT`. - A blue/yellow-green LCD
appearance with blue characters. - Function labels along the bottom
which are not relevant to the weight calculation.

The attached photographs in the original conversation show: - A close,
forward-facing view of the display. - A wider, oblique view of the
complete indicator and its controls.

Use these photographs as initial visual references, but do not assume
the camera will see exactly the same crop or angle once the phone mount
is made.

The intended arrangement is a 3D-printed mount holding an old Pixel 6 so
its camera looks at the scale display from the side. The mount should be
rigid, but the first prototype should allow adjustment of camera
position, angle and distance. Avoid obstructing the scale controls.
Reflections and glare on the display cover may affect recognition.

The Pixel 6 camera should be selected using the browser's camera API.
Prefer the rear/environment-facing camera. The application should allow
the operator to select another available camera if necessary.

### Important behaviour of the existing scale

The scale cannot currently be zeroed because its buttons are broken.
When unloaded, it has been observed displaying approximately **-32.0 kg
or -32.5 kg**. It drifts over days.

When an empty valve sack is attached to the hopper, there is some
disturbance; after settling, the display has been observed at **-32.0
kg**.

Therefore: - Do not assume the scale starts at zero. - Do not assume the
displayed gross reading is positive. - Do not hardcode the observed
unloaded value. - Capture a fresh tare for every sack, after the empty
sack has been attached and the display has settled. - Calculate net
weight from the difference between the current scale reading and the
captured tare. - Determine experimentally whether adding material makes
the displayed reading increase or decrease. Support either direction in
the logic. - The tare must remain fixed throughout one filling
operation. Do not continuously redefine it when readings become stable.

For example, if the empty sack settles at -32.0 kg and adding material
makes the display increase: - Tare: -32.0 kg - Current display: -22.0
kg - Net added: 10.0 kg - Current display: -7.0 kg - Net added: 25.0 kg

If adding material makes the displayed value decrease instead, the
application must calculate the magnitude of the change in the opposite
direction. Confirm the sign with a real test before selecting the
configured direction.

## 3. Normal operating procedure (workflow A)

The normal operation is:

1.  The scale/hopper is unloaded.
2.  The operator attaches an empty valve sack.
3.  The sack and scale reading are allowed to settle.
4.  TareMate captures the stable displayed reading as the tare.
5.  The operator starts filling the sack.
6.  TareMate detects that the reading has moved away from the tare and
    calculates net material weight.
7.  TareMate provides audio and visual guidance as the weight approaches
    25.0 kg.
8.  At the target, TareMate gives a distinctive target alert.
9.  The operator removes the filled sack. The operator explicitly starts
    or confirms the next cycle; do not silently carry the old tare into
    the next sack.

A prominent **Start / Capture tare** action should initiate a new cycle.
A manual **Reset / New sack** action should always be available.

For the first prototype, it is acceptable for the operator to press a
button to capture the tare once the display is stable. Automatic tare
capture can be added later. If automatic tare capture is implemented, it
must be clear to the operator when tare has been captured, and it must
not capture a tare after filling has begun.

## 4. Functional requirements

### 4.1 Camera and display setup

-   Request camera access only after a clear user action.
-   Prefer the rear camera (`facingMode: environment`), but handle
    devices where that constraint is unavailable.
-   Show a live preview.
-   Allow the user to pause/resume the preview.
-   Provide a setup/calibration view where the user can define or adjust
    a crop rectangle around the large numerical reading.
-   Persist the crop and camera preferences locally on the device.
-   Show the cropped region alongside the full preview during
    calibration.
-   Make it possible to re-calibrate without reinstalling the app.
-   Do not upload camera frames anywhere.

Use `getUserMedia()` and a `<video>` element. Use a canvas to extract
frames and crop the region of interest. Handle camera permission denial,
missing cameras, camera startup failures and loss of the camera stream
with helpful messages.

Camera access in browsers requires a secure context: HTTPS in
deployment, or localhost during development.

### 4.2 Reading the display

The only essential OCR output is the large numerical gross weight,
including: - Optional minus sign. - One or more digits. - Decimal
point. - Decimal digit(s), as appropriate.

The scale appears to display values to 0.1 kg, but verify this from
actual footage and do not assume more precision than the display
provides.

Do not mistake smaller text, button labels, the `GROSS kg` label,
reflections, dirt or scratches for the weight. The recognition system
should reject malformed or implausible strings rather than guessing.

Investigate recognition methods in this order:

1.  **Quick baseline:** Try browser-compatible OCR such as Tesseract.js
    on the cropped region. Evaluate it on the actual video, not just
    still photographs.
2.  **Alternative baseline:** Investigate a browser-compatible
    computer-vision approach using OpenCV.js and fixed-position digit
    recognition.
3.  **Specialised recogniser if needed:** Because the display uses a
    fixed font, fixed layout and a small known character set, a
    template-based or segmented-character recogniser may outperform
    general OCR. This can be explored if OCR is unreliable.

Do not assume that Google ML Kit's Android SDK can simply be used from a
normal web page; it is primarily a native SDK. If considering it,
explain the implications of switching to a native app or adding a native
wrapper. Keep the initial implementation browser-only.

The reader should return a structured result, not just a number. For
example:

``` js
{
  value: -32.0,
  text: "-32.0",
  confidence: 0.94,
  timestamp: 1730000000000,
  valid: true
}
```

The exact confidence scale depends on the chosen recogniser. Do not
pretend an OCR confidence score is a calibrated probability.

Important recognition rules: - Process frames at a modest rate initially
(for example, 3--5 frames per second); do not needlessly OCR every
camera frame. - Reject readings that fail parsing or have unexpected
characters. - Require agreement between several consecutive valid
readings before accepting a new value. - Detect stale frames or a frozen
camera stream. - Distinguish "no reliable reading" from a genuine
zero. - Display the raw recognised text and a confidence/status
indicator in a diagnostic mode. - Keep the image crop and OCR pipeline
separate from the weighing logic so the recogniser can be replaced
without rewriting the application.

### 4.3 Stable reading and tare capture

A reading is stable when a sufficient number of recent valid readings
remain within a configurable tolerance for a configurable duration.

Suggested initial values (to be tuned from the video and real scale
behaviour): - Sampling: 3--5 readings per second. - Stability window:
2--3 seconds. - Stability tolerance: approximately 0.1--0.2 kg. -
Require several consecutive valid OCR results.

Do not treat a single repeated OCR result as proof of stability if the
camera has frozen. Confirm that frames are fresh.

When the operator captures tare: - Require a stable reading. - Use the
median of the readings in the stability window (more resistant to
occasional OCR errors than a simple average). - Store the tare as the
reference for this filling cycle. - Show the captured tare
prominently. - Give an audible/visual confirmation. - Lock the tare
until the operator starts a new cycle or explicitly resets it.

If the reading is not stable, explain why tare capture is unavailable.
Allow the operator to wait and try again.

### 4.4 Net weight calculation

Use a configurable sign/direction setting. During commissioning,
determine whether the display increases or decreases as material is
added.

Conceptually:

``` js
// If the display increases as load increases:
netWeight = currentGross - tareGross;

// If the display decreases as load increases:
netWeight = tareGross - currentGross;
```

The result should be non-negative during normal filling. Small
fluctuations around zero may be clamped to zero using a configurable
noise tolerance. Do not conceal large or unexpected negative values;
show an error or direction/configuration warning.

Use the displayed scale precision. Do not imply that the app can measure
more accurately than the scale display.

### 4.5 Filling state and target

Implement a clear state machine, for example:

-   `NO_CAMERA` -- camera not available or not started.
-   `CALIBRATING` -- camera running, crop/OCR setup in progress.
-   `WAITING_FOR_TARE` -- waiting for stable empty-sack reading.
-   `TARE_CAPTURED` -- tare captured; waiting for filling to begin.
-   `FILLING` -- net weight is changing and is being monitored.
-   `TARGET_REACHED` -- target threshold reached.
-   `READING_UNCERTAIN` -- recent reading is unavailable or unreliable.
-   `PAUSED` -- operator has paused monitoring.

The exact internal states may differ, but the transitions must be
explicit and testable.

Filling should be detected when the stable tare reading moves
consistently in the configured loading direction by more than a small
threshold. Do not enter filling because of a single OCR misread.

Target weight: - Default: 25.0 kg. - Configurable in the interface. -
Persist the selected target locally. - Provide a clear way to restore
the default. - Keep target comparison separate from audio notification
logic.

Show: - Current recognised gross reading. - Captured tare. - Calculated
net weight. - Target weight. - Remaining weight. - Progress towards
target. - Current state and reading confidence/validity.

When the target is reached, avoid repeatedly triggering the target alarm
on every subsequent frame. Trigger once per cycle, with a clear visual
state. Provide a different warning if the weight goes beyond the target.

### 4.6 Audio feedback

Audio must be useful in a noisy industrial environment and should not
require the operator to look at the phone constantly.

Use the Web Audio API for tones and the browser Speech Synthesis API for
spoken announcements. Initialise audio after a user gesture such as
pressing Start, because browsers restrict autoplay.

Suggested initial behaviour (make thresholds configurable): - Below 20
kg: no frequent interruptions; optionally announce selected
milestones. - At 20 kg: spoken announcement, "20 kilograms". - At 22 kg:
spoken announcement, "22 kilograms". - At 23 kg: begin intermittent
warning beeps. - At 24 kg: faster beeps. - At 24.5 kg: rapid beeps. - At
25 kg: distinctive target alarm and/or spoken "Target reached". - Above
25 kg: distinct over-target warning.

These are starting ideas, not fixed requirements. Avoid excessive speech
or overlapping audio. Announce each milestone only once per filling
cycle. Add a mute/volume control and a **Test sound** button. If speech
synthesis is unavailable, tones must still work.

The operator should be able to hear the feedback over the normal working
environment. Test the actual Pixel 6 speaker and consider Bluetooth or a
wired audio output only if the built-in speaker is insufficient.

### 4.7 User interface

Design for a phone mounted near industrial equipment: - Large
high-contrast text. - Large touch targets. - Minimal controls on the
main filling screen. - No reliance on tiny text, colour alone, or
precise tapping. - Clear indication of whether the system is monitoring,
paused, uncertain or at target. - Keep the screen awake while an active
weighing cycle is running, using the Screen Wake Lock API where
supported. - Do not assume wake lock is available; handle failure
gracefully. - Provide a clear manual pause and reset/new-sack action. -
Avoid unnecessary animations.

A suggested main screen:

``` text
TAREMATE

          18.4 kg
       NET MATERIAL

    [progress towards 25.0 kg]

    6.6 kg remaining

Gross:       -13.6 kg
Tare:        -32.0 kg

STATE: FILLING

[ PAUSE ]       [ NEW SACK ]
```

Include a separate setup/diagnostics screen for camera selection, crop
calibration, OCR results, stability parameters, direction, target and
sound testing.

### 4.8 PWA and local operation

-   Add a web app manifest and service worker so the app can be
    installed on the Pixel 6 home screen.
-   Cache the application shell and required JavaScript/WASM/assets for
    offline use after the first successful load.
-   Do not cache or store camera images unless the operator explicitly
    exports diagnostic material.
-   Store configuration locally (for example, localStorage or
    IndexedDB).
-   Do not transmit data or images to a server.
-   Make it clear that the app needs to be opened and kept active during
    filling; do not promise reliable monitoring with the screen locked
    or browser in the background.

## 5. Suggested technical architecture

Keep the project small and understandable. Avoid a large framework
unless there is a concrete benefit.

A reasonable initial structure:

``` text
tare-mate/
  index.html
  manifest.webmanifest
  service-worker.js
  styles/
    app.css
  src/
    app.js
    camera.js
    crop-calibration.js
    frame-processing.js
    weight-reader.js
    stability-detector.js
    weighing-machine.js
    audio-feedback.js
    settings.js
    ui.js
  tests/
    weight-reader.test.js
    stability-detector.test.js
    weighing-machine.test.js
  test-assets/
    README.md
    scale-video.mp4
```

This is a suggested structure, not a requirement to create empty
abstractions prematurely. Keep modules cohesive and introduce them as
needed.

Responsibilities: - `camera.js`: camera selection, stream lifecycle and
fresh frame capture. - `crop-calibration.js`: crop selection and mapping
from preview coordinates to source-frame coordinates. -
`frame-processing.js`: crop, contrast/threshold experiments and image
preparation. - `weight-reader.js`: OCR or digit recognition; parse and
validate the reading. - `stability-detector.js`: determine whether a
sequence of readings is stable. - `weighing-machine.js`: pure state
machine and tare/net/target calculations. - `audio-feedback.js`:
milestone announcements, beeps, mute and sound test. - `settings.js`:
local configuration and defaults. - `ui.js` / `app.js`: connect modules
and render the interface.

Keep the core weighing state machine independent of camera APIs and the
DOM. It should be testable with ordinary sequences of numeric readings.

## 6. Development plan and acceptance criteria

### Milestone 1 --- Inspect the real video and prove recognition

The user has recorded a video of the scale. Ask for or locate that video
in the project test assets before tuning recognition. If the video is
not available to you, ask the user to provide it; do not pretend to have
inspected it.

Inspect representative frames: - Different displayed weights. - Stable
and changing readings. - Any negative values and decimal points. - The
display while the digits are transitioning. - Reflections, glare, dirt
and scratches. - The actual intended side viewing angle, if represented.

Create a repeatable test set of still frames with known expected
readings. Record where recognition succeeds and fails. Do not tune
against only one still image.

**Acceptance:** On a representative set of frames, the prototype reads
the large display consistently and rejects uncertain/transitioning
frames rather than returning plausible but incorrect weights.

### Milestone 2 --- Browser camera and calibration

Build a minimal page with a live Pixel 6 camera preview, rear-camera
selection, crop adjustment and a cropped preview. Add a diagnostic view
showing OCR output and validity.

**Acceptance:** The phone can be mounted in its intended position, the
crop can be calibrated, and the display is readable without manually
moving the phone.

### Milestone 3 --- Stable readings and tare

Implement the stability detector and manual tare capture. Use a
simulated sequence first, then real camera readings.

**Acceptance:** The operator can attach an empty sack, wait for the
display to settle, capture tare and see the tare value locked for the
cycle. Temporary disturbances and occasional bad OCR frames must not
change the tare.

### Milestone 4 --- Net weight and target

Implement loading-direction configuration, net calculation, target
progress and reset/new-sack workflow.

**Acceptance:** With a known tare and a test sequence, net weight is
correct to the scale's displayed resolution whether the scale reading
rises or falls with added load.

### Milestone 5 --- Audio

Add milestone announcements, approach beeps, target alert, over-target
alert, mute and test sound.

**Acceptance:** Each event is triggered once at the intended threshold,
without repeated announcements or overlapping sounds. Audio starts
reliably after the operator presses Start.

### Milestone 6 --- PWA installation and operational trial

Add offline caching, installation support, wake lock and robust error
handling. Test on the actual Pixel 6 in the real working environment.

**Acceptance:** After initial installation/loading, the app works
without an internet connection, remains active with the screen on, and
clearly reports camera/OCR failures. Complete supervised trial runs with
known weights before relying on it operationally.

## 7. Test cases the LLM must implement

At minimum, write automated tests for the pure weighing logic:

1.  Tare `-32.0`, current `-32.0` → net `0.0`.
2.  Tare `-32.0`, current `-22.0`, direction increasing → net `10.0`.
3.  Tare `-32.0`, current `-7.0`, direction increasing → net `25.0`.
4.  Tare `-32.0`, current `-42.0`, direction decreasing → net `10.0`.
5.  A small fluctuation around tare does not falsely start filling.
6.  One isolated OCR outlier does not trigger filling or target reached.
7.  An invalid or stale reading changes the state to uncertain; it is
    not treated as zero.
8.  The tare does not change during filling.
9.  Target reached is triggered once, not on every subsequent reading.
10. Reset clears the old tare and milestone flags.
11. A new cycle can capture a different tare, including one affected by
    long-term scale drift.
12. Over-target warning is distinct from the target event.

Also test stability detection with noisy sequences, not just identical
repeated values.

## 8. Reliability, safety and operational safeguards

This app is an advisory aid. The existing scale remains the source
instrument and must remain visible to the operator.

-   Never silently substitute a guessed reading when OCR fails.
-   If the reading becomes uncertain near the target, stop issuing
    reassuring progress indications and give a clear "CHECK SCALE"
    warning.
-   If the camera freezes, the stream stops, or frames become stale,
    indicate that monitoring is not active.
-   Do not announce "25 kg" solely because an OCR result briefly jumps
    to the target.
-   Require a valid, directionally consistent sequence before confirming
    target reached.
-   Make the target, tare and current gross reading visible so the
    operator can sanity-check the calculation.
-   Validate with known test weights and supervised fills. Do not assume
    OCR accuracy equals weighing accuracy.
-   Do not use this app as the sole control preventing an overfill. The
    operator must retain control of the filling process.

## 9. Decisions to make deliberately (do not guess)

Before finalising the implementation, establish these from the supplied
video and a real test: - Exact screen crop and camera orientation. -
Whether the display reading increases or decreases as material is
added. - Whether the display always shows one decimal place. - How often
the displayed number updates. - How much the reading fluctuates when the
sack is attached and during filling. - Whether the `STABLE` indicator
can be reliably recognised. It may be useful as an additional stability
signal, but do not make the whole system depend on reading it. - Whether
the Pixel 6 can keep the camera and audio active for the duration of a
typical filling session without overheating or browser suspension.

Use sensible defaults, but expose important calibration values in
diagnostics rather than burying them in code.

## 10. Instructions for the coding LLM

Work in small, reviewable steps. Start by inspecting the repository and
the supplied video. Then propose the smallest useful first milestone and
implement it.

Do not: - Build a native Android application unless the browser approach
has been shown to be inadequate. - Add a backend, login, database or
cloud OCR without a demonstrated need. - Introduce a large frontend
framework for this small application without explaining the benefit. -
Assume the scale is zeroed or that its reading is positive. - Change the
tare automatically during a filling cycle. - Treat an OCR confidence
score as proof that a reading is correct. - Hide uncertainty from the
operator. - Claim that the application is a certified weighing
instrument.

Prefer: - Plain JavaScript and browser APIs. - A modular but lightweight
codebase. - Pure functions for calculations and state transitions. -
Tests for the weighing logic before connecting it to live camera
input. - Diagnostic tools that make it easy to see the camera crop, OCR
text, accepted readings and stability window. - Clear explanations of
assumptions and measured behaviour.

**First task:** inspect the supplied scale video (if available), extract
representative frames, and report which recognition approach looks most
promising. Then build only the live camera/crop/reading diagnostic
prototype. Do not proceed to the full weighing workflow until the
display-reading experiment has passed.
