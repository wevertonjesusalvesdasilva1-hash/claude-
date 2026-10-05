import test from 'node:test';
import assert from 'node:assert/strict';
import { normTime, normChapa, normTurno, normDate, normPeca, normModelo } from '../src/core/parse.js';
import { buildPage } from '../src/core/rows.js';
import { allRows, toTSV, workbookBytes } from '../src/core/export.js';
import * as XLSX from 'xlsx';

test('horários', () => {
  assert.deepEqual(normTime('7:54'), { value: '07:54', flag: null });
  assert.equal(normTime('5.30').value, '05:30');
  assert.equal(normTime('0300').value, '03:00');
  assert.equal(normTime('25:10').flag, 'hora inválida');
  assert.equal(normTime('abc').flag, 'ilegível');
});

test('chapa: aceita as conhecidas e sinaliza as demais', () => {
  assert.deepEqual(normChapa('11678'), { value: '11678', flag: null });
  const near = normChapa('11679');
  assert.equal(near.value, '11679', 'não troca o valor lido');
  assert.match(near.flag, /parecida com 11678/);
  assert.equal(normChapa('99999').flag, 'chapa desconhecida');
});

test('turno, data, peça, modelo', () => {
  assert.equal(normTurno('2º').value, '2');
  assert.equal(normDate('02-10', 2026).value, '02/10/2026');
  assert.equal(normDate('32/10', 2026).flag, 'data inválida');
  assert.equal(normPeca('lança').value, 'LANÇA');
  assert.equal(normModelo('pc210-10m0').value, 'PC210-10M0');
  const m = normModelo('PC210');
  assert.equal(m.value, 'PC210', 'não troca o valor lido');
  assert.ok(m.flag);
});

const sample = {
  maquina: 'RAW05', data: '02/10',
  producao: [
    { linha: 1, data: '02/10', peca: 'LANÇA', modelo: 'PC210F-10M0', chapa1: '7910', ini1: '7:54', fim1: '13:08', turno_finalizou: '1' },
    { linha: 2, data: '02/10', peca: 'LANÇA', modelo: 'PC210F-10M0', chapa1: '12273', ini1: '13:25', fim1: '17:30', chapa2: '11678', ini2: '20:40', fim2: '21:20', turno_finalizou: '2' },
  ],
  paradas: [{ linha: 1, data: null, chapa: '7910', ini: '07:45', fim: '07:54', turno: '1', motivo: 'TROCA DE PEÇA', descricao: null, duvidas: ['ini'] }],
};

test('linhas: normaliza, herda data do cabeçalho e marca dúvidas', () => {
  const page = buildPage(sample, { year: 2026, meta: { machineFromBubble: 'RAW05' } });
  assert.equal(page.machine, 'RAW05');
  assert.equal(page.prod[0].ini1, '07:54');
  assert.equal(page.stops[0].data, '02/10/2026');
  assert.equal(page.stops[0].flags.data, 'data do cabeçalho');
  assert.equal(page.stops[0].flags.ini, 'IA em dúvida');
});

test('exportação: texto para colar e planilha', () => {
  const page = buildPage(sample, { year: 2026, meta: { machineFromBubble: 'RAW05' } });
  const { prod, stops } = allRows([page]);
  assert.equal(prod[0].length, 15);
  assert.equal(stops[0].length, 8);
  assert.equal(toTSV(prod).split('\n')[0].split('\t')[0], 'RAW05');
  const wb = XLSX.read(workbookBytes([page]), { type: 'array', cellDates: true });
  assert.deepEqual(wb.SheetNames, ['PRODUÇÃO', 'PARADAS']);
  const ws = wb.Sheets['PRODUÇÃO'];
  assert.equal(ws.B3.v, 'RAW05');
  assert.equal(ws.G3.w, '07:54');
  assert.equal(ws.A3.f, 'CONCATENATE(B3&D3&E3)');
});
