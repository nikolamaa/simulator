// IndexedDB layer. Everything Longplay remembers lives in one database, "longplay":
//   games   {id, title, system, ...}             library metadata
//   roms    gameId -> Blob                       the game file itself
//   art     gameId -> Blob                       uploaded box art
//   saves   {gameId, files:{path: bytes}}        battery / in-game saves (the core's save folder)
//   states  {gameId, slot, data, thumb, ...}     slot 0 = auto-save, 1..10 = manual slots
//   kv      key -> value                         settings, controls, last played, playthrough order

const DB_NAME = 'longplay';
const DB_VERSION = 1;

export class StorageError extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.name = 'StorageError';
    this.kind = kind; // 'quota' | 'unavailable' | 'failed'
    this.cause = cause;
  }
}

function wrap(e) {
  if (e instanceof StorageError) return e;
  const name = e && e.name;
  const msg = (e && e.message) || '';
  if (name === 'QuotaExceededError' || /quota|disk full|no space/i.test(msg)) {
    return new StorageError('quota', 'Storage is full. Free some space in Settings, under Storage, then try again.', e);
  }
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'UnknownError') {
    return new StorageError('unavailable', 'This browser is blocking storage. Private windows often do; use a normal window.', e);
  }
  return new StorageError('failed', msg || 'A storage request failed.', e);
}

let dbPromise = null;
let dbNow = null; // open connection, for writes that must begin synchronously while the page unloads

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('unavailable', 'This browser has no IndexedDB, so nothing can be saved.'));
      return;
    }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(wrap(e)); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      const has = (n) => db.objectStoreNames.contains(n);
      if (!has('games')) db.createObjectStore('games', { keyPath: 'id' });
      if (!has('roms')) db.createObjectStore('roms');
      if (!has('art')) db.createObjectStore('art');
      if (!has('saves')) db.createObjectStore('saves', { keyPath: 'gameId' });
      if (!has('states')) {
        const s = db.createObjectStore('states', { keyPath: ['gameId', 'slot'] });
        s.createIndex('byGame', 'gameId');
      }
      if (!has('kv')) db.createObjectStore('kv');
    };
    req.onerror = () => reject(wrap(req.error || new Error('Could not open storage.')));
    req.onblocked = () => reject(new StorageError('unavailable', 'Longplay is open in another tab that is using an older version. Close it and reload.'));
    req.onsuccess = () => {
      const db = req.result;
      dbNow = db;
      db.onversionchange = () => { db.close(); dbNow = null; dbPromise = null; };
      db.onclose = () => { dbNow = null; dbPromise = null; };
      resolve(db);
    };
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/** Runs work(tx) in one transaction. If work returns an IDBRequest (or an array of them), resolves with the result(s). */
function run(stores, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(stores, mode); } catch (e) { reject(wrap(e)); return; }
    let out;
    tx.oncomplete = () => {
      if (Array.isArray(out)) resolve(out.map((r) => (r && 'result' in r ? r.result : r)));
      else resolve(out && typeof out === 'object' && 'readyState' in out ? out.result : out);
    };
    tx.onabort = () => reject(wrap(tx.error || new Error('The storage transaction was cancelled.')));
    try { out = work(tx); } catch (e) {
      try { tx.abort(); } catch { /* already finished */ }
      reject(wrap(e));
    }
  }));
}

const get = (store, key) => run([store], 'readonly', (tx) => tx.objectStore(store).get(key));
const getAll = (store) => run([store], 'readonly', (tx) => tx.objectStore(store).getAll());
const put = (store, value, key) => run([store], 'readwrite', (tx) => { tx.objectStore(store).put(value, key); });
const del = (store, key) => run([store], 'readwrite', (tx) => { tx.objectStore(store).delete(key); });

/** Starts a write right now without waiting (used from pagehide / visibilitychange). Returns false if storage is not open. */
export function putNow(store, value, key) {
  if (!dbNow) return false;
  try {
    const tx = dbNow.transaction([store], 'readwrite', { durability: 'relaxed' });
    tx.objectStore(store).put(value, key);
    tx.onabort = () => console.warn('Longplay: a save during page close did not complete', tx.error);
    // Without an explicit commit the transaction only completes after events the dying page
    // never gets to process, and the browser throws the write away.
    if (typeof tx.commit === 'function') tx.commit();
    return true;
  } catch (e) {
    console.warn('Longplay: could not start a save during page close', e);
    return false;
  }
}

