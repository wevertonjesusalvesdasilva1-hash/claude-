// Keeps the reviewed sheets across reloads (IndexedDB: the row crops are too big for localStorage).
const DB = 'diario-raw', STORE = 'estado', KEY = 'paginas';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveState(value) {
  try {
    const db = await open();
    await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch { /* private mode / blocked storage: the app still works, just without memory */ }
}

export async function loadState() {
  try {
    const db = await open();
    const v = await new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    db.close();
    return v ?? null;
  } catch { return null; }
}
