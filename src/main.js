import { readFiles, toCanvas, jpegB64, jpegUrl } from './files.js';
import { analyze, detectMachine, MACHINES } from './core/layout.js';
import { inkIn } from './core/image.js';
import { readSheet } from './core/gemini.js';
import { buildPage, reconcile, applyInkMotivo } from './core/rows.js';
import { allRows, toTSV, workbookBytes } from './core/export.js';
import { getLists, saveLists, learnAlias, resetLists } from './core/lists.js';
import { saveState, loadState } from './store.js';
import { MOTIVOS } from './data/vocab.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = { pages: [], nextId: 1, busy: false };
const secrets = new Map(); // page id → { images } kept only in memory, for "tentar de novo"

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------------------------------------------------------------- persistence

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keep = state.pages.filter((p) => p.status === 'ok' || p.status === 'erro').map(({ id, label, status, error, machine, machineFlag, date, include, single, dup, prod, stops }) => ({ id, label, status, error, machine, machineFlag, date, include, single, dup, prod, stops }));
    saveState({ pages: keep, nextId: state.nextId });
  }, 400);
}

async function restore() {
  const saved = await loadState();
  if (!saved?.pages?.length) return;
  state.nextId = saved.nextId ?? saved.pages.length + 1;
  for (const p of saved.pages) {
    if (p.status === 'erro') p.error = `${p.error || 'Erro'} (envie o arquivo de novo para repetir)`;
    state.pages.push(p);
    $('pages').append(h('section', { class: 'card page', id: `page-${p.id}` }));
    renderPage(p);
  }
  updateSummary();
}

// ---------------------------------------------------------------- reading a page

function prepare(image) {
  let lay = null;
  try { lay = analyze(image); } catch (e) { console.warn('layout', e); }
  if (!lay) {
    const full = toCanvas(image, 0, 0, image.width, image.height, 2000);
    return { A: [jpegB64(full, 0.88)], B: [jpegB64(full, 0.9)], strips: { prod: [], stops: [] }, bubble: '', inkMotivo: [] };
  }
  const { img, prodX, prodY, stopX, stopY, scale: sc } = lay;
  const full = toCanvas(img, 0, 0, img.width, img.height, 2000);
  const crop = (xs, ys, headPx, maxW) => toCanvas(img, xs[0] - 8, ys[0] - headPx * sc, xs.at(-1) - xs[0] + 16, ys.at(-1) - ys[0] + headPx * sc + 6, maxW);
  const strip = (xs, ys, i) => jpegUrl(toCanvas(img, xs[0] - 2, ys[i] - 2, xs.at(-1) - xs[0] + 4, ys[i + 1] - ys[i] + 4, 1500), 0.8);
  // which motive column holds the X on each stop row, measured from the pixels
  const inkMotivo = stopY.slice(0, -1).map((_, r) => {
    const inks = MOTIVOS.map((__, i) => inkIn(lay.masks, stopX[6 + i] + 4 * sc, stopY[r] + 4 * sc, stopX[7 + i] - 4 * sc, stopY[r + 1] - 4 * sc));
    const min = 45 * sc * sc;
    const hit = inks.map((v, i) => [v, i]).filter(([v]) => v > min).sort((a, b) => b[0] - a[0]);
    if (!hit.length) return -1;
    return hit.length > 1 && hit[1][0] > hit[0][0] * 0.6 ? -2 : hit[0][1];
  });
  return {
    inkMotivo,
    A: [jpegB64(full, 0.88), jpegB64(crop(prodX, prodY, 62, 2200), 0.9), jpegB64(crop(stopX, stopY, 100, 2200), 0.9)],
    B: [jpegB64(crop(prodX, prodY, 62, 2400), 0.92), jpegB64(crop(stopX, stopY, 100, 2400), 0.92)],
    strips: { prod: prodY.slice(0, -1).map((_, i) => strip(prodX, prodY, i)), stops: stopY.slice(0, -1).map((_, i) => strip(stopX, stopY, i)) },
    bubble: detectMachine(lay).machine ?? '',
  };
}

function hints() {
  const { chapas, pecas, modelos } = getLists();
  return { chapas, pecas, modelos };
}

