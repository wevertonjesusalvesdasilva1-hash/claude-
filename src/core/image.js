// Image helpers that work on plain RGBA buffers ({ width, height, data }),
// so the same code runs in the browser (canvas ImageData) and in Node tests.

export function makeImage(width, height, data) {
  return { width, height, data: data ?? new Uint8ClampedArray(width * height * 4).fill(255) };
}

export function rotate(img, quarterTurnsClockwise) {
  const q = ((quarterTurnsClockwise % 4) + 4) % 4;
  if (q === 0) return img;
  const { width: w, height: h, data: s } = img;
  const [nw, nh] = q === 2 ? [w, h] : [h, w];
  const out = makeImage(nw, nh);
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (q === 1) { nx = h - 1 - y; ny = x; }
      else if (q === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      const si = (y * w + x) * 4;
      const di = (ny * nw + nx) * 4;
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = 255;
    }
  }
  return out;
}

// Handwriting on these sheets is blue/violet ink; the printed grid is black/grey.
export function isPen(r, g, b) {
  return b - g > 22 && b - r > -25 && b < 250;
}

export function masks(img) {
  const { width: w, height: h, data } = img;
  const dark = new Uint8Array(w * h);
  const pen = new Uint8Array(w * h);
  const bar = new Uint8Array(w * h); // very dark of any colour (black or navy title bars)
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if ((r * 0.3 + g * 0.59 + b * 0.11) < 100) bar[i] = 1;
    if (isPen(r, g, b)) pen[i] = 1;
    else if ((r + g + b) / 3 < 185) dark[i] = 1;
  }
  return { dark, pen, bar, width: w, height: h };
}

// Groups consecutive indices where v[i] > thr and returns each group's centre.
export function peaks(v, thr, gap = 2) {
  const out = [];
  let cur = null;
  for (let i = 0; i < v.length; i++) {
    if (v[i] > thr) {
      if (cur && i - cur.end <= gap) cur.end = i;
      else { cur = { start: i, end: i }; out.push(cur); }
    }
  }
  return out.map((g) => (g.start + g.end) / 2);
}

export function colSums(mask, w, h, y0, y1, x0 = 0, x1 = w) {
  const out = new Float32Array(w);
  y0 = Math.max(0, Math.round(y0)); y1 = Math.min(h, Math.round(y1));
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) out[x] += mask[row + x];
  }
  return out;
}

export function rowSums(mask, w, h, x0, x1, y0 = 0, y1 = h) {
  const out = new Float32Array(h);
  x0 = Math.max(0, Math.round(x0)); x1 = Math.min(w, Math.round(x1));
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    let s = 0;
    const row = y * w;
    for (let x = x0; x < x1; x++) s += mask[row + x];
    out[y] = s;
  }
  return out;
}

// Amount of pen ink in a rectangle (count of pen pixels).
export function inkIn(m, x0, y0, x1, y1) {
  const { pen, width: w, height: h } = m;
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
  x1 = Math.min(w, Math.round(x1)); y1 = Math.min(h, Math.round(y1));
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += pen[y * w + x];
  return n;
}

