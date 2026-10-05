// Turns the model's JSON into reviewable rows: normalises every field and records why a cell
// deserves a second look (flags).
import { normTime, normChapa, normTurno, normDate, normPeca, normModelo } from './parse.js';
import { MOTIVOS } from '../data/vocab.js';

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function normMotivo(text) {
  if (!text) return { value: '', flag: 'sem motivo' };
  const t = strip(text);
  for (const m of MOTIVOS) if (strip(m) === t) return { value: m, flag: null };
  const alias = { CONSUMIVEIS: ['TROCADECONSUMIVEIS', 'CONSUMIVEL', 'TROCADECONSUMIVEL'], 'AGUARD. PEÇA': ['AGUARDANDOPECA', 'AGUARDPECA'], 'SET-UP': ['SETUP'], 'TROCA DE PEÇA': ['TROCA', 'TROCAPECA'] };
  for (const [m, list] of Object.entries(alias)) if (list.includes(t)) return { value: m, flag: null };
  return { value: String(text).trim().toUpperCase(), flag: 'motivo desconhecido' };
}

const norm = (fn, v, ...rest) => {
  const r = v == null || v === '' ? { value: '', flag: null } : fn(String(v), ...rest);
  return r;
};

function put(row, key, res, doubt) {
  row[key] = res.value;
  const flag = res.flag ?? (doubt ? 'IA em dúvida' : null);
  if (flag) row.flags[key] = res.flag && doubt ? `${res.flag} · IA em dúvida` : flag;
}

export function buildPage(json, { year, meta = {} }) {
  const prod = [];
  for (const r of json.producao ?? []) {
    const d = new Set(r.duvidas ?? []);
    const row = { linha: r.linha, flags: {} };
    put(row, 'data', norm(normDate, r.data, year), d.has('data'));
    put(row, 'peca', norm(normPeca, r.peca), d.has('peca'));
    put(row, 'modelo', norm(normModelo, r.modelo), d.has('modelo'));
    for (const n of [1, 2, 3]) {
      put(row, `chapa${n}`, norm(normChapa, r[`chapa${n}`]), d.has(`chapa${n}`));
      put(row, `ini${n}`, norm(normTime, r[`ini${n}`]), d.has(`ini${n}`));
      put(row, `fim${n}`, norm(normTime, r[`fim${n}`]), d.has(`fim${n}`));
      // a shift needs both ends
      if ((row[`ini${n}`] && !row[`fim${n}`]) || (!row[`ini${n}`] && row[`fim${n}`])) row.flags[`${row[`ini${n}`] ? 'fim' : 'ini'}${n}`] ??= 'falta o outro horário';
    }
    put(row, 'turno', norm(normTurno, r.turno_finalizou), d.has('turno_finalizou') || d.has('turno'));
    row.obs = r.obs ?? '';
    if (![row.ini1, row.ini2, row.ini3, row.chapa1, row.chapa2, row.chapa3].some(Boolean)) continue;
    prod.push(row);
  }
  const stops = [];
  for (const r of json.paradas ?? []) {
    const d = new Set(r.duvidas ?? []);
    const row = { linha: r.linha, flags: {} };
    put(row, 'data', norm(normDate, r.data, year), d.has('data'));
    put(row, 'chapa', norm(normChapa, r.chapa), d.has('chapa'));
    put(row, 'ini', norm(normTime, r.ini), d.has('ini'));
    put(row, 'fim', norm(normTime, r.fim), d.has('fim'));
    put(row, 'turno', norm(normTurno, r.turno), d.has('turno'));
    put(row, 'motivo', normMotivo(r.motivo), d.has('motivo'));
    row.desc = r.descricao ?? '';
    if (!row.ini && !row.fim && !row.chapa) continue;
    stops.push(row);
  }
  const headerDate = norm(normDate, json.data, year).value;
  // blank row dates fall back to the sheet's date (flagged so it gets a look)
  for (const row of [...prod, ...stops]) {
    if (!row.data && headerDate) { row.data = headerDate; row.flags.data = 'data do cabeçalho'; }
  }
  // the filled bubble is measured from the pixels, so it wins over the model's reading
  const aiMachine = /^RAW\d\d$/.test(json.maquina ?? '') ? json.maquina : '';
  const machine = meta.machineFromBubble || aiMachine;
  const machineFlag = meta.machineFromBubble && aiMachine && meta.machineFromBubble !== aiMachine ? `IA leu ${aiMachine}` : (machine ? null : 'máquina não identificada');
  return { machine, machineFlag, date: headerDate, prod, stops };
}
