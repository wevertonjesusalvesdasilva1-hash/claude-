// Geometry of the "DIÁRIO DE BORDO – PRODUÇÃO E PARADAS" form.
// REF_* values were measured on an A4 landscape scan at 150 dpi.
import { rotate, rotateSmall, estimateSkew, masks, peaks, colSums, rowSums, inkIn } from './image.js';

const REF = {
  left: 7,
  right: 1702,
  // vertical grid lines of table 1 (15 columns) and table 2 (16 columns)
  prodX: [7, 92.5, 171, 290, 448, 541, 620.5, 700.5, 780, 860, 939.5, 1019, 1099, 1179, 1246.5, 1702],
  stopX: [7, 92.5, 172, 290, 369.5, 448.5, 541, 621, 701, 781, 860, 940, 1020, 1100, 1180, 1247.5, 1326, 1702],
  bar1Bottom: 182, // black "1. REGISTRO DE PRODUÇÃO" bar
  bar2Bottom: 679, // black "2. CONTROLE DE PARADAS" bar
  prodTop: 240, prodPitch: 39.5, prodRows: 10,
  stopTop: 772, stopPitch: 40.6, stopRows: 10,
  bubbles: { x: [313, 503, 690, 880, 1063, 1257], y: 103 },
  bar1Top: 152,
  dateBox: { x0: 95, x1: 440, y0: 113, y1: 150 },
};

export const PROD_COLS = ['n', 'data', 'peca', 'modelo', 'chapa1', 'ini1', 'fim1', 'chapa2', 'ini2', 'fim2', 'chapa3', 'ini3', 'fim3', 'turno', 'obs'];
export const STOP_COLS = ['n', 'data', 'chapa', 'ini', 'fim', 'turno',
  'MECÂNICA', 'ELÉTRICA', 'PREVENTIVA', 'AGUARD. PEÇA', 'PONTE ROLANTE', 'CONSUMIVEIS', 'TROCA DE PEÇA ', 'SET-UP', 'OUTROS', 'FALTA DE PEÇA', 'desc'];
export const MOTIVOS = STOP_COLS.slice(6, 16);
export const MACHINES = ['RAW05', 'RAW06', 'RAW09', 'RAW10', 'RAW11', 'RAW12'];

const THICK = 12 / 1754; // minimum bar thickness as a fraction of page width

function darkRowFractions(m) {
  const { bar: dark, width: w, height: h } = m;
  const v = rowSums(dark, w, h, 0, w);
  return v.map((x) => x / w);
}
function darkColFractions(m) {
  const { bar: dark, width: w, height: h } = m;
  const v = colSums(dark, w, h, 0, h);
  return v.map((x) => x / h);
}

function barGroups(profile, minThick) {
  const groups = [];
  let cur = null;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > 0.5) {
      if (cur && i - cur.end <= 2) cur.end = i;
      else { cur = { start: i, end: i }; groups.push(cur); }
    }
  }
  return groups.filter((g) => g.end - g.start + 1 >= minThick);
}

// Which clockwise quarter-turn makes the page upright (title bar on top)?
export function detectRotation(img) {
  const m = masks(img);
  const rows = darkRowFractions(m);
  const cols = darkColFractions(m);
  const rev = (a) => Float32Array.from(a).reverse();
  const candidates = [rows, cols, rev(rows), rev(cols)];
  let best = 0, bestScore = -1;
  candidates.forEach((p, q) => {
    const longSide = p.length;
    const bars = barGroups(p, longSide * 0.007);
    const top = bars.filter((g) => g.start < longSide * 0.2).length;
    const bottom = bars.filter((g) => g.start > longSide * 0.85).length;
    const score = bars.length >= 2 && bars.length <= 5 ? bars.length * 2 + top * 3 - bottom * 4 : -1;
    if (score > bestScore) { bestScore = score; best = q; }
  });
  return best;
}

function snap(pred, found, tol) {
  let best = null, bd = tol;
  for (const f of found) {
    const d = Math.abs(f - pred);
    if (d <= bd) { bd = d; best = f; }
  }
  return best ?? pred;
}

