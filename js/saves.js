// Importing and exporting plain battery saves (.sav / .srm / .dsv) for one game.
import { toast, confirmDialog, downloadBlob, safeName, h } from './util.js';
import * as store from './store.js';
import { CORES, coreFor, primarySavePath, mainSave, stripDsvFooter } from './systems.js';
import { getPrefs } from './prefs.js';
import * as player from './player.js';

const MAX_SAVE_BYTES = 34 * 1024 * 1024;

/** Replaces a game's in-game save with a file from another emulator. Returns true when imported. */
export async function importSaveFile(game, file) {
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { toast(`“${file.name}” could not be read.`, { kind: 'error' }); return false; }
  if (!bytes.length) { toast(`“${file.name}” is empty, so there is nothing to import.`, { kind: 'error' }); return false; }
  if (bytes.length > MAX_SAVE_BYTES) { toast(`“${file.name}” is too large to be an in-game save.`, { kind: 'error' }); return false; }
  bytes = stripDsvFooter(bytes);
  const ok = await confirmDialog({
    title: `Replace the in-game save for “${game.title}”?`,
    message: h('div', {},
      h('p', {}, `“${file.name}” becomes this game's in-game save, and the auto-save is cleared so the game boots from it.`),
      h('p', { class: 'dim' }, 'Manual save-state slots are kept, but each one still holds the old save from when it was made. Export a backup first if you are unsure.')),
    confirmLabel: 'Replace save', danger: true,
  });
  if (!ok) return false;
  const wasPlaying = player.isPlaying(game.id);
  try {
    if (wasPlaying) await player.stop({ discard: true });
    await player.finishLinger();
    const core = coreFor(game.system, getPrefs());
    const rec = (await store.getSaves(game.id)) || { gameId: game.id, files: {} };
    const dir = CORES[core].saveDir + '/';
    const files = {};
    for (const [p, d] of Object.entries(rec.files || {})) if (!p.startsWith(dir)) files[p] = d;
    files[primarySavePath(core, game.id)] = bytes;
    await store.putSaves({ gameId: game.id, files, updatedAt: Date.now(), core });
    await store.deleteState(game.id, 0);
  } catch (e) {
    toast(`The save could not be imported: ${e.message}`, { kind: 'error' });
    return false;
  }
  toast(`Imported the save for “${game.title}”.`);
  if (wasPlaying) player.play(game.id, { resume: false });
  return true;
}

export async function exportSaveFile(game) {
  try {
    const rec = await store.getSaves(game.id);
    const data = mainSave(rec, coreFor(game.system, getPrefs()), game.id);
    if (!data) { toast(`“${game.title}” has no in-game save yet. Save inside the game first.`); return false; }
    downloadBlob(new Blob([data], { type: 'application/octet-stream' }), `${safeName(game.title)}.sav`);
    return true;
  } catch (e) {
    toast(`The save could not be exported: ${e.message}`, { kind: 'error' });
    return false;
  }
}
