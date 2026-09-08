// Generates the home-screen icons in `public/` from the single shape definition below.
//
// The icons are committed, so this script only needs to run when the artwork changes
// (`node scripts/generate-icons.mjs`). It exists so those PNGs are not unreproducible
// binaries: the SVG and both PNGs are rendered from the same `BAR`/`PLATES` geometry, so
// they cannot drift apart, and there is no image toolchain to install.
//
// Deliberately dependency-free — it rasterises and encodes PNG using only node stdlib.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const CANVAS = 512;
const BACKGROUND = '#241f1e';
// The gym app's own accent (see src/index.css --cp-accent), so the home-screen icon reads as
// this app and not as 12wyapp, whose icon is a green ring on near-black.
const ACCENT_FROM = '#fd8ea1';
const ACCENT_TO = '#b11f4b';

// A dumbbell, centred, built from rounded rectangles: two plates per side plus the bar.
// Everything stays inside the centred circle of 80% diameter that `maskable` icons reserve,
// so no launcher shape can clip it.
const CENTER = CANVAS / 2;
const BAR = { cx: CENTER, cy: CENTER, w: 232, h: 46, r: 23 };
const PLATES = [
  { cx: CENTER - 92, cy: CENTER, w: 48, h: 168, r: 24 },
  { cx: CENTER + 92, cy: CENTER, w: 48, h: 168, r: 24 },
  { cx: CENTER - 148, cy: CENTER, w: 36, h: 104, r: 18 },
  { cx: CENTER + 148, cy: CENTER, w: 36, h: 104, r: 18 },
];
const SHAPES = [BAR, ...PLATES];

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Signed distance to a rounded rectangle: <= 0 means the point is inside. */
const roundedRectDistance = (x, y, { cx, cy, w, h, r }) => {
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
};

const encodePng = (size, pixels) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // truecolour with alpha
  // Every scanline is prefixed with filter byte 0 (None); the artwork is flat colour over a
  // flat background, so per-line filtering would buy almost nothing.
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

/**
 * Renders at `size` with 4x4 supersampling for anti-aliasing.
 *
 * The square is filled edge to edge rather than given rounded corners: iOS masks
 * apple-touch-icon into its own squircle and Android masks a `maskable` icon into whatever
 * shape the launcher uses, so baking corners in here would show as double-rounding. The
 * rounded corners live in the SVG, which is used unmasked as the favicon.
 */
const renderPng = (size) => {
  const [bgR, bgG, bgB] = hexToRgb(BACKGROUND);
  const [fromR, fromG, fromB] = hexToRgb(ACCENT_FROM);
  const [toR, toG, toB] = hexToRgb(ACCENT_TO);
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  const scale = CANVAS / size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let coverage = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) * scale;
          const py = (y + (sy + 0.5) / samples) * scale;
          if (SHAPES.some((shape) => roundedRectDistance(px, py, shape) <= 0)) coverage += 1;
        }
      }
      coverage /= samples * samples;

      // Matches the SVG's diagonal gradient so the two renderings agree.
      const t = (x / size + y / size) / 2;
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(bgR + (fromR + (toR - fromR) * t - bgR) * coverage);
      pixels[offset + 1] = Math.round(bgG + (fromG + (toG - fromG) * t - bgG) * coverage);
      pixels[offset + 2] = Math.round(bgB + (fromB + (toB - fromB) * t - bgB) * coverage);
      pixels[offset + 3] = 255;
    }
  }
  return encodePng(size, pixels);
};

const renderSvg = () => {
  const rect = ({ cx, cy, w, h, r }) =>
    `  <rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${r}" fill="url(#g)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" role="img" aria-label="תיעוד אימונים">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ACCENT_FROM}"/>
      <stop offset="1" stop-color="${ACCENT_TO}"/>
    </linearGradient>
  </defs>
  <rect width="${CANVAS}" height="${CANVAS}" rx="112" fill="${BACKGROUND}"/>
${SHAPES.map(rect).join('\n')}
</svg>
`;
};

mkdirSync(PUBLIC_DIR, { recursive: true });
writeFileSync(join(PUBLIC_DIR, 'gym-icon.svg'), renderSvg());
for (const size of [192, 512]) {
  writeFileSync(join(PUBLIC_DIR, `gym-icon-${size}.png`), renderPng(size));
}
console.log(`wrote gym-icon.svg, gym-icon-192.png, gym-icon-512.png to ${PUBLIC_DIR}`);
