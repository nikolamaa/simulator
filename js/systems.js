// Systems, the emulator cores that run them, and game-file checks.

export const SYSTEMS = {
  gb: { id: 'gb', badge: 'GB', family: 'gb', cores: ['gambatte', 'mgba'], width: 160, height: 144, buttons: ['a', 'b'] },
  gbc: { id: 'gbc', badge: 'GBC', family: 'gb', cores: ['gambatte', 'mgba'], width: 160, height: 144, buttons: ['a', 'b'] },
  gba: { id: 'gba', badge: 'GBA', family: 'gba', cores: ['mgba'], width: 240, height: 160, buttons: ['a', 'b', 'l', 'r'] },
  nds: { id: 'nds', badge: 'NDS', family: 'nds', cores: ['melonds', 'desmume2015'], width: 256, height: 384, buttons: ['a', 'b', 'x', 'y', 'l', 'r'] },
};

// saveDir / saveExt: where each core keeps its battery save inside the emulator's save folder
// (checked against EmulatorJS 4.2.3). rewind: save states are small enough to buffer ten seconds.
// linger: how long (ms) the game is kept running out of sight after you leave, so a save the
// core has not written out yet is still caught. melonDS writes its file about five seconds after
// the game saves; mGBA holds a save back for a few frames when a save state was loaded earlier.
export const CORES = {
  gambatte: { label: 'Gambatte', saveDir: 'Gambatte', saveExt: 'srm', rewind: true, linger: 0 },
  mgba: { label: 'mGBA', saveDir: 'mGBA', saveExt: 'srm', rewind: true, linger: 600 },
  melonds: { label: 'melonDS', saveDir: 'melonDS', saveExt: 'sav', rewind: false, linger: 6000 },
  desmume2015: { label: 'DeSmuME 2015', saveDir: 'DeSmuME 2015', saveExt: 'dsv', rewind: false, linger: 1500 },
};

export const ROM_EXTENSIONS = ['gb', 'gbc', 'gba', 'nds'];
export const SAVE_EXTENSIONS = ['sav', 'srm', 'dsv'];

export const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
export const systemForFile = (name) => (ROM_EXTENSIONS.includes(extOf(name)) ? extOf(name) : null);

export function coreFor(system, prefs) {
  const sys = SYSTEMS[system];
  const wanted = prefs && prefs.cores && prefs.cores[system];
  return sys.cores.includes(wanted) ? wanted : sys.cores[0];
}

export const primarySavePath = (core, gameId) => `${CORES[core].saveDir}/${gameId}.${CORES[core].saveExt}`;

/** "My_Game (USA) (Rev 1) [!].gba" -> "My Game" */
export function titleFromFile(name) {
  let t = String(name).replace(/\.[a-z0-9]+$/i, '');
  t = t.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '');
  t = t.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || String(name);
}

const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Looks at the first bytes of a file. Returns { ok:false, reason } for files that cannot be games,
 *  or { ok:true, warning? } when the header looks unusual but the file may still run. */
export function inspectRom(system, bytes) {
  const n = bytes.length;
  if (n >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return { ok: false, reason: 'is a zip archive. Unzip it and add the game file inside.' };
  if (n >= 6 && bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf) return { ok: false, reason: 'is a 7z archive. Extract it and add the game file inside.' };
  if (n >= 4 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) return { ok: false, reason: 'is a rar archive. Extract it and add the game file inside.' };
  if (n < 512) return { ok: false, reason: 'is too small to be a game.' };
  let blank = true;
  for (let i = 0; i < 512; i++) if (bytes[i] !== 0 && bytes[i] !== 0xff) { blank = false; break; }
  if (blank) return { ok: false, reason: 'is empty or damaged (its header is blank).' };

  if (system === 'gb' || system === 'gbc') {
    let x = 0;
    for (let i = 0x134; i < 0x14d; i++) x = (x - bytes[i] - 1) & 0xff;
    if (x !== bytes[0x14d]) return { ok: true, warning: 'its header checksum is off, so it may be damaged' };
  } else if (system === 'gba') {
    if (bytes[0xb2] !== 0x96 && bytes[3] !== 0xea) return { ok: true, warning: 'it does not have the usual GBA header' };
  } else if (system === 'nds') {
    const arm9 = u32(bytes, 0x20);
    const size = u32(bytes, 0x2c);
    if (!arm9 || arm9 + size > n) return { ok: true, warning: 'its header points outside the file, so it may be cut short' };
  }
  return { ok: true };
}

// DeSmuME appends a text footer to its .dsv saves; everything before it is the raw save.
const DSV_MARK = '|<--Snip above here to create a raw sav';
export function stripDsvFooter(bytes) {
  const mark = new TextEncoder().encode(DSV_MARK);
  const from = Math.max(0, bytes.length - 400);
  outer: for (let i = bytes.length - mark.length; i >= from; i--) {
    for (let j = 0; j < mark.length; j++) if (bytes[i + j] !== mark[j]) continue outer;
    return bytes.slice(0, i);
  }
  return bytes;
}

/** The files to place in the core's save folder before boot, given what is stored for the game. */
export function savesForCore(rec, core, gameId) {
  const out = {};
  const files = (rec && rec.files) || {};
  const dir = CORES[core].saveDir + '/';
  for (const [path, data] of Object.entries(files)) if (path.startsWith(dir)) out[path] = data;
  if (Object.keys(out).length) return out;
  // No save for this core yet: carry over the save made with another core for the same system.
  for (const [path, data] of Object.entries(files)) {
    const m = path.match(/^[^/]+\/[^/]+\.(srm|sav|dsv)$/);
    if (!m || !data || !data.length) continue;
    out[primarySavePath(core, gameId)] = m[1] === 'dsv' ? stripDsvFooter(data) : data;
    break;
  }
  return out;
}

/** The main battery save stored for a game, whichever core wrote it. */
export function mainSave(rec, core, gameId) {
  const files = (rec && rec.files) || {};
  const own = files[primarySavePath(core, gameId)];
  if (own && own.length) return own;
  for (const [path, data] of Object.entries(files)) {
    if (/\.(srm|sav|dsv)$/.test(path) && data && data.length) return /\.dsv$/.test(path) ? stripDsvFooter(data) : data;
  }
  return null;
}
