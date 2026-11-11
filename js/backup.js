// One-file backup of everything except the game files: in-game saves, save states (with their
// thumbnails), notes, finished marks, release dates, box art, playthrough order and settings.
import { zip, unzip, strToU8, strFromU8 } from '../vendor/fflate.js';
import { h, toast, confirmDialog, downloadBlob, safeName, gzip, asBlob, bus } from './util.js';
import * as store from './store.js';
import { SYSTEMS } from './systems.js';
import { setPrefs } from './prefs.js';
import * as input from './input.js';
import * as player from './player.js';

const FORMAT = 'longplay-backup';
const VERSION = 1;
const MANIFEST = 'longplay-backup.json';

const README = `Longplay backup
===============

This archive holds your progress, not your games.

  longplay-backup.json   what belongs to which game, plus notes, dates and settings
  saves/<game>/...       in-game (battery) saves, exactly as the emulator core wrote them.
                         .srm and .sav files are plain saves that other emulators can read.
  states/<game>/...      save states (auto.state, slot-01.state ...) and their thumbnails.
                         A state only loads in the core that made it.
  art/                   box art you uploaded

To restore: open Longplay, go to Settings, choose "Import backup" and pick this file.
Then add your game files again; each one reconnects to its saves automatically.
`;

const zipAsync = (files) => new Promise((res, rej) => zip(files, { level: 6 }, (err, data) => (err ? rej(err) : res(data))));
const unzipAsync = (bytes) => new Promise((res, rej) => unzip(bytes, (err, data) => (err ? rej(err) : res(data))));
const safeRel = (p) => typeof p === 'string' && p.length > 0 && p.length < 200 && !p.includes('..') && !p.startsWith('/') && !/[\\\u0000-\u001f]/.test(p);

export async function exportBackup() {
  try {
    await player.finishLinger();
    const [games, order, lastPlayed, settings, controls, touch] = await Promise.all([
      store.listGames(), store.getKV('order', null), store.getKV('lastPlayed', null),
      store.getKV('settings', null), store.getKV('controls', null), store.getKV('touch', null),
    ]);
    if (!games.length) { toast('There is nothing to back up yet. Add and play a game first.'); return false; }
    const files = { 'README.txt': strToU8(README) };
    const manifest = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), games: [], order, lastPlayed, settings, controls, touch };
    let saveCount = 0;
    let stateCount = 0;
    for (const g of games) {
      const folder = `${safeName(g.title)} [${g.id.slice(0, 8)}]`;
      const { hasRom, ...meta } = g;
      const entry = { ...meta, folder, saves: [], states: [], art: null };
      const rec = await store.getSaves(g.id);
      for (const [path, data] of Object.entries((rec && rec.files) || {})) {
        if (!data || !data.length) continue;
        const file = `saves/${folder}/${path}`;
        files[file] = new Uint8Array(data);
        entry.saves.push({ path, file });
        saveCount++;
      }
      for (const st of await store.listStates(g.id)) {
        const name = st.slot === 0 ? 'auto' : `slot-${String(st.slot).padStart(2, '0')}`;
        const file = `states/${folder}/${name}.state`;
        files[file] = await player.unpackState(st);
        let thumb = null;
        if (st.thumb) {
          thumb = `states/${folder}/${name}.png`;
          files[thumb] = [new Uint8Array(await asBlob(st.thumb).arrayBuffer()), { level: 0 }];
        }
        entry.states.push({ slot: st.slot, file, thumb, createdAt: st.createdAt, playTimeMs: st.playTimeMs, core: st.core });
        stateCount++;
      }
      if (g.hasArt) {
        const blob = await store.getArt(g.id);
        if (blob) {
          const ext = { 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type] || 'webp';
          entry.art = `art/${folder}.${ext}`;
          entry.artType = blob.type || 'image/webp';
          files[entry.art] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
        }
      }
      manifest.games.push(entry);
    }
    files[MANIFEST] = strToU8(JSON.stringify(manifest, null, 2));
    const zipped = await zipAsync(files);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([zipped], { type: 'application/zip' }), `longplay-backup-${stamp}.zip`);
    toast(`Backup saved: ${games.length} ${games.length === 1 ? 'game' : 'games'}, ${saveCount} in-game ${saveCount === 1 ? 'save' : 'saves'}, ${stateCount} save ${stateCount === 1 ? 'state' : 'states'}.`, { ttl: 6000 });
    try { await store.setKV('lastBackupAt', Date.now()); } catch { /* not important */ }
    bus.emit('storage');
    return true;
  } catch (e) {
    console.error(e);
    toast(`The backup could not be made: ${e.message}`, { kind: 'error' });
    return false;
  }
}

