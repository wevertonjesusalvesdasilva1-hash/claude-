import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/extract.js';

const mkRes = () => {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const req = (over = {}) => ({ method: 'POST', headers: { host: 'app.test', 'x-forwarded-for': '1.1.1.' + Math.floor(Math.random() * 250) }, body: { images: ['QUJD'], pass: 'A' }, ...over });

test('rejeita método errado, origem estranha e corpo inválido', async () => {
  process.env.GEMINI_API_KEY = 'k';
  let r = mkRes(); await handler(req({ method: 'GET' }), r); assert.equal(r.code, 405);
  r = mkRes(); await handler(req({ headers: { host: 'app.test', origin: 'https://evil.example' } }), r); assert.equal(r.code, 403);
  r = mkRes(); await handler(req({ body: { images: [] } }), r); assert.equal(r.code, 400);
});

test('sem chave configurada devolve erro claro', async () => {
  delete process.env.GEMINI_API_KEY;
  const r = mkRes(); await handler(req(), r);
  assert.equal(r.code, 500); assert.match(r.body.error, /GEMINI_API_KEY/);
});

test('chama o Gemini com a chave no cabeçalho e devolve o JSON', async () => {
  process.env.GEMINI_API_KEY = 'segredo';
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"producao":[],"paradas":[],"maquina":"RAW05"}' }] } }] }) }; };
  const r = mkRes(); await handler(req({ headers: { host: 'app.test', origin: 'https://app.test', 'x-forwarded-for': '9.9.9.9' } }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.data.maquina, 'RAW05');
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'segredo');
  assert.ok(!seen[0].url.includes('segredo'), 'a chave não vai na URL');
  assert.equal(JSON.parse(seen[0].init.body).generationConfig.temperature, 0);
});

test('cota esgotada vira mensagem amigável', async () => {
  process.env.GEMINI_API_KEY = 'k';
  globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => 'RESOURCE_EXHAUSTED quota per day PerDay' });
  const r = mkRes(); await handler(req({ headers: { host: 'app.test', 'x-forwarded-for': '8.8.8.8' } }), r);
  assert.equal(r.code, 429); assert.match(r.body.error, /plano gratuito/);
});
