// Usage: node scripts/debug-grid.mjs page.png out.png
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { analyze, detectMachine } from '../src/core/layout.js';

const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const lay = analyze({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) });
const { img, prodX, prodY, stopX, stopY } = lay;
console.log('rotation', lay.rotation, 'skew', lay.skew, 'size', img.width, img.height, detectMachine(lay));
const out = new PNG({ width: img.width, height: img.height });
out.data = Buffer.from(img.data);
const put = (x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= img.width || y >= img.height) return; const i = (y * img.width + x) * 4; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; };
for (const x of prodX) for (let y = prodY[0]; y <= prodY.at(-1); y++) put(x, y);
for (const y of prodY) for (let x = prodX[0]; x <= prodX.at(-1); x++) put(x, y);
for (const x of stopX) for (let y = stopY[0]; y <= stopY.at(-1); y++) put(x, y);
for (const y of stopY) for (let x = stopX[0]; x <= stopX.at(-1); x++) put(x, y);
for (const b of lay.bubbles) for (let a = -12; a <= 12; a++) { put(b.x + a, b.y); put(b.x, b.y + a); }
const d = lay.dateBox;
for (let x = d.x0; x < d.x1; x++) { put(x, d.y0); put(x, d.y1); }
fs.writeFileSync(process.argv[3], PNG.sync.write(out));