async function readPage(p) {
  p.status = 'lendo'; p.error = ''; renderPage(p);
  const sec = secrets.get(p.id);
  if (!sec) { p.status = 'erro'; p.error = 'Envie o arquivo de novo para ler esta folha'; renderPage(p); return; }
  try {
    const [a, b] = await Promise.allSettled([
      readSheet({ images: sec.A, pass: 'A', hints: hints() }),
      readSheet({ images: sec.B, pass: 'B', hints: hints() }),
    ]);
    if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
    const single = a.status === 'rejected' || b.status === 'rejected';
    const json = single ? (a.status === 'fulfilled' ? a.value : b.value) : reconcile(a.value, b.value);
    const built = buildPage(json, { year: Number($('year').value) || new Date().getFullYear(), meta: { machineFromBubble: sec.bubble } });
    applyInkMotivo(built, sec.inkMotivo);
    Object.assign(p, built, { status: 'ok', single });
    for (const r of p.prod) r.strip = sec.strips.prod[r.linha - 1];
    for (const r of p.stops) r.strip = sec.strips.stops[r.linha - 1];
    p.include = /^RAW\d\d$/.test(p.machine);
    markDuplicates();
  } catch (e) {
    p.status = 'erro'; p.error = e.message;
  }
  renderPage(p); updateSummary(); persist();
}

function signature(p) {
  const r = p.prod[0] ?? p.stops[0];
  return r ? `${p.machine}|${p.date}|${r.ini1 ?? r.ini}|${r.chapa1 ?? r.chapa}` : '';
}
function markDuplicates() {
  const seen = new Map();
  for (const p of state.pages) {
    if (p.status !== 'ok') continue;
    const s = signature(p);
    p.dup = '';
    if (!s) continue;
    if (seen.has(s)) p.dup = `parece repetida (${seen.get(s)})`;
    else seen.set(s, p.label);
  }
  state.pages.forEach((p) => { if (p.status === 'ok') renderPage(p); });
}

async function processFiles(files) {
  if (state.busy) return toast('Aguarde a leitura atual terminar');
  state.busy = true;
  const st = $('status');
  st.hidden = false;
  let n = 0;
  try {
    for await (const item of readFiles(files)) {
      n++;
      st.replaceChildren(h('div', {}, `Lendo ${item.name}, página ${item.page}${item.total > 1 ? ` de ${item.total}` : ''}… não feche esta aba.`), h('progress', { max: item.total, value: item.page - 1 }));
      await new Promise((r) => setTimeout(r)); // let the browser paint
      const prep = prepare(item.image);
      const p = { id: state.nextId++, label: `${item.name} · pág. ${item.page}`, status: 'lendo', error: '', machine: '', date: '', include: false, prod: [], stops: [] };
      secrets.set(p.id, prep);
      state.pages.push(p);
      $('pages').append(h('section', { class: 'card page', id: `page-${p.id}` }));
      await readPage(p);
    }
    toast(n ? 'Leitura concluída. Confira as células destacadas.' : 'Nenhuma página encontrada nos arquivos');
  } catch (e) {
    toast(`Erro ao abrir arquivo: ${e.message}`);
  } finally {
    state.busy = false; st.hidden = true; updateSummary();
  }
}

// ---------------------------------------------------------------- rendering

const PROD_FIELDS = [
  ['data', 'DATA', 104], ['peca', 'PEÇA', 110], ['modelo', 'MODELO', 120],
  ['chapa1', 'CHAPA', 66, 'num'], ['ini1', 'INÍCIO', 60, 'num'], ['fim1', 'FIM', 60, 'num'],
  ['chapa2', 'CHAPA 2º', 66, 'num'], ['ini2', 'INÍCIO', 60, 'num'], ['fim2', 'FIM', 60, 'num'],
  ['chapa3', 'CHAPA 3º', 66, 'num'], ['ini3', 'INÍCIO', 60, 'num'], ['fim3', 'FIM', 60, 'num'],
  ['turno', 'TURNO FINAL', 52, 'num'], ['obs', 'OBSERVAÇÕES', 160],
];
const STOP_FIELDS = [
  ['data', 'DATA', 104], ['chapa', 'CHAPA', 66, 'num'], ['ini', 'INÍCIO', 60, 'num'], ['fim', 'FIM', 60, 'num'],
  ['turno', 'TURNO', 52, 'num'], ['motivo', 'MOTIVO', 150], ['desc', 'DESCRIÇÃO', 260],
];
const BAD = /inválid|ilegível|desconhecid|sem motivo|falta|iguais|corrigida|duração|parada de|fora da lista/;

