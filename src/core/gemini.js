// Reads one sheet with the Google Gemini API (free tier key from aistudio.google.com/apikey).
import { CHAPAS, PECAS, MODELOS, MOTIVOS } from '../data/vocab.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

const timeField = { type: 'STRING', nullable: true, description: 'HH:MM em 24h, ex: 07:54' };
const chapaField = { type: 'STRING', nullable: true, description: 'número da chapa (crachá), só dígitos' };
const textField = { type: 'STRING', nullable: true };

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    maquina: { type: 'STRING', nullable: true, description: 'RAW05, RAW06, RAW09, RAW10, RAW11 ou RAW12 (bolinha preenchida); null se for outra' },
    data: { type: 'STRING', nullable: true, description: 'data do cabeçalho, dd/mm' },
    producao: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          linha: { type: 'INTEGER', description: 'número da linha (1 a 10) na tabela impressa' },
          data: textField, peca: textField, modelo: textField,
          chapa1: chapaField, ini1: timeField, fim1: timeField,
          chapa2: chapaField, ini2: timeField, fim2: timeField,
          chapa3: chapaField, ini3: timeField, fim3: timeField,
          turno_finalizou: { type: 'STRING', nullable: true, description: '1, 2 ou 3' },
          obs: textField,
          duvidas: { type: 'ARRAY', items: { type: 'STRING' }, description: 'nomes dos campos que você não conseguiu ler com segurança' },
        },
        required: ['linha'],
      },
    },
    paradas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          linha: { type: 'INTEGER', description: 'posição da linha (1 a 10) na tabela impressa, contando de cima' },
          data: textField, chapa: chapaField, ini: timeField, fim: timeField,
          turno: { type: 'STRING', nullable: true, description: '1, 2 ou 3' },
          motivo: { type: 'STRING', nullable: true, description: `coluna marcada com X: ${MOTIVOS.join(' | ')}` },
          descricao: textField,
          duvidas: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['linha'],
      },
    },
  },
  required: ['producao', 'paradas'],
};

export function buildPrompt() {
  return `Você transcreve folhas manuscritas "DIÁRIO DE BORDO – PRODUÇÃO E PARADAS" (Komatsu, robôs de solda RAW). A primeira imagem é a folha inteira, já na posição correta; as seguintes são ampliações da tabela 1 e da tabela 2.

CABEÇALHO: MÁQUINA (bolinha preenchida entre 05, 06, 09, 10, 11, 12 → RAW05…RAW12) e DATA (dd/mm).

TABELA 1 – REGISTRO DE PRODUÇÃO (até 10 linhas): N°, DATA, PEÇA, MODELO e, para cada turno (1º, 2º, 3º), CHAPA, INÍCIO e FIM; depois TURNO QUE FINALIZOU (1, 2 ou 3) e OBSERVAÇÕES. Transcreva só as linhas que têm escrita.

TABELA 2 – CONTROLE DE PARADAS (até 10 linhas): N°, DATA, CHAPA, INÍCIO, FIM, TURNO (1, 2 ou 3), o MOTIVO (um X numa destas colunas: ${MOTIVOS.join(', ')}) e DESCRIÇÃO DA PARADA. "TROCA DE CONSUMÍVEIS" corresponde a CONSUMIVEIS.

REGRAS
- Aspas de repetição: aparece um sinal pequeno (", u, ч, ", -, ~) no lugar do valor significa "igual à linha de cima". Escreva o valor repetido por extenso (DATA, PEÇA, MODELO, CHAPA).
- Horários em 24h no formato HH:MM ("5:30" → "05:30"). Cruzar a meia-noite é normal.
- CHAPA é o número do crachá do operador, 4 ou 5 dígitos. Chapas conhecidas: ${CHAPAS.join(', ')}. Se o número lido for muito parecido com uma delas, use-a; se for claramente outro, copie o que está escrito.
- PEÇA costuma ser: ${PECAS.join(', ')}. MODELO costuma ser: ${MODELOS.join(', ')}. Se estiver escrito diferente, copie como está.
- Use o número impresso/escrito da linha em "linha" (posição contada de cima na tabela).
- NÃO invente. Se não conseguir ler um campo, devolva null e coloque o nome do campo em "duvidas". Prefira admitir dúvida a chutar.
- Responda somente com o JSON do esquema.`;
}

async function call(url, body, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    const txt = await res.text();
    lastErr = new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
    lastErr.status = res.status;
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3000 * 2 ** i)); // free tier rate limits
      continue;
    }
    break;
  }
  throw lastErr;
}

// images: array of base64 JPEG strings (full page first, then zoomed table crops).
export async function readSheet({ apiKey, model, images }) {
  const parts = [{ text: buildPrompt() }];
  const labels = ['Folha inteira:', 'Ampliação da TABELA 1 (produção):', 'Ampliação da TABELA 2 (paradas):'];
  images.forEach((b64, i) => {
    parts.push({ text: labels[i] ?? `Imagem ${i + 1}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
  });
  const data = await call(`${API}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
  });
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error(`Gemini não devolveu texto (${data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? 'sem motivo'})`);
  try { return JSON.parse(text); } catch { throw new Error('Resposta do Gemini não era JSON válido'); }
}

// Lists the models this key can use, newest "flash" first, so the app keeps working when Google retires a model.
export async function listModels(apiKey) {
  const res = await fetch(`${API}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`);
  if (!res.ok) {
    const e = new Error(res.status === 400 || res.status === 403 ? 'Chave inválida ou sem permissão' : `Erro ${res.status} ao validar a chave`);
    e.status = res.status; throw e;
  }
  const { models = [] } = await res.json();
  const names = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-/.test(n) && !/(image|tts|embedding|live|audio|thinking-exp|robotics|computer|customtools)/.test(n));
  const rank = (n) => (/flash/.test(n) && !/lite/.test(n) ? 0 : /pro/.test(n) ? 1 : 2);
  return names.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true }));
}