export async function importBackup(file) {
  let entries;
  try {
    entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    toast(`“${file.name}” is not a zip file Longplay can read. It may be damaged.`, { kind: 'error' });
    return false;
  }
  let manifest = null;
  try { manifest = entries[MANIFEST] ? JSON.parse(strFromU8(entries[MANIFEST])) : null; } catch { manifest = null; }
  if (!manifest || manifest.format !== FORMAT || !Array.isArray(manifest.games)) {
    toast(`“${file.name}” is not a Longplay backup. To add games, unzip it and add the game files inside.`, { kind: 'error', ttl: 9000 });
    return false;
  }
  if (manifest.version > VERSION) {
    toast('That backup was made by a newer version of Longplay. Update this copy, then import it.', { kind: 'error' });
    return false;
  }
  const list = manifest.games.filter((e) => e && /^[0-9a-f]{16}$/.test(e.id) && SYSTEMS[e.system]);
  let existing;
  try { existing = new Map((await store.listGames()).map((g) => [g.id, g])); } catch (e) { toast(e.message, { kind: 'error' }); return false; }
  const known = list.filter((e) => existing.has(e.id)).length;
  const withSettings = h('input', { type: 'checkbox', checked: true });
  const ok = await confirmDialog({
    title: 'Import this backup?',
    message: h('div', { class: 'stack' },
      h('p', {}, `It holds progress for ${list.length} ${list.length === 1 ? 'game' : 'games'}${manifest.exportedAt ? `, saved on ${new Date(manifest.exportedAt).toLocaleDateString()}` : ''}. ${known} ${known === 1 ? 'is' : 'are'} already in your library.`),
      h('p', { class: 'dim' }, 'For those games, the in-game saves, save states, notes and finished marks in the backup replace what is here now. Games that are not in your library yet appear on the shelf waiting for their file.'),
      h('label', { class: 'check' }, withSettings, h('span', {}, 'Also bring over settings, controls and playthrough order'))),
    confirmLabel: 'Import backup',
  });
  if (!ok) return false;

  let done = 0;
  let missing = 0;
  try {
    await player.stop();
    await player.finishLinger();
    for (const e of list) {
      const cur = existing.get(e.id);
      const game = {
        id: e.id, system: e.system,
        title: String(e.title || (cur && cur.title) || 'Untitled').slice(0, 120),
        fileName: String(e.fileName || (cur && cur.fileName) || ''),
        size: (cur && cur.size) || e.size || 0,
        addedAt: (cur && cur.addedAt) || e.addedAt || Date.now(),
        lastPlayedAt: Math.max((cur && cur.lastPlayedAt) || 0, e.lastPlayedAt || 0),
        playTimeMs: Math.max((cur && cur.playTimeMs) || 0, e.playTimeMs || 0),
        completed: !!e.completed, completedAt: e.completedAt || 0,
        notes: typeof e.notes === 'string' ? e.notes : (cur && cur.notes) || '',
        release: typeof e.release === 'string' ? e.release : (cur && cur.release) || '',
        releaseAuto: !!e.releaseAuto,
        hasRom: !!(cur && cur.hasRom), hasArt: !!(cur && cur.hasArt),
      };
      const files = {};
      for (const s of e.saves || []) if (s && safeRel(s.path) && entries[s.file]) files[s.path] = entries[s.file];
      if (Object.keys(files).length) await store.putSaves({ gameId: e.id, files, updatedAt: Date.now(), core: null });
      for (const st of e.states || []) {
        const raw = st && entries[st.file];
        if (!raw || !Number.isInteger(st.slot) || st.slot < 0 || st.slot > 10) continue;
        await store.putState({
          gameId: e.id, slot: st.slot, data: await gzip(raw), gz: true, rawSize: raw.length,
          thumb: st.thumb && entries[st.thumb] ? new Blob([entries[st.thumb]], { type: 'image/png' }) : null,
          createdAt: st.createdAt || Date.now(), playTimeMs: st.playTimeMs || 0, core: st.core || null,
        });
      }
      if (e.art && entries[e.art]) {
        await store.putArt(e.id, new Blob([entries[e.art]], { type: e.artType || 'image/webp' }));
        game.hasArt = true;
      }
      await store.putGame(game);
      done++;
      if (!game.hasRom) missing++;
    }
    if (withSettings.checked) {
      if (Array.isArray(manifest.order)) await store.setKV('order', manifest.order.filter((id) => typeof id === 'string'));
      else if (manifest.order === null) await store.setKV('order', null);
      if (manifest.lastPlayed && !(await store.getKV('lastPlayed', null))) await store.setKV('lastPlayed', manifest.lastPlayed);
      if (manifest.settings && typeof manifest.settings === 'object') await setPrefs(manifest.settings);
      if (manifest.controls && typeof manifest.controls === 'object') { await store.setKV('controls', manifest.controls); await input.loadBindings(); }
      if (manifest.touch && typeof manifest.touch === 'object') await store.setKV('touch', manifest.touch);
    }
  } catch (e) {
    console.error(e);
    const why = e instanceof store.StorageError && e.kind === 'quota' ? 'Storage filled up' : `Something went wrong (${e.message})`;
    toast(`${why} after importing ${done} of ${list.length} games. Free some space and import the backup again; nothing is duplicated.`, { kind: 'error', ttl: 12000 });
    bus.emit('games');
    return false;
  }
  toast(`Imported progress for ${done} ${done === 1 ? 'game' : 'games'}.${missing ? ` Add the game ${missing === 1 ? 'file' : 'files'} for ${missing} of them to play.` : ''}`, { ttl: 7000 });
  bus.emit('games');
  bus.emit('storage');
  return true;
}
