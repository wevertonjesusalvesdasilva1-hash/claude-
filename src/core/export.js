// Output formats for the plant's "CONTROLE DE PARADA DE MÁQUINAS (RAW)" workbook.
import * as XLSX from 'xlsx';

const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

// Columns B:P of the PRODUÇÃO sheet (COD in column A is a formula in the workbook).
export const PROD_HEAD = ['ROBÔ', 'DATA', 'PEÇA', 'MODELO', 'CHAPA', 'INÍCIO', 'FIM', 'CHAPA2', 'INICIO', 'FIM ', 'CHAPA3', 'INCIO', 'FIM 2', 'TURNO QUE FINALIZOU', 'OBSERVAÇÕES '];
export const STOP_HEAD = ['ROBÔ', 'DATA', 'CHAPA', 'INICIO ', 'FINAL ', 'TURNO', 'MOTIVO DA PARADA', 'DESCRIÇÃO DA PARADA'];

export function prodValues(machine, r) {
  return [machine, r.data, r.peca, r.modelo, r.chapa1, r.ini1, r.fim1, r.chapa2, r.ini2, r.fim2, r.chapa3, r.ini3, r.fim3, r.turno, r.obs];
}
export function stopValues(machine, r) {
  return [machine, r.data, r.chapa, r.ini, r.fim, r.turno, r.motivo, r.desc];
}

// pages: [{ machine, prod:[], stops:[] }] already filtered to the ones to include.
export function allRows(pages) {
  const prod = [], stops = [];
  for (const p of pages) {
    for (const r of p.prod) prod.push(prodValues(p.machine, r));
    for (const r of p.stops) stops.push(stopValues(p.machine, r));
  }
  return { prod, stops };
}

// Plain text for pasting straight under the table in Excel (no header row).
export function toTSV(rows) {
  return rows.map((r) => r.map(clean).join('\t')).join('\n');
}

const parseDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s ?? '');
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
};
const parseTime = (s) => {
  const m = /^(\d{2}):(\d{2})$/.exec(s ?? '');
  return m ? (+m[1] * 60 + +m[2]) / 1440 : null;
};
const num = (s) => (/^\d+$/.test(s ?? '') ? Number(s) : s || null);

function cell(v, type) {
  if (v === '' || v == null) return null;
  if (type === 'date') { const d = parseDate(v); return d ? { t: 'd', v: d, z: 'dd/mm/yyyy' } : { t: 's', v }; }
  if (type === 'time') { const t = parseTime(v); return t == null ? { t: 's', v } : { t: 'n', v: t, z: 'hh:mm' }; }
  if (type === 'num') { const n = num(v); return typeof n === 'number' ? { t: 'n', v: n } : { t: 's', v: String(v) }; }
  return { t: 's', v: String(v) };
}

const PROD_TYPES = ['s', 'date', 's', 's', 'num', 'time', 'time', 'num', 'time', 'time', 'num', 'time', 'time', 'num', 's'];
const STOP_TYPES = ['s', 'date', 'num', 'time', 'time', 'num', 's', 's'];

// Builds the workbook with the same sheets/columns as the plant's spreadsheet.
export function buildWorkbook(pages) {
  const { prod, stops } = allRows(pages);

  const ws1 = {};
  const set = (ws, r, c, v) => { if (v) ws[XLSX.utils.encode_cell({ r, c })] = v; };
  const heads1 = ['COD', ...PROD_HEAD, '1ºTURNO', '2ºTURNO', '3ºTURNO', 'TEMPO/DEC'];
  set(ws1, 0, 5, { t: 's', v: '1ºTURNO' }); set(ws1, 0, 8, { t: 's', v: '2ºTURNO/RETORNO' }); set(ws1, 0, 11, { t: 's', v: '3ºTURNO/RETORNO' });
  heads1.forEach((h, c) => set(ws1, 1, c, { t: 's', v: h }));
  prod.forEach((vals, i) => {
    const r = i + 2, n = r + 1;
    set(ws1, r, 0, { t: 's', f: `CONCATENATE(B${n}&D${n}&E${n})`, v: `${vals[0]}${vals[2]}${vals[3]}` });
    vals.forEach((v, c) => set(ws1, r, c + 1, cell(v, PROD_TYPES[c])));
    set(ws1, r, 16, { t: 'n', f: `IFERROR(MOD(H${n}-G${n},1),"")`, z: 'hh:mm' });
    set(ws1, r, 17, { t: 'n', f: `IFERROR(MOD(K${n}-J${n},1),0)`, z: 'hh:mm' });
    set(ws1, r, 18, { t: 'n', f: `IFERROR(MOD(N${n}-M${n},1),0)`, z: 'hh:mm' });
    set(ws1, r, 19, { t: 'n', f: `((Q${n}+R${n}+S${n})*24)`, z: '0.00' });
  });
  ws1['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(prod.length + 1, 1), c: 19 } });
  ws1['!cols'] = [18, 8, 11, 18, 16, 8, 8, 8, 8, 8, 8, 8, 8, 8, 10, 30, 10, 10, 10, 10].map((wch) => ({ wch }));

  const ws2 = {};
  const heads2 = ['', ...STOP_HEAD, 'TTL', 'TEMPO/DEC'];
  heads2.forEach((h, c) => set(ws2, 0, c, h ? { t: 's', v: h } : null));
  stops.forEach((vals, i) => {
    const r = i + 1, n = r + 1;
    vals.forEach((v, c) => set(ws2, r, c + 1, cell(v, STOP_TYPES[c])));
    set(ws2, r, 9, { t: 'n', f: `MOD(F${n}-E${n},1)`, z: 'hh:mm' });
    set(ws2, r, 10, { t: 'n', f: `J${n}*24`, z: '0.00' });
  });
  ws2['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(stops.length, 1), c: 10 } });
  ws2['!cols'] = [4, 8, 11, 8, 8, 8, 7, 18, 30, 8, 10].map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'PRODUÇÃO');
  XLSX.utils.book_append_sheet(wb, ws2, 'PARADAS');
  return wb;
}

export function workbookBytes(pages) {
  return XLSX.write(buildWorkbook(pages), { type: 'array', bookType: 'xlsx', cellDates: true });
}
