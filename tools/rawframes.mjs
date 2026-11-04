// Helpers to read raw rgb24 frame dumps produced by ffmpeg and to write PGM/PPM images.
import fs from 'node:fs';
export function* rawFrames(file, w, h) {
  const buf = fs.readFileSync(file);
  const fsz = w * h * 3;
  for (let k = 0; k * fsz < buf.length; k++) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = buf[k * fsz + i * 3];
      data[i * 4 + 1] = buf[k * fsz + i * 3 + 1];
      data[i * 4 + 2] = buf[k * fsz + i * 3 + 2];
      data[i * 4 + 3] = 255;
    }
    yield { index: k, img: { width: w, height: h, data } };
  }
}
export function writePGM(file, w, h, gray) {
  const head = Buffer.from(`P5\n${w} ${h}\n255\n`);
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from(gray)]));
}
