// TareMate - crop the region of interest out of a video frame.
//
// The ROI is stored as fractions of the video frame so it survives changes of
// camera resolution. The crop is scaled to a fixed working height (the
// recogniser was tuned on ~60 px tall crops of the digits).

export const WORK_HEIGHT = 60;
export const MAX_WORK_WIDTH = 360;

export function roiToPixels(roi, vw, vh) {
  return {
    x: Math.round(roi.x * vw),
    y: Math.round(roi.y * vh),
    w: Math.max(4, Math.round(roi.w * vw)),
    h: Math.max(4, Math.round(roi.h * vh)),
  };
}

export function clampRoi(r) {
  const w = Math.min(1, Math.max(0.03, r.w));
  const h = Math.min(1, Math.max(0.03, r.h));
  return { x: Math.min(1 - w, Math.max(0, r.x)), y: Math.min(1 - h, Math.max(0, r.y)), w, h };
}

/**
 * Draw the ROI of `video` into `canvas` at working resolution and return its
 * ImageData. Returns null if the video has no frame yet.
 */
export function grabRoi(video, roi, canvas) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh || !roi) return null;
  const p = roiToPixels(roi, vw, vh);
  const scale = WORK_HEIGHT / p.h;
  const w = Math.max(8, Math.min(MAX_WORK_WIDTH, Math.round(p.w * scale)));
  if (canvas.width !== w || canvas.height !== WORK_HEIGHT) { canvas.width = w; canvas.height = WORK_HEIGHT; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, p.x, p.y, p.w, p.h, 0, 0, w, WORK_HEIGHT);
  return ctx.getImageData(0, 0, w, WORK_HEIGHT);
}

/** Draw the whole video frame scaled to maxW wide; returns ImageData or null. */
export function grabFrame(video, canvas, maxW = 640) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const w = Math.min(maxW, vw), h = Math.round(vh * w / vw);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Cheap fingerprint of an ImageData, used to spot a frozen picture. */
export function fingerprint(img) {
  let h = 0;
  const d = img.data;
  for (let i = 0; i < d.length; i += 64) h = (h * 31 + d[i] + d[i + 2]) | 0;
  return h;
}