function fieldCell(p, kind, ri, row, [key, , , cls]) {
  const flag = row.flags?.[key];
  const bad = flag && BAD.test(flag);
  const attrs = { dataset: { p: p.id, k: kind, r: ri, f: key }, title: flag || row.learned?.[key] ? `${flag ?? ''}${row.learned?.[key] ? ` (aprendido: li "${row.learned[key]}")` : ''}` : false };
  const control = key === 'motivo'
    ? h('select', attrs, h('option', { value: '' }, '—'), [...MOTIVOS, ...(row.motivo && !MOTIVOS.includes(row.motivo) ? [row.motivo] : [])].map((m) => h('option', { value: m, selected: m === row.motivo }, m)))
    : h('input', { ...attrs, type: 'text', value: row[key] ?? '', spellcheck: false });
  return h('td', { class: `${cls ?? ''}${flag ? ' flag' : ''}${bad ? ' bad' : ''}` }, control);
}

const hasDoubt = (row) => !!row.rowFlag || Object.keys(row.flags ?? {}).length > 0;

function tableFor(p, kind, rows, fields) {
  const head = h('tr', {}, fields.map(([, label, w]) => h('th', { style: `min-width:${w}px` }, label)), h('th'));
  const body = [];
  rows.forEach((row, ri) => {
    const cls = hasDoubt(row) ? '' : ' clean';
    if (row.strip || row.rowFlag) {
      body.push(h('tr', { class: `strip${cls}` }, h('td', { colspan: fields.length + 1 },
        h('div', { class: 'rowtag' }, h('b', {}, row.linha ? `linha ${row.linha}` : 'linha nova'), row.rowFlag ? h('span', { class: 'tag bad' }, row.rowFlag) : null),
        row.strip ? h('img', { src: row.strip, alt: `Linha ${row.linha} da folha`, dataset: { zoom: 1 } }) : null)));
    }
    body.push(h('tr', { class: `fields${cls}` }, fields.map((f) => fieldCell(p, kind, ri, row, f)),
      h('td', {}, h('button', { class: 'rm', type: 'button', title: 'Remover linha', dataset: { act: 'rm', p: p.id, k: kind, r: ri } }, '✕'))));
  });
  return h('div', { class: 'scroll' }, h('table', { class: 'grid' }, h('thead', {}, head), h('tbody', {}, body)));
}

function countFlags(p) {
  return [...p.prod, ...p.stops].reduce((n, r) => n + Object.keys(r.flags ?? {}).length + (r.rowFlag ? 1 : 0), 0);
}

