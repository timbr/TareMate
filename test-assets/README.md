# Test assets

- `frames.rgb` / `frames.json`: 32 display crops (210x60 RGB24) from `PXL_20261104_121605137.mp4`
  at 5 fps (crop 420x120 at 100,698 of the 1920x1080 frame, scaled by 0.5). Each frame's expected
  reading was checked by eye.
- `video-readings.json`: the reader's output for all 1037 frames, replayed by the state-machine test.
- `demo.mp4` (not in the repo; regenerate locally): 960x540 clip (from 20 s to 180 s of the original) for `?demo=test-assets/demo.mp4`.
  In that clip the crop box is about x 0.052, y 0.646, w 0.219, h 0.111.

To regenerate from a new video (see `tools/`): extract raw ROI frames with ffmpeg
(`-vf "fps=5,crop=...,scale=210:60" -f rawvideo -pix_fmt rgb24`), then run `tools/eval-video.mjs`,
`tools/collect-glyphs.mjs` and `tools/build-templates.mjs`.
