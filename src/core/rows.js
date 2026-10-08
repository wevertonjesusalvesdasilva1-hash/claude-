// Turns the model's JSON into reviewable rows: reconciles two independent readings,
// normalises every field and records why a cell deserves a second look (flags).
import { normTime, normChapa, normTurno, normDate, normPeca, normModelo } from './parse.js';
import { getLists, lookupAlias, aliasKey } from './lists.js';
import { MOTIVOS } from '../data/vocab.js';

export const PROD_FIELDS = ['data', 'peca', 'modelo', 'chapa1', 'ini1', 'fim1', 'chapa2', 'ini2', 'fim2', 'chapa3', 'ini3', 'fim3', 'turno_finalizou', 'obs'];
export const STOP_FIELDS = ['data', 'chapa', 'ini', 'fim', 'turno', 'motivo', 'descricao'];

export function normMotivo(text) {
  if (!text) return { value: '', flag: 'sem motivo' };
  const t = aliasKey(text);
  for (const m of MOTIVOS) if (aliasKey(m) === t) return { value: m, flag: null };
  const alias = { CONSUMIVEIS: ['TROCADECONSUMIVEIS', 'CONSUMIVEL', 'TROCADECONSUMIVEL'], 'AGUARD. PEÇA': ['AGUARDANDOPECA', 'AGUARDPECA'], 'SET-UP': ['SETUP'], 'TROCA DE PEÇA': ['TROCA', 'TROCAPECA', 'TROCADEPECA'] };
  for (const [m, list] of Object.entries(alias)) if (list.includes(t)) return { value: m, flag: null };
  return { value: String(text).trim().toUpperCase(), flag: 'motivo desconhecido' };
}

// ------------------------------------------------------------------ two readings → one

const kindOf = (f) => (/^chapa/.test(f) ? 'chapa' : /^(ini|fim)/.test(f) ? 'time' : f === 'data' ? 'data' : /^turno/.test(f) ? 'turno' : 'text');

function canon(field, v) {
  if (v == null || v === '') return '';
  const kind = kindOf(field);
  if (kind === 'time') return normTime(String(v)).value || aliasKey(v);
  if (kind === 'chapa') return String(v).replace(/\D/g, '');
  if (kind === 'data') return normDate(String(v), 2000).value || aliasKey(v);
  if (kind === 'turno') return (String(v).match(/[1-3]/) ?? [''])[0];
  return aliasKey(v);
}

function mergeRows(a, b, fields) {
  const out = { ...a, alt: {}, duvidas: [...(a.duvidas ?? [])] };
  const known = getLists().chapas;
  for (const f of fields) {
    const va = a[f] ?? null, vb = b[f] ?? null;
    if (canon(f, va) === canon(f, vb)) continue;
    out.alt[f] = vb;
    // for chapas the list decides when only one reading is a known chapa
    if (kindOf(f) === 'chapa') {
      const ina = known.includes(canon(f, va)), inb = known.includes(canon(f, vb));
      if (!ina && inb) { out[f] = vb; out.alt[f] = va; }
    } else if ((va == null || va === '') && vb) {
      out[f] = vb; out.alt[f] = va;
    }
  }
  return out;
}

// Rows are paired by their printed line number ("linha"). A row seen by only one reading is kept and marked.
export function reconcile(A, B) {
  const merge = (ra = [], rb = [], fields) => {
    const map = new Map(rb.map((r) => [r.linha, r]));
    const out = ra.map((r) => {
      const other = map.get(r.linha);
      map.delete(r.linha);
      return other ? mergeRows(r, other, fields) : { ...r, soUma: true, alt: {} };
    });
    for (const r of map.values()) out.push({ ...r, soUma: true, alt: {} });
    return out.sort((x, y) => x.linha - y.linha);
  };
  return {
    maquina: A.maquina || B.maquina,
    maquinaB: B.maquina,
    data: A.data || B.data,
    producao: merge(A.producao, B.producao, PROD_FIELDS),
    paradas: merge(A.paradas, B.paradas, STOP_FIELDS),
  };
}

// ------------------------------------------------------------------ normalise

const norm = (fn, v, ...rest) => (v == null || v === '' ? { value: '', flag: null } : fn(String(v), ...rest));

function put(row, key, res, { doubt, alt }) {
  row[key] = res.value;
  const parts = [];
  if (res.flag) parts.push(res.flag);
  if (alt != null && alt !== '') parts.push(`2ª leitura: "${alt}"`);
  else if (alt === '' || alt === null) { /* other reading was empty: ignore */ }
  if (!parts.length && doubt) parts.push('IA em dúvida');
  if (parts.length) row.flags[key] = parts.join(' · ');
}

// learned corrections replace what the model read before the checks run
function learned(kind, raw, row, key) {
  const hit = raw ? lookupAlias(kind, raw) : null;
  if (hit) { row.learned[key] = String(raw); return hit; }
  return raw;
}