function renderPage(p) {
  const root = $(`page-${p.id}`);
  if (!root) return;
  root.classList.toggle('skipped', p.status === 'ok' && !p.include);
  const flags = p.status === 'ok' ? countFlags(p) : 0;
  const header = h('header', {},
    h('h2', {}, p.label,
      p.status === 'ok' ? h('select', { dataset: { p: p.id, act: 'machine' } },
        h('option', { value: '' }, 'máquina?'), MACHINES.map((m) => h('option', { value: m, selected: m === p.machine }, m)),
        p.machine && !MACHINES.includes(p.machine) ? h('option', { value: p.machine, selected: true }, p.machine) : null) : null,
      p.status === 'ok' && p.date ? h('span', { class: 'meta' }, p.date.slice(0, 5)) : null,
      p.machineFlag ? h('span', { class: 'tag bad' }, p.machineFlag) : null,
      p.single ? h('span', { class: 'tag bad' }, 'só 1 leitura (a outra falhou)') : null,
      p.dup ? h('span', { class: 'tag bad' }, p.dup) : null,
      p.status === 'ok' ? h('span', { class: 'meta' }, `${p.prod.length} produção · ${p.stops.length} paradas`) : null,
      flags ? h('span', { class: 'tag' }, `${flags} para conferir`) : null),
    p.status === 'ok'
      ? h('label', {}, h('input', { type: 'checkbox', checked: p.include, dataset: { p: p.id, act: 'include' } }), ' incluir na exportação')
      : null);
  const bodyKids = [];
  if (p.status === 'lendo') bodyKids.push(h('p', {}, 'Lendo esta página (duas leituras)…'));
  if (p.status === 'erro') bodyKids.push(h('p', { class: 'err' }, `Não consegui ler: ${p.error}`), h('button', { type: 'button', dataset: { act: 'retry', p: p.id } }, 'Tentar de novo'));
  if (p.status === 'ok') {
    if (!/^RAW\d\d$/.test(p.machine)) bodyKids.push(h('p', { class: 'note' }, 'Esta folha não é de uma máquina RAW, por isso ficou fora da exportação. Escolha a máquina ou marque "incluir" para usar mesmo assim.'));
    bodyKids.push(
      h('h3', {}, 'Produção'), p.prod.length ? tableFor(p, 'prod', p.prod, PROD_FIELDS) : h('p', { class: 'note' }, 'Nenhuma linha de produção preenchida.'),
      h('button', { type: 'button', dataset: { act: 'add', p: p.id, k: 'prod' } }, '+ linha'),
      h('h3', {}, 'Paradas'), p.stops.length ? tableFor(p, 'stops', p.stops, STOP_FIELDS) : h('p', { class: 'note' }, 'Nenhuma parada registrada.'),
      h('button', { type: 'button', dataset: { act: 'add', p: p.id, k: 'stops' } }, '+ linha'));
  }
  root.replaceChildren(header, ...bodyKids);
}

function includedPages() { return state.pages.filter((p) => p.status === 'ok' && p.include); }

function updateSummary() {
  const any = state.pages.length > 0;
  $('exportbar').hidden = !state.pages.some((p) => p.status === 'ok');
  $('tools').hidden = !any;
  const inc = includedPages();
  const { prod, stops } = allRows(inc);
  const flags = inc.reduce((n, p) => n + countFlags(p), 0);
  $('summary').textContent = `${inc.length} folha(s) · ${prod.length} linhas de produção · ${stops.length} paradas${flags ? ` · ${flags} célula(s) para conferir` : ' · nada pendente'}`;
}

// ---------------------------------------------------------------- events

const pageOf = (id) => state.pages.find((p) => p.id === Number(id));
const LEARN = { peca: 'peca', modelo: 'modelo', chapa: 'chapa', chapa1: 'chapa', chapa2: 'chapa', chapa3: 'chapa' };

document.addEventListener('input', (e) => {
  const d = e.target.dataset;
  if (!d?.f) return;
  const row = pageOf(d.p)?.[d.k]?.[Number(d.r)];
  if (!row) return;
  row[d.f === 'desc' ? 'desc' : d.f] = e.target.value;
  if (row.flags?.[d.f]) { delete row.flags[d.f]; e.target.closest('td').classList.remove('flag', 'bad'); }
  updateSummary(); persist();
});

document.addEventListener('change', (e) => {
  const d = e.target.dataset;
  if (d?.act === 'machine') { const p = pageOf(d.p); p.machine = e.target.value; p.machineFlag = null; p.include = !!e.target.value; renderPage(p); updateSummary(); persist(); return; }
  if (d?.act === 'include') { const p = pageOf(d.p); p.include = e.target.checked; renderPage(p); updateSummary(); persist(); return; }
  if (d?.f && e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true }));
  // teach the app: what the model read → what the person typed
  const kind = LEARN[d?.f];
  if (kind) {
    const row = pageOf(d.p)?.[d.k]?.[Number(d.r)];
    const raw = row?.raw?.[d.f];
    const value = e.target.value.trim();
    if (raw && value && String(raw).replace(/\s/g, '').toUpperCase() !== value.replace(/\s/g, '').toUpperCase()) {
      const fixed = kind === 'chapa' ? value.replace(/\D/g, '') : value.toUpperCase();
      learnAlias(kind, raw, fixed);
      const same = (x) => String(x ?? '').replace(/\s/g, '').toUpperCase() === String(raw).replace(/\s/g, '').toUpperCase();
      let n = 0;
      for (const pg of state.pages) {
        for (const tbl of [pg.prod, pg.stops]) {
          for (const r of tbl) {
            for (const f of Object.keys(LEARN)) {
              if (LEARN[f] === kind && same(r.raw?.[f]) && r[f] !== fixed) { r[f] = fixed; delete r.flags[f]; n++; }
            }
          }
        }
        if (pg.status === 'ok') renderPage(pg);
      }
      toast(`Aprendi: "${raw}" → "${fixed}"${n > 1 ? `. Corrigi mais ${n - 1} linha(s) igual(is)` : ''}. Da próxima vez corrijo sozinho.`);
      showLearned(); updateSummary(); persist();
    }
  }
});