// Returns the upright image plus all the cell rectangles.
export function analyze(imgIn) {
  const q = detectRotation(imgIn);
  const turned = rotate(imgIn, q);
  const skew = estimateSkew(turned);
  const img = rotateSmall(turned, skew);
  const m = masks(img);
  const { width: w, height: h, dark } = m;
  const sc = w / 1754;

  const bars = barGroups(darkRowFractions(m), w * THICK).slice(0, 4);
  // title bar, bar1, bar2 – pick bars from the top of the page
  const bar1 = bars[1] ?? { start: REF.bar1Top * sc, end: REF.bar1Bottom * sc };
  const bar2 = bars[2] ?? { start: (REF.bar2Bottom - 30) * sc, end: REF.bar2Bottom * sc };

  // horizontal scale from the outer vertical lines of table 1
  const prodBandY0 = bar1.end + (REF.prodTop - REF.bar1Bottom + 6) * sc;
  const prodBandY1 = bar1.end + (REF.prodTop - REF.bar1Bottom + 6 + (REF.prodRows - 1) * REF.prodPitch) * sc;
  const vProd = peaks(colSums(dark, w, h, prodBandY0, prodBandY1), (prodBandY1 - prodBandY0) * 0.5);
  const left = snap(REF.left * sc, vProd, 25 * sc);
  const rightGuess = REF.right * sc;
  const right = snap(rightGuess, vProd, 25 * sc);
  const sx = (right - left) / (REF.right - REF.left);

  const mapX = (list, found) => list.map((x) => snap(left + (x - REF.left) * sx, found, 7 * sx));
  const stopBandY0 = bar2.end + (REF.stopTop - REF.bar2Bottom + 6) * sc;
  const stopBandY1 = bar2.end + (REF.stopTop - REF.bar2Bottom + 6 + (REF.stopRows - 1) * REF.stopPitch) * sc;
  const vStop = peaks(colSums(dark, w, h, stopBandY0, stopBandY1), (stopBandY1 - stopBandY0) * 0.5);
  const prodX = mapX(REF.prodX, vProd);
  const stopX = mapX(REF.stopX, vStop);

  // horizontal lines, measured in the wide free-text column (little handwriting there)
  const rowBounds = (topRef, pitch, nRows, anchorBottom, anchorRefBottom, xA, xB) => {
    const top = anchorBottom + (topRef - anchorRefBottom) * sc;
    const hy = peaks(rowSums(dark, w, h, left + (xA - REF.left) * sx, left + (xB - REF.left) * sx),
      (xB - xA) * sx * 0.6);
    const out = [];
    for (let i = 0; i <= nRows; i++) out.push(snap(top + i * pitch * sc, hy, 8 * sc));
    return out;
  };
  const prodY = rowBounds(REF.prodTop, REF.prodPitch, REF.prodRows, bar1.end, REF.bar1Bottom, 1260, 1690);
  const stopY = rowBounds(REF.stopTop, REF.stopPitch, REF.stopRows, bar2.end, REF.bar2Bottom, 1340, 1690);

  const bubbles = REF.bubbles.x.map((x) => ({
    x: left + (x - REF.left) * sx,
    y: bar1.start - (REF.bar1Top - REF.bubbles.y) * sc,
  }));

  const dateBox = {
    x0: left + (REF.dateBox.x0 - REF.left) * sx,
    x1: left + (REF.dateBox.x1 - REF.left) * sx,
    y0: bar1.start - (REF.bar1Top - REF.dateBox.y0) * sc,
    y1: bar1.start - (REF.bar1Top - REF.dateBox.y1) * sc,
  };

  addBlackPen(m, { prodX, prodY, stopX, stopY }, sc);

  return { img, masks: m, rotation: q, skew, scale: sc, prodX, prodY, stopX, stopY, bubbles, dateBox };
}

export function detectMachine(layout) {
  const { masks: m, bubbles, scale: sc } = layout;
  const r = 15 * sc;
  const inks = bubbles.map((b) => inkIn(m, b.x - r, b.y - r, b.x + r, b.y + r));
  const max = Math.max(...inks);
  const idx = inks.indexOf(max);
  const second = [...inks].sort((a, b) => b - a)[1];
  const found = max > 60 * sc * sc && max > second * 1.8;
  return { machine: found ? MACHINES[idx] : null, inks };
}

// Some people write in black. Inside the table bodies everything that is dark and is not a
// long straight run (grid line) is handwriting. The OBS column holds printed labels, so it
// only gets the blue-pen mask.
function addBlackPen(m, g, sc) {
  const { dark, pen, width: w, height: h } = m;
  const hMin = Math.round(40 * sc), vMin = Math.round(30 * sc);
  const apply = (xs, ys, xEnd) => {
    const x0 = Math.max(0, Math.floor(xs[0] - 4)), x1 = Math.min(w, Math.ceil(xEnd)), y0 = Math.max(0, Math.floor(ys[0] - 4)), y1 = Math.min(h, Math.ceil(ys.at(-1) + 4));
    const line = new Uint8Array(w * h);
    for (let y = y0; y < y1; y++) {
      let run = 0;
      for (let x = x0; x <= x1; x++) {
        if (x < x1 && dark[y * w + x]) run++;
        else { if (run >= hMin) for (let k = x - run; k < x; k++) line[y * w + k] = 1; run = 0; }
      }
    }
    for (let x = x0; x < x1; x++) {
      let run = 0;
      for (let y = y0; y <= y1; y++) {
        if (y < y1 && dark[y * w + x]) run++;
        else { if (run >= vMin) for (let k = y - run; k < y; k++) line[k * w + x] = 1; run = 0; }
      }
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!dark[y * w + x] || line[y * w + x]) continue;
        // skip pixels hugging a detected line (anti-aliased edges)
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && xx >= 0 && yy < h && xx < w && line[yy * w + xx]) { near = true; break; }
        }
        if (!near) pen[y * w + x] = 1;
      }
    }
  };
  apply(g.prodX, g.prodY, g.prodX[14]);
  apply(g.stopX, g.stopY, g.stopX[17]);
}