export function buildPage(json, { year, meta = {} }) {
  const prod = [];
  for (const r of json.producao ?? []) {
    const d = new Set(r.duvidas ?? []);
    const row = { linha: r.linha, flags: {}, raw: {}, learned: {} };
    const alt = r.alt ?? {};
    const f = (k) => ({ doubt: d.has(k) || (k === 'turno_finalizou' && d.has('turno')), alt: alt[k] });
    put(row, 'data', norm(normDate, r.data, year), f('data'));
    row.raw.peca = r.peca; put(row, 'peca', norm(normPeca, learned('peca', r.peca, row, 'peca')), f('peca'));
    row.raw.modelo = r.modelo; put(row, 'modelo', norm(normModelo, learned('modelo', r.modelo, row, 'modelo')), f('modelo'));
    for (const n of [1, 2, 3]) {
      row.raw[`chapa${n}`] = r[`chapa${n}`];
      put(row, `chapa${n}`, norm(normChapa, learned('chapa', r[`chapa${n}`], row, `chapa${n}`)), f(`chapa${n}`));
      put(row, `ini${n}`, norm(normTime, r[`ini${n}`]), f(`ini${n}`));
      put(row, `fim${n}`, norm(normTime, r[`fim${n}`]), f(`fim${n}`));
      if ((row[`ini${n}`] && !row[`fim${n}`]) || (!row[`ini${n}`] && row[`fim${n}`])) row.flags[`${row[`ini${n}`] ? 'fim' : 'ini'}${n}`] ??= 'falta o outro horário';
    }
    put(row, 'turno', norm(normTurno, r.turno_finalizou), f('turno_finalizou'));
    row.obs = r.obs ?? '';
    if (r.soUma) row.rowFlag = 'só uma das duas leituras viu esta linha';
    if (![row.ini1, row.ini2, row.ini3, row.chapa1, row.chapa2, row.chapa3].some(Boolean)) continue;
    prod.push(row);
  }
  const stops = [];
  for (const r of json.paradas ?? []) {
    const d = new Set(r.duvidas ?? []);
    const row = { linha: r.linha, flags: {}, raw: {}, learned: {} };
    const alt = r.alt ?? {};
    const f = (k) => ({ doubt: d.has(k), alt: alt[k] });
    put(row, 'data', norm(normDate, r.data, year), f('data'));
    row.raw.chapa = r.chapa; put(row, 'chapa', norm(normChapa, learned('chapa', r.chapa, row, 'chapa')), f('chapa'));
    put(row, 'ini', norm(normTime, r.ini), f('ini'));
    put(row, 'fim', norm(normTime, r.fim), f('fim'));
    put(row, 'turno', norm(normTurno, r.turno), f('turno'));
    put(row, 'motivo', normMotivo(r.motivo), f('motivo'));
    row.desc = r.descricao ?? '';
    if (r.soUma) row.rowFlag = 'só uma das duas leituras viu esta linha';
    if (!row.ini && !row.fim && !row.chapa) continue;
    stops.push(row);
  }
  const headerDate = norm(normDate, json.data, year).value;
  for (const row of [...prod, ...stops]) {
    if (!row.data && headerDate) { row.data = headerDate; row.flags.data = 'data do cabeçalho'; }
  }
  // the filled bubble is measured from the pixels, so it wins over the model's reading
  const aiMachine = /^RAW\d\d$/.test(json.maquina ?? '') ? json.maquina : '';
  const machine = meta.machineFromBubble || aiMachine;
  const machineFlag = meta.machineFromBubble && aiMachine && meta.machineFromBubble !== aiMachine ? `IA leu ${aiMachine}` : (machine ? null : 'máquina não identificada');
  const page = { machine, machineFlag, date: headerDate, prod, stops };
  runChecks(page);
  return page;
}

// The X is detected from the pixels (which column of the printed grid holds ink), which is
// more reliable than the model's reading: the model tends to slip one column sideways.
// inkIdx[linha-1] = index in MOTIVOS, -1 when no X was found, -2 when several columns have ink.
export function applyInkMotivo(page, inkIdx) {
  for (const r of page.stops) {
    const idx = inkIdx?.[r.linha - 1];
    if (idx == null || idx === -1) continue;
    if (idx === -2) { r.flags.motivo = r.flags.motivo ? `${r.flags.motivo} · mais de um X na linha` : 'mais de um X na linha'; continue; }
    const fromInk = MOTIVOS[idx];
    if (r.motivo !== fromInk) {
      r.flags.motivo = r.motivo ? `X está na coluna ${fromInk}; a IA leu ${r.motivo}` : `X está na coluna ${fromInk}`;
      r.motivo = fromInk;
    } else if (r.flags.motivo && /sem motivo|IA em dúvida/.test(r.flags.motivo)) {
      delete r.flags.motivo;
    }
  }
}

// ------------------------------------------------------------------ sanity checks

const toMin = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t ?? ''); return m ? +m[1] * 60 + +m[2] : null; };
export function durationMin(ini, fim) {
  const a = toMin(ini), b = toMin(fim);
  if (a == null || b == null) return null;
  return (b - a + 1440) % 1440;
}
const dayNumber = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s ?? ''); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) / 864e5 : null; };

export function runChecks(page) {
  const sheetDay = dayNumber(page.date);
  const flag = (row, key, msg) => { row.flags[key] = row.flags[key] ? `${row.flags[key]} · ${msg}` : msg; };
  const checkDate = (row) => {
    const d = dayNumber(row.data);
    if (sheetDay != null && d != null && Math.abs(d - sheetDay) > 1) flag(row, 'data', `diferente da data da folha (${page.date.slice(0, 5)})`);
  };
  for (const r of page.prod) {
    checkDate(r);
    if (r.turno === '3') flag(r, 'turno', 'turno 3 é raro, confira');
    for (const n of [1, 2, 3]) {
      const dur = durationMin(r[`ini${n}`], r[`fim${n}`]);
      if (dur === 0) flag(r, `fim${n}`, 'início e fim iguais');
      else if (dur != null && dur > 12 * 60) flag(r, `fim${n}`, `duração de ${Math.round(dur / 60)}h, confira`);
    }
  }
  for (const r of page.stops) {
    checkDate(r);
    if (r.turno === '3') flag(r, 'turno', 'turno 3 é raro, confira');
    const dur = durationMin(r.ini, r.fim);
    if (dur === 0) flag(r, 'fim', 'início e fim iguais');
    else if (dur != null && dur > 8 * 60) flag(r, 'fim', `parada de ${Math.round(dur / 60)}h, confira`);
  }
}