// Crops a rectangle and renders ONLY the pen strokes (dark on white), tight-cropped
// to the ink and padded. Returns null if the cell has (almost) no ink.
export function penCrop(m, x0, y0, x1, y1, { pad = 10, minInk = 25, sc = 1 } = {}) {
  const { pen, width: w, height: h } = m;
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
  x1 = Math.min(w, Math.round(x1)); y1 = Math.min(h, Math.round(y1));
  const cw0 = x1 - x0, ch0 = y1 - y0;
  if (cw0 <= 0 || ch0 <= 0) return null;
  // connected components (8-neighbourhood) so slivers of grid line can be dropped
  const label = new Int32Array(cw0 * ch0);
  const comps = [];
  const stack = [];
  for (let y = 0; y < ch0; y++) {
    for (let x = 0; x < cw0; x++) {
      if (!pen[(y + y0) * w + x + x0] || label[y * cw0 + x]) continue;
      const id = comps.length + 1;
      const c = { id, n: 0, minX: x, maxX: x, minY: y, maxY: y };
      comps.push(c);
      stack.push(x, y);
      label[y * cw0 + x] = id;
      while (stack.length) {
        const cy = stack.pop(), cx = stack.pop();
        c.n++;
        if (cx < c.minX) c.minX = cx; if (cx > c.maxX) c.maxX = cx;
        if (cy < c.minY) c.minY = cy; if (cy > c.maxY) c.maxY = cy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw0 || ny >= ch0) continue;
          if (pen[(ny + y0) * w + nx + x0] && !label[ny * cw0 + nx]) { label[ny * cw0 + nx] = id; stack.push(nx, ny); }
        }
      }
    }
  }
  const keep = new Set();
  for (const c of comps) {
    const cw = c.maxX - c.minX + 1, ch = c.maxY - c.minY + 1;
    const thinH = ch <= 4 * sc && cw >= 18 * sc && (c.minY <= 3 * sc || c.maxY >= ch0 - 3 * sc);
    const thinV = cw <= 4 * sc && ch >= 22 * sc;
    const speck = c.n < 6 * sc * sc;
    if (!thinH && !thinV && !speck) keep.add(c.id);
  }
  let minX = cw0, minY = ch0, maxX = -1, maxY = -1, n = 0;
  for (const c of comps) {
    if (!keep.has(c.id)) continue;
    n += c.n;
    if (c.minX < minX) minX = c.minX; if (c.maxX > maxX) maxX = c.maxX;
    if (c.minY < minY) minY = c.minY; if (c.maxY > maxY) maxY = c.maxY;
  }
  if (n < minInk) return null;
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = makeImage(cw + pad * 2, ch + pad * 2);
  const d = out.data;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (keep.has(label[y * cw0 + x])) {
        const di = ((y - minY + pad) * out.width + (x - minX + pad)) * 4;
        d[di] = d[di + 1] = d[di + 2] = 0;
      }
    }
  }
  out.ink = n; out.inkW = cw; out.inkH = ch;
  return out;
}

// ---- skew correction ----------------------------------------------------

// Finds the small rotation (degrees) that makes the printed grid lines horizontal.
export function estimateSkew(img, range = 3) {
  const { dark, width: w, height: h } = masks(img);
  const pts = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) if (dark[y * w + x]) pts.push(x, y);
  }
  const score = (deg) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const bins = new Int32Array(h + w + 4);
    const off = Math.ceil(w * Math.abs(s)) + 2;
    for (let i = 0; i < pts.length; i += 2) {
      const yy = Math.round(pts[i + 1] * c - pts[i] * s) + off;
      bins[yy]++;
    }
    let sc = 0;
    for (let i = 0; i < bins.length; i++) sc += bins[i] * bins[i];
    return sc;
  };
  let best = 0, bs = -1;
  for (let d = -range; d <= range + 1e-9; d += 0.1) {
    const sc = score(d);
    if (sc > bs) { bs = sc; best = d; }
  }
  for (let d = best - 0.1; d <= best + 0.1 + 1e-9; d += 0.02) {
    const sc = score(d);
    if (sc > bs) { bs = sc; best = d; }
  }
  return best;
}

export function rotateSmall(img, deg) {
  if (Math.abs(deg) < 0.03) return img;
  const { width: w, height: h, data: s } = img;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const out = makeImage(w, h);
  const d = out.data;
  for (let y2 = 0; y2 < h; y2++) {
    for (let x2 = 0; x2 < w; x2++) {
      const x = x2 * c - y2 * sn;
      const y = x2 * sn + y2 * c;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
      const o = (y2 * w + x2) * 4;
      for (let k = 0; k < 3; k++) {
        d[o + k] = s[i00 + k] * (1 - fx) * (1 - fy) + s[i10 + k] * fx * (1 - fy) + s[i01 + k] * (1 - fx) * fy + s[i11 + k] * fx * fy;
      }
    }
  }
  return out;
}
