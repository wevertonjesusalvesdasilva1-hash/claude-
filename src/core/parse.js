// Normalisation of raw OCR text into valid sheet values.
// Every function returns { value, flag } where flag is null (confident) or a short
// reason the user should double-check the cell.
import { getLists } from './lists.js';

const DIGIT_LOOKALIKES = {
  O: '0', o: '0', D: '0', Q: '0', U: '0',
  l: '1', I: '1', i: '1', '|': '1', L: '1', t: '1',
  Z: '2', z: '2',
  S: '5', s: '5',
  b: '6', G: '6',
  T: '7',
  B: '8',
  g: '9', q: '9', y: '9',
  A: '4', h: '4', H: '4', u: '4',
};

function lookalikeDigits(text) {
  return [...text].map((c) => (/[0-9]/.test(c) ? c : DIGIT_LOOKALIKES[c] ?? c)).join('');
}

export function normTime(text) {
  if (!text) return { value: '', flag: null };
  const raw = lookalikeDigits(String(text).trim());
  // separators the writers (and the OCR) use between hours and minutes
  const m = raw.match(/^(\d{1,2})\s*[:;.,'`´\-\s]\s*(\d{2})$/) ?? raw.match(/^(\d{1,2})(\d{2})$/);
  if (!m) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 3 || digits.length === 4) return build(digits.slice(0, -2), digits.slice(-2), 'formato');
    return { value: '', flag: 'ilegível' };
  }
  return build(m[1], m[2]);
  function build(h, mi, why) {
    const H = parseInt(h, 10), M = parseInt(mi, 10);
    if (H > 23 || M > 59) return { value: `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`, flag: 'hora inválida' };
    return { value: `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`, flag: why ? 'conferir' : null };
  }
}

// Weighted-free Levenshtein distance.
export function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Closest values from a list (by edit distance).
function nearestAll(value, list, maxDist) {
  const out = [];
  for (const k of list) {
    const d = lev(value, k);
    if (d <= maxDist) out.push({ k, d });
  }
  return out.sort((x, y) => x.d - y.d);
}

// A chapa outside the list is corrected only when exactly ONE listed chapa is a single
// digit away (7710 → 7910); the cell is flagged so the original reading stays visible.
// Anything less certain is kept as read and flagged with the closest suggestions.
export function normChapa(text, known = getLists().chapas) {
  if (!text) return { value: '', flag: null };
  const digits = lookalikeDigits(String(text)).replace(/\D/g, '');
  if (!digits) return { value: '', flag: 'ilegível' };
  if (known.includes(digits)) return { value: digits, flag: null };
  const near = nearestAll(digits, known, 2);
  const one = near.filter((n) => n.d === 1);
  if (one.length === 1 && digits.length === one[0].k.length) return { value: one[0].k, flag: `corrigida de ${digits}: ${one[0].k} está na lista`, corrected: true, original: digits };
  return { value: digits, flag: near.length ? `chapa fora da lista, parecida com ${near.slice(0, 2).map((n) => n.k).join(' ou ')}` : 'chapa desconhecida' };
}

export function normTurno(text) {
  const m = lookalikeDigits(String(text ?? '')).match(/[1-3]/);
  return m ? { value: m[0], flag: null } : { value: '', flag: 'ilegível' };
}

export function normDate(text, year) {
  if (!text) return { value: '', flag: null };
  const raw = lookalikeDigits(String(text).trim());
  const m = raw.match(/^(\d{1,2})\s*[-/.\s,]\s*(\d{1,2})(?:\s*[-/.]\s*\d{2,4})?$/) ?? raw.match(/^(\d{2})(\d{2})$/);
  if (!m) return { value: '', flag: 'ilegível' };
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return { value: '', flag: 'data inválida' };
  return { value: `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${year}`, flag: null };
}

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function checkVocab(text, vocab, zeroForO = false) {
  const clean = (v) => { const t = strip(v); return zeroForO ? t.replace(/O/g, '0') : t; };
  const t = clean(text);
  if (!t) return { value: '', flag: null };
  for (const v of vocab) if (clean(v) === t) return { value: v, flag: null };  // same words, other case/accents/spaces
  let best = null, bd = 1;
  for (const v of vocab) {
    const c = clean(v);
    const d = lev(t, c) / Math.max(t.length, c.length);
    if (d < bd) { bd = d; best = v; }
  }
  return { value: String(text).trim().toUpperCase(), flag: best && bd <= 0.5 ? `fora da lista, parecido com ${best}` : 'valor novo' };
}

export const normPeca = (t) => checkVocab(t, getLists().pecas);
export const normModelo = (t) => checkVocab(t, getLists().modelos, true);

export function normFree(text) {
  return { value: String(text ?? '').trim(), flag: text ? 'conferir' : null };
}
