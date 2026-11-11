// User settings, kept in IndexedDB (kv: "settings").
import { getKV, setKV } from './store.js';
import { bus } from './util.js';

export const DEFAULT_PREFS = {
  filter: 'none',        // none | lcd | smooth
  aspect: 'original',    // original | stretch | integer
  volume: 0.8,
  muted: false,
  rewind: true,
  ffSpeed: 3,            // 2 | 3 | 4 | 0 (as fast as possible)
  cores: { gb: 'gambatte', gbc: 'gambatte', gba: 'mgba', nds: 'melonds' },
  ndsTouch: 'direct',    // direct | capture (lock the mouse to the game)
  touchMode: 'auto',     // auto | always | never
  touchOpacity: 0.6,
  haptics: true,
  sort: 'recent',        // recent | title | system | added
};

let prefs = structuredClone(DEFAULT_PREFS);

export async function loadPrefs() {
  try {
    const saved = await getKV('settings');
    if (saved && typeof saved === 'object') {
      prefs = { ...DEFAULT_PREFS, ...saved, cores: { ...DEFAULT_PREFS.cores, ...(saved.cores || {}) } };
    }
  } catch (e) { console.warn('Longplay: settings could not be read, using defaults', e); }
  return prefs;
}

export const getPrefs = () => prefs;

export async function setPrefs(patch) {
  prefs = { ...prefs, ...patch, cores: { ...prefs.cores, ...(patch.cores || {}) } };
  bus.emit('prefs', prefs);
  try { await setKV('settings', prefs); } catch (e) { bus.emit('storage-error', e); }
  return prefs;
}
