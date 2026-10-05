import { readFiles, toCanvas, jpegB64, jpegUrl } from './files.js';
import { analyze, detectMachine, MACHINES } from './core/layout.js';
import { readSheet, listModels } from './core/gemini.js';
import { buildPage } from './core/rows.js';
import { allRows, toTSV, workbookBytes } from './core/export.js';
import { MOTIVOS } from './data/vocab.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = { pages: [], nextId: 1, busy: false };
const DEFAULT_MODEL = 'gemini-2.5-flash';

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
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------------------------------------------------------------- settings

function setModels(models, selected) {
  const sel = $('model');
  sel.replaceChildren(...models.map((m) => h('option', { value: m, selected: m === selected }, m)));
}

function initSettings() {
  $('year').value = store.get('year') || new Date().getFullYear();
  const savedModel = store.get('gemini_model') || DEFAULT_MODEL;
  setModels([savedModel], savedModel);
  const key = store.get('gemini_key');
  if (key) { $('apikey').value = key; markKey(true); } else { $('keybox').open = true; }
  $('model').addEventListener('change', () => store.set('gemini_model', $('model').value));
  $('year').addEventListener('change', () => store.set('year', $('year').value));
  $('savekey').addEventListener('click', async () => {
    const key = $('apikey').value.trim();
    if (!key) return toast('Cole a chave primeiro');
    $('savekey').disabled = true;
    try {
      const models = await listModels(key);
      if (!models.length) throw new Error('A chave funciona, mas não há modelo Gemini disponível');
      store.set('gemini_key', key);
      const keep = models.includes($('model').value) ? $('model').value : models[0];
      setModels(models, keep); store.set('gemini_model', keep);
      markKey(true); $('keybox').open = false;
      toast('Chave ok');
    } catch (e) { markKey(false); toast(e.message); } finally { $('savekey').disabled = false; }
  });
}

function markKey(ok) {
  const p = $('keystate');
  p.textContent = ok ? 'configurada' : 'não configurada';
  p.classList.toggle('ok', ok);
}

// ---------------------------------------------------------------- reading a page

function prepare(image) {
  let lay = null;
  try { lay = analyze(image); } catch (e) { console.warn('layout', e); }
  if (!lay) {
    const full = toCanvas(image, 0, 0, image.width, image.height, 2000);
    return { images: [jpegB64(full, 0.88)], strips: { prod: [], stops: [] }, bubble: '' };
  }
  const { img, prodX, prodY, stopX, stopY, scale: sc } = lay;
  const full = toCanvas(img, 0, 0, img.width, img.height, 2000);
  const crop = (xs, ys, headPx) => toCanvas(img, xs[0] - 8, ys[0] - headPx * sc, xs.at(-1) - xs[0] + 16, ys.at(-1) - ys[0] + headPx * sc + 6, 2200);
  const images = [jpegB64(full, 0.88), jpegB64(crop(prodX, prodY, 62), 0.9), jpegB64(crop(stopX, stopY, 100), 0.9)];
  const strip = (xs, ys, i) => jpegUrl(toCanvas(img, xs[0] - 2, ys[i] - 2, xs.at(-1) - xs[0] + 4, ys[i + 1] - ys[i] + 4, 1500), 0.8);
  const strips = {
    prod: prodY.slice(0, -1).map((_, i) => strip(prodX, prodY, i)),
    stops: stopY.slice(0, -1).map((_, i) => strip(stopX, stopY, i)),
  };
  return { images, strips, bubble: detectMachine(lay).machine ?? '' };
}

async function readPage(p) {
  p.status = 'lendo'; p.error = ''; renderPage(p);
  try {
    const json = await readSheet({ apiKey: store.get('gemini_key'), model: $('model').value || DEFAULT_MODEL, images: p.images });
    const built = buildPage(json, { year: Number($('year').value) || new Date().getFullYear(), meta: { machineFromBubble: p.bubble } });
    Object.assign(p, built, { status: 'ok' });
    for (const r of p.prod) r.strip = p.strips.prod[r.linha - 1];
    for (const r of p.stops) r.strip = p.strips.stops[r.linha - 1];
    p.prod.sort((a, b) => a.linha - b.linha); p.stops.sort((a, b) => a.linha - b.linha);
    p.include = /^RAW\d\d$/.test(p.machine);
  } catch (e) {
    p.status = 'erro'; p.error = e.message;
  }
  renderPage(p); updateSummary();
}

