// Base locale IndexedDB : tout reste sur l'appareil.
const DB_NAME = 'solitaire';
const DB_VERSION = 1;

let dbp = null;
const memory = { kv: new Map(), games: [] }; // repli si IndexedDB indisponible
let useMemory = false;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { useMemory = true; return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('games')) {
        const s = db.createObjectStore('games', { keyPath: 'id', autoIncrement: true });
        s.createIndex('key', 'key');
        s.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { useMemory = true; resolve(null); };
    req.onblocked = () => { useMemory = true; resolve(null); };
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    if (!db) return resolve(fn(null));
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export async function get(key, fallback = null) {
  await open();
  if (useMemory) return memory.kv.has(key) ? structuredClone(memory.kv.get(key)) : fallback;
  const v = await tx('kv', 'readonly', s => s.get(key));
  return v === undefined ? fallback : v;
}

export async function set(key, value) {
  await open();
  if (useMemory) { memory.kv.set(key, structuredClone(value)); return; }
  await tx('kv', 'readwrite', s => s.put(value, key));
}

export async function del(key) {
  await open();
  if (useMemory) { memory.kv.delete(key); return; }
  await tx('kv', 'readwrite', s => s.delete(key));
}

export async function addGame(game) {
  await open();
  if (useMemory) { const g = { ...game, id: memory.games.length + 1 }; memory.games.push(g); return g.id; }
  return tx('games', 'readwrite', s => s.add(game));
}

export async function allGames() {
  await open();
  if (useMemory) return memory.games.slice();
  return tx('games', 'readonly', s => s.getAll());
}

export async function allKV() {
  await open();
  if (useMemory) return Object.fromEntries(memory.kv);
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', 'readonly');
    const s = t.objectStore('kv');
    const out = {};
    const req = s.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { out[cur.key] = cur.value; cur.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  await open();
  if (useMemory) { memory.kv.clear(); memory.games = []; return; }
  await tx('kv', 'readwrite', s => s.clear());
  await tx('games', 'readwrite', s => s.clear());
}

export async function importAll({ kv = {}, games = [] }) {
  await clearAll();
  for (const [k, v] of Object.entries(kv)) await set(k, v);
  for (const g of games) { const { id, ...rest } = g; await addGame(rest); }
}

export async function persist() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