document.addEventListener('click', (e) => {
  const img = e.target.closest('img[data-zoom]');
  if (img) { $('lightbox').querySelector('img').src = img.src; $('lightbox').hidden = false; return; }
  if (e.target.closest('#lightbox')) { $('lightbox').hidden = true; return; }
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { act, p: pid, k, r } = b.dataset;
  const p = pageOf(pid);
  if (act === 'rm') { p[k].splice(Number(r), 1); renderPage(p); updateSummary(); persist(); }
  if (act === 'add') { p[k].push({ linha: 0, flags: {}, raw: {}, learned: {} }); renderPage(p); updateSummary(); persist(); }
  if (act === 'retry') readPage(p);
});

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(`${what} copiado. Cole na primeira célula vazia da coluna B.`);
}

function exportable() {
  const inc = includedPages();
  if (!inc.length) { toast('Nenhuma folha marcada para exportar'); return null; }
  const missing = inc.find((p) => !/^RAW\d\d$/.test(p.machine));
  if (missing) { toast(`Escolha a máquina da folha ${missing.label}`); return null; }
  return inc;
}

$('copyprod').addEventListener('click', () => { const inc = exportable(); if (inc) copy(toTSV(allRows(inc).prod), 'PRODUÇÃO'); });
$('copystop').addEventListener('click', () => { const inc = exportable(); if (inc) copy(toTSV(allRows(inc).stops), 'PARADAS'); });
$('xlsx').addEventListener('click', () => {
  const inc = exportable();
  if (!inc) return;
  const blob = new Blob([workbookBytes(inc)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `controle-raw-${new Date().toISOString().slice(0, 10)}.xlsx` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

$('onlyflags').addEventListener('change', (e) => $('pages').classList.toggle('onlyflags', e.target.checked));
$('clear').addEventListener('click', () => {
  if ($('clear').dataset.sure !== '1') { $('clear').dataset.sure = '1'; $('clear').textContent = 'Clique de novo para apagar tudo'; setTimeout(() => { $('clear').dataset.sure = ''; $('clear').textContent = 'Limpar tudo'; }, 4000); return; }
  state.pages.length = 0; secrets.clear(); $('pages').replaceChildren(); $('clear').dataset.sure = ''; $('clear').textContent = 'Limpar tudo';
  updateSummary(); persist();
});

const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => processFiles([...e.dataTransfer.files]));
$('files').addEventListener('change', (e) => { processFiles([...e.target.files]); e.target.value = ''; });

// ---------------------------------------------------------------- lists

const lines = (s) => [...new Set(s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))];
function fillLists() {
  const l = getLists();
  $('l-chapas').value = l.chapas.join('\n');
  $('l-pecas').value = l.pecas.join('\n');
  $('l-modelos').value = l.modelos.join('\n');
  showLearned();
}
function showLearned() {
  const a = getLists().aliases;
  const n = Object.values(a).reduce((s, o) => s + Object.keys(o).length, 0);
  $('learned').textContent = n ? `${n} correção(ões) aprendida(s)` : '';
}
$('savelists').addEventListener('click', () => {
  saveLists({ chapas: lines($('l-chapas').value).map((c) => c.replace(/\D/g, '')).filter(Boolean), pecas: lines($('l-pecas').value), modelos: lines($('l-modelos').value) });
  toast('Listas salvas. Valem para as próximas leituras.');
});
$('resetlists').addEventListener('click', () => { resetLists(); fillLists(); toast('Listas restauradas ao padrão'); });

$('year').value = store.get('year') || new Date().getFullYear();
$('year').addEventListener('change', () => store.set('year', $('year').value));
fillLists();
restore();