async function processFiles(files) {
  if (state.busy) return toast('Aguarde a leitura atual terminar');
  if (!store.get('gemini_key')) { $('keybox').open = true; return toast('Configure a chave do Gemini primeiro'); }
  state.busy = true;
  const st = $('status');
  st.hidden = false;
  let n = 0;
  try {
    for await (const item of readFiles(files)) {
      n++;
      st.replaceChildren(h('div', {}, `Lendo ${item.name}, página ${item.page}${item.total > 1 ? ` de ${item.total}` : ''}…`), h('progress', { max: item.total, value: item.page - 1 }));
      await new Promise((r) => setTimeout(r)); // let the browser paint
      const prep = prepare(item.image);
      const p = { id: state.nextId++, label: `${item.name} · pág. ${item.page}`, status: 'lendo', error: '', machine: '', date: '', include: false, prod: [], stops: [], ...prep };
      state.pages.push(p);
      $('pages').append(h('section', { class: 'card page', id: `page-${p.id}` }));
      await readPage(p);
    }
    toast(n ? 'Leitura concluída. Confira as células amarelas.' : 'Nenhuma página encontrada nos arquivos');
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

function fieldCell(p, kind, ri, row, [key, , , cls]) {
  const flag = row.flags?.[key];
  const bad = flag && /inválid|ilegível|desconhecid|sem motivo|falta/.test(flag);
  const attrs = { dataset: { p: p.id, k: kind, r: ri, f: key }, title: flag || false };
  const control = key === 'motivo'
    ? h('select', attrs, h('option', { value: '' }, '—'), [...MOTIVOS, ...(row.motivo && !MOTIVOS.includes(row.motivo) ? [row.motivo] : [])].map((m) => h('option', { value: m, selected: m === row.motivo }, m)))
    : h('input', { ...attrs, type: 'text', value: row[key] ?? '', spellcheck: false });
  return h('td', { class: `${cls ?? ''}${flag ? ' flag' : ''}${bad ? ' bad' : ''}` }, control);
}

function tableFor(p, kind, rows, fields) {
  const head = h('tr', {}, fields.map(([, label, w]) => h('th', { style: `min-width:${w}px` }, label)), h('th'));
  const body = [];
  rows.forEach((row, ri) => {
    if (row.strip) body.push(h('tr', { class: 'strip' }, h('td', { colspan: fields.length + 1 }, h('img', { src: row.strip, alt: `Linha ${row.linha} da folha` }))));
    body.push(h('tr', { class: 'fields' }, fields.map((f) => fieldCell(p, kind, ri, row, f)),
      h('td', {}, h('button', { class: 'rm', type: 'button', title: 'Remover linha', dataset: { act: 'rm', p: p.id, k: kind, r: ri } }, '✕'))));
  });
  return h('div', { class: 'scroll' }, h('table', { class: 'grid' }, h('thead', {}, head), h('tbody', {}, body)));
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
      p.machineFlag ? h('span', { class: 'tag' }, p.machineFlag) : null,
      p.status === 'ok' ? h('span', { class: 'meta' }, `${p.prod.length} produção · ${p.stops.length} paradas`) : null,
      flags ? h('span', { class: 'tag' }, `${flags} para conferir`) : null),
    p.status === 'ok'
      ? h('label', {}, h('input', { type: 'checkbox', checked: p.include, dataset: { p: p.id, act: 'include' } }), ' incluir na exportação')
      : null);
  const bodyKids = [];
  if (p.status === 'lendo') bodyKids.push(h('p', {}, 'Lendo esta página…'));
  if (p.status === 'erro') bodyKids.push(h('p', { class: 'err' }, `Não consegui ler: ${p.error}`), h('button', { type: 'button', dataset: { act: 'retry', p: p.id } }, 'Tentar de novo'));
  if (p.status === 'ok') {
    if (!/^RAW\d\d$/.test(p.machine)) bodyKids.push(h('p', { class: 'note' }, 'Esta folha não é de uma máquina RAW, por isso ficou fora da exportação. Marque "incluir" se quiser usar mesmo assim.'));
    bodyKids.push(
      h('h3', {}, 'Produção'), p.prod.length ? tableFor(p, 'prod', p.prod, PROD_FIELDS) : h('p', { class: 'note' }, 'Nenhuma linha de produção preenchida.'),
      h('button', { type: 'button', dataset: { act: 'add', p: p.id, k: 'prod' } }, '+ linha'),
      h('h3', {}, 'Paradas'), p.stops.length ? tableFor(p, 'stops', p.stops, STOP_FIELDS) : h('p', { class: 'note' }, 'Nenhuma parada registrada.'),
      h('button', { type: 'button', dataset: { act: 'add', p: p.id, k: 'stops' } }, '+ linha'));
  }
  root.replaceChildren(header, ...bodyKids);
}

function countFlags(p) {
  return [...p.prod, ...p.stops].reduce((n, r) => n + Object.keys(r.flags ?? {}).length, 0);
}

function includedPages() { return state.pages.filter((p) => p.status === 'ok' && p.include); }

function updateSummary() {
  const bar = $('exportbar');
  const ok = state.pages.some((p) => p.status === 'ok');
  bar.hidden = !ok;
  const inc = includedPages();
  const { prod, stops } = allRows(inc);
  const flags = inc.reduce((n, p) => n + countFlags(p), 0);
  $('summary').textContent = `${inc.length} folha(s) · ${prod.length} linhas de produção · ${stops.length} paradas${flags ? ` · ${flags} célula(s) para conferir` : ''}`;
}

// ---------------------------------------------------------------- events

const pageOf = (id) => state.pages.find((p) => p.id === Number(id));

document.addEventListener('input', (e) => {
  const d = e.target.dataset;
  if (!d?.f) return;
  const row = pageOf(d.p)?.[d.k]?.[Number(d.r)];
  if (!row) return;
  row[d.f] = e.target.value;
  if (row.flags?.[d.f]) { delete row.flags[d.f]; e.target.closest('td').classList.remove('flag', 'bad'); }
  updateSummary();
});

document.addEventListener('change', (e) => {
  const d = e.target.dataset;
  if (d?.act === 'machine') { pageOf(d.p).machine = e.target.value; pageOf(d.p).machineFlag = null; pageOf(d.p).include = !!e.target.value; renderPage(pageOf(d.p)); updateSummary(); }
  if (d?.act === 'include') { const p = pageOf(d.p); p.include = e.target.checked; renderPage(p); updateSummary(); }
  if (d?.f && e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true }));
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { act, p: pid, k, r } = b.dataset;
  const p = pageOf(pid);
  if (act === 'rm') { p[k].splice(Number(r), 1); renderPage(p); updateSummary(); }
  if (act === 'add') { p[k].push({ linha: 0, flags: {} }); renderPage(p); updateSummary(); }
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

const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => processFiles([...e.dataTransfer.files]));
$('files').addEventListener('change', (e) => { processFiles([...e.target.files]); e.target.value = ''; });

initSettings();
