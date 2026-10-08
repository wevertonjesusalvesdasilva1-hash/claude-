// Client for the serverless reader (/api/extract). The Gemini key never reaches the browser.
const RETRY = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function readSheet({ images, pass, hints }) {
  for (let i = 0; ; i++) {
    let res, body = {};
    try {
      res = await fetch('/api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ images, pass, hints }) });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      if (i >= 2) throw new Error('Sem conexão com o servidor de leitura');
      await sleep(4000 * (i + 1)); continue;
    }
    if (res.ok && body.data) return body.data;
    const hard = /diário|por dia|GEMINI_API_KEY/i.test(body.error ?? '');
    if (!RETRY.has(res.status) || hard || i >= 2) throw new Error(body.error || `Erro ${res.status} no servidor de leitura`);
    await sleep(8000 * (i + 1));
  }
}
