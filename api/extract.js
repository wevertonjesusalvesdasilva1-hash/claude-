// POST /api/extract  { images: [base64 jpeg...], pass: "A" | "B", hints?: { chapas, pecas, modelos } }
// Reads one scanned sheet with Gemini. The API key lives only in the GEMINI_API_KEY environment variable.
import { SCHEMA, buildPrompt } from './_shared.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_IMAGE = 2_400_000; // base64 chars per image
const hits = new Map();

const send = (res, status, body) => res.status(status).setHeader('Cache-Control', 'no-store').json(body);

function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 40;
}

const DEADLINE_MS = 270_000; // the function may run up to 300 s (see vercel.json)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One attempt on one model. thinkingBudget keeps transcription fast; models that reject the
// field are retried without it.
async function once(model, key, parts, budgetMs, thinking = true) {
  const generationConfig = { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA };
  const budget = Number(process.env.THINKING_BUDGET ?? 1024);
  if (thinking && budget >= 0) generationConfig.thinkingConfig = { thinkingBudget: budget };
  const r = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    signal: AbortSignal.timeout(Math.max(5_000, Math.min(budgetMs, 130_000))),
  });
  if (r.ok) return { ok: true, data: await r.json() };
  const text = await r.text();
  if (r.status === 400 && thinking && /thinking/i.test(text)) return once(model, key, parts, budgetMs, false);
  return { ok: false, status: r.status, text: text.slice(0, 400) };
}

// Tries the configured model, then the fallbacks, cycling until the deadline.
// 503 ("high demand") and 429 are usually per model, so switching model is the fastest way out.
async function gemini(models, key, parts) {
  const start = Date.now();
  let last = { status: 0, text: 'sem resposta' };
  for (let round = 0; Date.now() - start < DEADLINE_MS; round++) {
    for (const model of models) {
      const left = DEADLINE_MS - (Date.now() - start);
      if (left < 8_000) break;
      try {
        const out = await once(model, key, parts, left);
        if (out.ok) return { data: out.data, model };
        last = out;
        if (out.status === 400 || out.status === 401 || out.status === 403) { const e = new Error(`Gemini ${out.status}: ${out.text}`); e.status = out.status; throw e; }
        if (out.status === 429 && /PerDay|per day/i.test(out.text)) { const e = new Error(`Gemini 429: ${out.text}`); e.status = 429; e.daily = true; throw e; }
      } catch (e) {
        if (e.status) throw e;
        last = { status: 504, text: e.name === 'TimeoutError' ? 'o Gemini demorou demais' : String(e.message) };
      }
    }
    await sleep(Math.min(4_000 * (round + 1), 12_000));
  }
  const err = new Error(`Gemini ${last.status}: ${last.text}`);
  err.status = last.status;
  throw err;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Origem não permitida' }); } catch { return send(res, 403, { error: 'Origem inválida' }); } }
  const ip = String(req.headers['x-forwarded-for'] ?? 'x').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'Muitas leituras seguidas, aguarde um minuto' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return send(res, 500, { error: 'GEMINI_API_KEY não está configurada no projeto da Vercel' });

  const { images, pass = 'A', hints } = req.body ?? {};
  if (!Array.isArray(images) || !images.length || images.length > 4 || images.some((i) => typeof i !== 'string' || i.length > MAX_IMAGE)) {
    return send(res, 400, { error: 'Envie de 1 a 4 imagens JPEG em base64' });
  }
  const parts = [{ text: buildPrompt(pass === 'B' ? 'B' : 'A', hints) }];
  const labels = pass === 'B' ? ['Ampliação da TABELA 1 (produção):', 'Ampliação da TABELA 2 (paradas):'] : ['Folha inteira:', 'Ampliação da TABELA 1 (produção):', 'Ampliação da TABELA 2 (paradas):'];
  images.forEach((b64, i) => {
    parts.push({ text: labels[i] ?? `Imagem ${i + 1}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64.replace(/^data:image\/jpeg;base64,/, '') } });
  });

  const models = [...new Set([process.env.GEMINI_MODEL || 'gemini-flash-latest', ...(process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash,gemini-flash-lite-latest').split(',').map((m) => m.trim()).filter(Boolean)])];
  try {
    const { data, model } = await gemini(models, key, parts);
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) return send(res, 502, { error: `O Gemini não devolveu texto (${data?.candidates?.[0]?.finishReason ?? 'sem motivo'})` });
    let parsed;
    try { parsed = JSON.parse(text); } catch { return send(res, 502, { error: 'Resposta do Gemini não era JSON válido' }); }
    return send(res, 200, { data: parsed, model });
  } catch (e) {
    const quota = e.status === 429;
    const busy = e.status === 503 || e.status === 504 || e.status === 500;
    return send(res, quota ? 429 : busy ? 503 : 502, {
      error: quota ? (e.daily ? 'Limite diário do plano gratuito do Gemini atingido. Volta a funcionar amanhã.' : 'Limite do plano gratuito do Gemini atingido. Tente de novo em alguns minutos.')
        : busy ? 'O Gemini está sobrecarregado agora. Tente de novo em alguns minutos.' : e.message,
    });
  }
}
