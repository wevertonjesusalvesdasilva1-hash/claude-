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

async function gemini(model, key, parts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    });
    if (r.ok) return r.json();
    const text = await r.text();
    last = { status: r.status, text: text.slice(0, 400) };
    if (r.status !== 429 && r.status < 500) break;
    if (/quota|RESOURCE_EXHAUSTED/i.test(text) && /per day|PerDay/i.test(text)) break; // daily quota will not recover in seconds
    await new Promise((ok) => setTimeout(ok, 2500 * (i + 1)));
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

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  try {
    const data = await gemini(model, key, parts);
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) return send(res, 502, { error: `O Gemini não devolveu texto (${data?.candidates?.[0]?.finishReason ?? 'sem motivo'})` });
    let parsed;
    try { parsed = JSON.parse(text); } catch { return send(res, 502, { error: 'Resposta do Gemini não era JSON válido' }); }
    return send(res, 200, { data: parsed, model });
  } catch (e) {
    const quota = e.status === 429;
    return send(res, quota ? 429 : 502, { error: quota ? 'Limite do plano gratuito do Gemini atingido. Tente de novo em alguns minutos (ou amanhã, se for o limite diário).' : e.message });
  }
}
