// Lists the sheet is checked against (chapas, peças, modelos) plus corrections the user
// has taught the app. Stored in the browser so they survive reloads.
import { CHAPAS, PECAS, MODELOS } from '../data/vocab.js';

const KEY = 'diario-listas-v1';
let cache = null;

function load() {
  let saved = {};
  try { saved = JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}'); } catch { /* ignore */ }
  return {
    chapas: saved.chapas ?? [...CHAPAS],
    pecas: saved.pecas ?? [...PECAS],
    modelos: saved.modelos ?? [...MODELOS],
    aliases: { chapa: {}, peca: {}, modelo: {}, ...(saved.aliases ?? {}) },
  };
}

export function getLists() { return (cache ??= load()); }

export function saveLists(patch) {
  cache = { ...getLists(), ...patch };
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
}

export const aliasKey = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function lookupAlias(field, raw) {
  const v = getLists().aliases[field]?.[aliasKey(raw)];
  return v ?? null;
}

// Remember "what the model read" → "what the person says it is".
export function learnAlias(field, raw, value) {
  const k = aliasKey(raw);
  if (!k || !value || aliasKey(value) === k) return;
  const aliases = { ...getLists().aliases, [field]: { ...getLists().aliases[field], [k]: value } };
  saveLists({ aliases });
}

export function resetLists() { cache = null; try { globalThis.localStorage?.removeItem(KEY); } catch { /* ignore */ } }