// ---- Games -----------------------------------------------------------------------------------
export const listGames = () => getAll('games');
export const getGame = (id) => get('games', id);
export const putGame = (game) => put('games', game);
export const getRom = (id) => get('roms', id);
export const getArt = (id) => get('art', id);
export const putArt = (id, blob) => put('art', blob, id);
export const deleteArt = (id) => del('art', id);

/** Stores the game record and its file together, so a full disk never leaves half a game behind. */
export function addGame(game, romBlob) {
  return run(['games', 'roms'], 'readwrite', (tx) => {
    tx.objectStore('roms').put(romBlob, game.id);
    tx.objectStore('games').put(game);
  });
}

/** Removes only the game file; saves, states and notes stay so the game can be re-added later. */
export async function removeRom(id) {
  const game = await getGame(id);
  if (!game) return;
  game.hasRom = false;
  await run(['games', 'roms'], 'readwrite', (tx) => {
    tx.objectStore('roms').delete(id);
    tx.objectStore('games').put(game);
  });
}

function deleteStatesIn(tx, gameId) {
  const idx = tx.objectStore('states').index('byGame');
  const cur = idx.openKeyCursor(IDBKeyRange.only(gameId));
  cur.onsuccess = () => {
    const c = cur.result;
    if (!c) return;
    tx.objectStore('states').delete(c.primaryKey);
    c.continue();
  };
}

export function deleteGame(id) {
  return run(['games', 'roms', 'art', 'saves', 'states'], 'readwrite', (tx) => {
    tx.objectStore('games').delete(id);
    tx.objectStore('roms').delete(id);
    tx.objectStore('art').delete(id);
    tx.objectStore('saves').delete(id);
    deleteStatesIn(tx, id);
  });
}

// ---- Battery saves ---------------------------------------------------------------------------
export const getSaves = (gameId) => get('saves', gameId);
export const putSaves = (rec) => put('saves', rec);
export const deleteSaves = (gameId) => del('saves', gameId);

// ---- Save states -----------------------------------------------------------------------------
export const listStates = (gameId) => run(['states'], 'readonly', (tx) => tx.objectStore('states').index('byGame').getAll(IDBKeyRange.only(gameId)));
export const allStates = () => getAll('states');
export const getState = (gameId, slot) => get('states', [gameId, slot]);
export const putState = (rec) => put('states', rec);
export const deleteState = (gameId, slot) => del('states', [gameId, slot]);
export const deleteStates = (gameId) => run(['states'], 'readwrite', (tx) => { deleteStatesIn(tx, gameId); });

// ---- Key/value -------------------------------------------------------------------------------
export async function getKV(key, fallback) {
  const v = await get('kv', key);
  return v === undefined ? fallback : v;
}
export const setKV = (key, value) => put('kv', value, key);

// ---- Usage -----------------------------------------------------------------------------------
/** Per-game byte counts: { [gameId]: { rom, saves, states, art } } */
export async function usageByGame() {
  const out = {};
  const slot = (id) => (out[id] ||= { rom: 0, saves: 0, states: 0, art: 0 });
  await run(['roms', 'art', 'saves', 'states'], 'readonly', (tx) => {
    const walk = (store, fn) => {
      const cur = tx.objectStore(store).openCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c) return; fn(c.key, c.value); c.continue(); };
    };
    walk('roms', (key, blob) => { slot(key).rom += (blob && blob.size) || 0; });
    walk('art', (key, blob) => { slot(key).art += (blob && blob.size) || 0; });
    walk('saves', (key, rec) => { for (const d of Object.values((rec && rec.files) || {})) slot(key).saves += d.byteLength || 0; });
    const size = (x) => (x ? (x.size ?? x.byteLength ?? 0) : 0);
    walk('states', (key, rec) => { slot(rec.gameId).states += size(rec.data) + size(rec.thumb); });
  });
  return out;
}

export async function storageEstimate() {
  const out = { usage: null, quota: null, persisted: null, canPersist: false };
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      out.usage = e.usage ?? null;
      out.quota = e.quota ?? null;
    }
    if (navigator.storage && navigator.storage.persisted) {
      out.persisted = await navigator.storage.persisted();
      out.canPersist = typeof navigator.storage.persist === 'function';
    }
  } catch { /* estimate is best effort */ }
  return out;
}

/** Asks the browser not to evict our data. Resolves true/false, or null when the API is missing. */
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}
