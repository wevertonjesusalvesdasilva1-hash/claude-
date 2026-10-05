// Turns uploaded PDFs / photos into RGBA pages (one at a time, to keep memory low).
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// In the single-file build the worker is a data: URI, which browsers refuse as a Worker URL; turn it into a blob.
function resolveWorker(url) {
  if (!url.startsWith('data:')) return url;
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: head.includes('javascript') ? 'text/javascript' : 'application/octet-stream' }));
}
pdfjs.GlobalWorkerOptions.workerSrc = resolveWorker(workerUrl);

const MAX_SIDE = 2600;

function canvasToImage(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const id = ctx.getImageData(0, 0, width, height);
  return { width, height, data: id.data };
}

function scaled(srcW, srcH) {
  const k = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
  return { w: Math.round(srcW * k), h: Math.round(srcH * k) };
}

async function* pdfPages(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // ~150 dpi: enough for handwriting, light enough to process quickly
    let scale = 150 / 72;
    scale *= Math.min(1, MAX_SIDE / (Math.max(base.width, base.height) * scale));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    yield { name: file.name, page: n, total: doc.numPages, image: canvasToImage(canvas) };
    page.cleanup();
  }
  await doc.destroy();
}

async function* photo(file) {
  const bmp = await createImageBitmap(file);
  const { w, h } = scaled(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  yield { name: file.name, page: 1, total: 1, image: canvasToImage(canvas) };
}

export async function* readFiles(files) {
  for (const f of files) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) yield* pdfPages(f);
    else if (f.type.startsWith('image/')) yield* photo(f);
  }
}

// ---- image → JPEG helpers (for the model and for the review thumbnails) ----

export function toCanvas(img, sx = 0, sy = 0, sw = img.width, sh = img.height, maxW = 2200) {
  sx = Math.max(0, Math.round(sx)); sy = Math.max(0, Math.round(sy));
  sw = Math.min(img.width - sx, Math.round(sw)); sh = Math.min(img.height - sy, Math.round(sh));
  const src = document.createElement('canvas');
  src.width = sw; src.height = sh;
  const sctx = src.getContext('2d');
  const id = sctx.createImageData(sw, sh);
  for (let y = 0; y < sh; y++) {
    const from = ((y + sy) * img.width + sx) * 4;
    id.data.set(img.data.subarray(from, from + sw * 4), y * sw * 4);
  }
  sctx.putImageData(id, 0, 0);
  if (sw <= maxW) return src;
  const out = document.createElement('canvas');
  out.width = maxW; out.height = Math.round(sh * (maxW / sw));
  out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
  return out;
}

export const jpegB64 = (canvas, q = 0.9) => canvas.toDataURL('image/jpeg', q).split(',')[1];
export const jpegUrl = (canvas, q = 0.8) => canvas.toDataURL('image/jpeg', q);
