// Library (cartridge shelf), chronological playthrough, and the per-game details sheet.
import { h, $, clear, icon, toast, bus, fmtDuration, fmtWhen, fmtBytes, hashBytes, openDialog, confirmDialog, pickFiles, debounce, asBlob } from './util.js';
import * as store from './store.js';
import { SYSTEMS, ROM_EXTENSIONS, SAVE_EXTENSIONS, extOf, systemForFile, titleFromFile, inspectRom, mainSave, coreFor } from './systems.js';
import { lookupRelease, releaseKey, releaseLabel, squash } from './releases.js';
import { getPrefs, setPrefs } from './prefs.js';
import * as player from './player.js';
import { importSaveFile, exportSaveFile } from './saves.js';

let games = [];
let order = null;          // hand-arranged playthrough order (array of ids), or null for release order
let lastPlayed = null;
let active = 'library';
const artUrls = new Map(); // gameId -> object URL
let bannerUrl = null;

export const getGames = () => games;
const byId = (id) => games.find((g) => g.id === id);
const playHash = (id, fresh) => `#/play/${id}${fresh ? '?fresh=1' : ''}`;
export const startGame = (id, fresh = false) => { location.hash = playHash(id, fresh); };

// ---- Data ------------------------------------------------------------------------------------
export async function reload() {
  try {
    [games, order, lastPlayed] = await Promise.all([store.listGames(), store.getKV('order', null), store.getKV('lastPlayed', null)]);
  } catch (e) {
    toast(e.message, { kind: 'error' });
    games = games || [];
  }
  if (Array.isArray(order)) order = order.filter((id) => byId(id)); else order = null;
}

async function saveGame(game, quiet) {
  try { await store.putGame(game); } catch (e) { toast(e.message, { kind: 'error' }); }
  if (!quiet) bus.emit('games');
}

function sortedForShelf() {
  const sort = getPrefs().sort;
  const list = games.slice();
  const title = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  if (sort === 'title') list.sort(title);
  else if (sort === 'system') list.sort((a, b) => ROM_EXTENSIONS.indexOf(a.system) - ROM_EXTENSIONS.indexOf(b.system) || title(a, b));
  else if (sort === 'added') list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  else list.sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0) || (b.addedAt || 0) - (a.addedAt || 0));
  return list;
}

export function playthroughOrder() {
  const chrono = (a, b) => releaseKey(a.release).localeCompare(releaseKey(b.release)) || a.title.localeCompare(b.title, undefined, { numeric: true });
  if (!order) return games.slice().sort(chrono);
  const list = order.map(byId).filter(Boolean);
  for (const g of games.slice().sort(chrono)) {
    if (order.includes(g.id)) continue;
    const at = list.findIndex((x) => releaseKey(x.release) > releaseKey(g.release));
    if (at < 0) list.push(g); else list.splice(at, 0, g);
  }
  return list;
}

async function setOrder(ids) {
  order = ids;
  try { await store.setKV('order', ids); } catch (e) { toast(e.message, { kind: 'error' }); }
}

// ---- Label art -------------------------------------------------------------------------------
// Games without a picture get their own dot-matrix sprite, drawn from the game's ID.
function sprite(id) {
  let seed = parseInt(id.slice(0, 8), 16) || 1;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 11 11');
  svg.setAttribute('class', 'sprite');
  svg.setAttribute('aria-hidden', 'true');
  let cells = '';
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 4; x++) {
      const edge = x === 0 || y === 0 || y === 6;
      if (rnd() > (edge ? 0.42 : 0.62)) continue;
      const tone = rnd() < 0.24 ? 'sprite__mid' : 'sprite__ink';
      cells += `<rect class="${tone}" x="${2 + x}" y="${2 + y}" width="0.92" height="0.92"/>`;
      if (x < 3) cells += `<rect class="${tone}" x="${8 - x}" y="${2 + y}" width="0.92" height="0.92"/>`;
    }
  }
  svg.innerHTML = cells;
  return svg;
}

function labelArt(game) {
  const box = h('div', { class: 'label' }, sprite(game.id));
  if (game.hasArt) {
    const show = (url) => box.replaceChildren(h('img', { class: 'label__img', src: url, alt: '' }));
    if (artUrls.has(game.id)) show(artUrls.get(game.id));
    else store.getArt(game.id).then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      artUrls.set(game.id, url);
      show(url);
    }).catch(() => {});
  }
  return box;
}

function dropArtUrl(id) {
  const u = artUrls.get(id);
  if (u) URL.revokeObjectURL(u);
  artUrls.delete(id);
}

async function chooseArt(game) {
  const [file] = await pickFiles({ accept: 'image/*' });
  if (!file) return false;
  if (!/^image\//.test(file.type)) { toast('Choose an image file (PNG, JPEG or WebP).', { kind: 'error' }); return false; }
  try {
    // Scale large pictures down so a shelf of them stays quick and small.
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.86));
    await store.putArt(game.id, blob || file);
  } catch (e) {
    if (e instanceof store.StorageError) { toast(e.message, { kind: 'error' }); return false; }
    toast('That picture could not be read. Try a PNG or JPEG.', { kind: 'error' });
    return false;
  }
  dropArtUrl(game.id);
  game.hasArt = true;
  await saveGame(game);
  return true;
}

// ---- Adding games ----------------------------------------------------------------------------
export async function chooseGames() {
  const files = await pickFiles({ accept: ROM_EXTENSIONS.map((e) => '.' + e).join(','), multiple: true });
  if (files.length) await addFiles(files);
}

export async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  let added = 0;
  let lastTitle = '';
  for (const file of files) {
    const ext = extOf(file.name);
    const system = systemForFile(file.name);
    if (!system) {
      if (SAVE_EXTENSIONS.includes(ext)) { await offerSave(file); continue; }
      if (ext === 'zip') { bus.emit('backup-file', file); continue; }
      toast(`“${file.name}” was skipped. Longplay plays .gb, .gbc, .gba and .nds files.`, { kind: 'error' });
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const check = inspectRom(system, bytes);
      if (!check.ok) { toast(`“${file.name}” ${check.reason}`, { kind: 'error' }); continue; }
      const id = hashBytes(bytes);
      const existing = byId(id) || (await store.getGame(id));
      if (existing && existing.hasRom) { toast(`“${existing.title}” is already in your library.`); continue; }
      const release = lookupRelease(system, file.name);
      const game = existing
        ? { ...existing, hasRom: true, size: file.size, fileName: file.name }
        : {
          id, title: titleFromFile(file.name), fileName: file.name, system, size: file.size,
          addedAt: Date.now(), lastPlayedAt: 0, playTimeMs: 0, completed: false, completedAt: 0,
          notes: '', release, releaseAuto: !!release, hasRom: true, hasArt: false,
        };
      await store.addGame(game, new Blob([bytes], { type: 'application/octet-stream' }));
      added++;
      lastTitle = game.title;
      if (check.warning) toast(`Added “${game.title}”, but ${check.warning}.`, { ttl: 7000 });
    } catch (e) {
      if (e instanceof store.StorageError) {
        toast(e.kind === 'quota' ? `There is no room left to store “${file.name}”. Free space in Settings, under Storage.` : e.message, { kind: 'error' });
        if (e.kind === 'quota') break;
      } else toast(`“${file.name}” could not be read (${e.message}).`, { kind: 'error' });
    }
  }
  if (added) {
    toast(added === 1 ? `Added “${lastTitle}”.` : `Added ${added} games.`);
    store.requestPersistence().then(() => bus.emit('storage'));
    bus.emit('games');
  }
}

async function offerSave(file) {
  const key = squash(file.name);
  const matches = games.filter((g) => squash(g.fileName) === key || squash(g.title) === key);
  if (matches.length !== 1) {
    toast(`To use “${file.name}”, open the game it belongs to and choose Import save file.`, { ttl: 7000 });
    return;
  }
  await importSaveFile(matches[0], file);
}

// ---- Library view ----------------------------------------------------------------------------
function badge(system) { return h('span', { class: `badge badge--${system}` }, SYSTEMS[system].badge); }

function finishedBox(game) {
  const box = h('input', { type: 'checkbox', checked: !!game.completed });
  box.addEventListener('change', async () => {
    game.completed = box.checked;
    game.completedAt = box.checked ? Date.now() : 0;
    await saveGame(game);
  });
  return h('label', { class: 'check' }, box, h('span', {}, 'Finished'));
}

function card(game) {
  const played = game.playTimeMs > 0 || game.lastPlayedAt > 0;
  const playLabel = !game.hasRom ? `Add the game file for ${game.title}` : `${played ? 'Resume' : 'Play'} ${game.title}`;
  const label = h('button', { class: 'cart__label', type: 'button', 'aria-label': playLabel, title: playLabel,
    onclick: () => (game.hasRom ? startGame(game.id) : chooseGames()) },
    labelArt(game),
    h('span', { class: 'cart__go' }, icon(game.hasRom ? 'play' : 'plus', 26)));
  return h('article', { class: `cart cart--${game.system}${game.completed ? ' is-finished' : ''}${game.hasRom ? '' : ' is-missing'}`, dataset: { id: game.id } },
    h('div', { class: 'cart__shell' }, label, game.completed ? h('span', { class: 'cart__stamp' }, icon('check', 14), 'Finished') : null),
    h('div', { class: 'cart__meta' },
      h('h3', { class: 'cart__title' }, game.title),
      h('p', { class: 'cart__line' }, badge(game.system), h('span', {}, game.playTimeMs ? `${fmtDuration(game.playTimeMs)} played` : 'Not played yet')),
      h('p', { class: 'cart__line dim' }, game.hasRom ? `Last played ${fmtWhen(game.lastPlayedAt)}` : 'Game file needed'),
      h('div', { class: 'cart__foot' }, finishedBox(game),
        h('button', { class: 'iconbtn iconbtn--small', type: 'button', 'aria-label': `Details for ${game.title}`, title: 'Details, notes and saves', onclick: () => openDetails(game.id) }, icon('dots', 18)))));
}

async function continueBanner() {
  const game = lastPlayed && byId(lastPlayed);
  if (!game || !game.hasRom) return null;
  let pic = labelArt(game);
  try {
    const st = await store.getState(game.id, 0);
    if (st && st.thumb) {
      if (bannerUrl) URL.revokeObjectURL(bannerUrl);
      bannerUrl = URL.createObjectURL(asBlob(st.thumb));
      pic = h('img', { class: 'resume__shot', src: bannerUrl, alt: '' });
    }
  } catch { /* fall back to the label */ }
  return h('section', { class: 'resume', 'aria-label': 'Continue playing' },
    h('div', { class: `resume__screen resume__screen--${game.system}` }, pic),
    h('div', { class: 'resume__text' },
      h('p', { class: 'resume__kicker' }, `Last played ${fmtWhen(game.lastPlayedAt)}`),
      h('h2', { class: 'resume__title' }, game.title),
      h('p', { class: 'resume__line' }, badge(game.system), h('span', {}, `Play time ${fmtDuration(game.playTimeMs)}`))),
    h('button', { class: 'btn btn--primary btn--big', type: 'button', id: 'continue-main', onclick: () => startGame(game.id) }, icon('play', 20), 'Continue'));
}

async function renderLibrary() {
  const view = $('#view-library');
  const sort = getPrefs().sort;
  const sortSel = h('select', { class: 'select', 'aria-label': 'Sort games', onchange: (e) => setPrefs({ sort: e.target.value }).then(render) },
    [['recent', 'Recently played'], ['title', 'Title'], ['system', 'System'], ['added', 'Recently added']].map(([v, t]) => h('option', { value: v, selected: v === sort }, t)));
  const head = h('header', { class: 'viewhead' },
    h('div', {}, h('h1', { class: 'viewhead__title' }, 'Library'),
      h('p', { class: 'viewhead__sub' }, games.length ? `${games.length} ${games.length === 1 ? 'game' : 'games'}, ${fmtDuration(games.reduce((n, g) => n + (g.playTimeMs || 0), 0))} played` : 'Your games live in this browser. Nothing is uploaded.')),
    h('div', { class: 'viewhead__acts' }, games.length > 1 ? sortSel : null,
      h('button', { class: 'btn btn--primary', type: 'button', id: 'add-games', onclick: chooseGames }, icon('plus', 18), 'Add games')));
  if (!games.length) {
    view.replaceChildren(head, h('div', { class: 'empty' },
      h('div', { class: 'empty__slot' }, sprite('5eedc0de')),
      h('h2', {}, 'Add your first game'),
      h('p', {}, 'Drop .gb, .gbc, .gba or .nds files anywhere on this page, or choose them. Each file is stored in this browser, so you only add it once.'),
      h('button', { class: 'btn btn--primary btn--big', type: 'button', onclick: chooseGames }, icon('plus', 20), 'Choose game files')));
    return;
  }
  const banner = await continueBanner();
  view.replaceChildren(head, banner || '', h('div', { class: 'shelf' }, sortedForShelf().map(card)));
}

// ---- Playthrough view ------------------------------------------------------------------------
function editRelease(game) {
  const field = h('input', { class: 'input', type: 'text', value: game.release || '', placeholder: 'e.g. 2004 or 2004-01-29', inputMode: 'numeric', 'aria-label': 'Release date' });
  const suggestion = lookupRelease(game.system, game.fileName, game.title);
  const err = h('p', { class: 'field__err', hidden: true }, 'Use a year (2004), a month (2004-01) or a full date (2004-01-29).');
  openDialog({
    title: `Release date for “${game.title}”`,
    body: h('div', { class: 'stack' },
      h('p', { class: 'dim' }, 'The playthrough is ordered by first release anywhere in the world. Leave it blank to put the game at the end.'),
      field, err,
      suggestion && suggestion !== game.release ? h('button', { class: 'btn btn--small', type: 'button', onclick: () => { field.value = suggestion; } }, `Use the built-in date: ${releaseLabel(suggestion)}`) : null),
    actions: [
      { label: 'Cancel' },
      { label: 'Save date', primary: true, run: async () => {
        const v = field.value.trim();
        if (v && !/^(19[7-9]\d|20[0-4]\d)(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(v)) { err.hidden = false; field.focus(); return false; }
        game.release = v;
        game.releaseAuto = !!v && v === suggestion;
        await saveGame(game);
        return true;
      } },
    ],
  });
  setTimeout(() => field.focus(), 30);
}

function renderPlaythrough() {
  const view = $('#view-playthrough');
  const list = playthroughOrder();
  const done = list.filter((g) => g.completed).length;
  const next = list.find((g) => !g.completed);
  const head = h('header', { class: 'viewhead' },
    h('div', {}, h('h1', { class: 'viewhead__title' }, 'Playthrough'),
      h('p', { class: 'viewhead__sub' }, order ? 'In the order you arranged by hand.' : 'In order of first release, oldest first.')),
    h('div', { class: 'viewhead__acts' },
      order ? h('button', { class: 'btn', type: 'button', onclick: async () => { await setOrder(null); render(); } }, 'Sort by release date') : null));
  if (!list.length) {
    view.replaceChildren(head, h('div', { class: 'empty' }, h('h2', {}, 'Nothing to play through yet'),
      h('p', {}, 'Add games in the library and they line up here by release date.'),
      h('a', { class: 'btn btn--primary', href: '#/library' }, 'Go to the library')));
    return;
  }
  const progress = h('section', { class: 'progress', 'aria-label': 'Progress' },
    h('div', { class: 'progress__text' },
      h('strong', {}, `${done} of ${list.length} finished`),
      next ? h('span', {}, 'Up next: ', h('b', {}, next.title)) : h('span', {}, 'Every game here is finished.')),
    h('div', { class: 'progress__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(list.length), 'aria-valuenow': String(done) },
      list.map((g) => h('i', { class: g.completed ? 'is-done' : g === next ? 'is-next' : '' }))),
    next && next.hasRom ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => startGame(next.id) }, icon('play', 18), next.playTimeMs ? 'Resume it' : 'Start it') : null);

  const ol = h('ol', { class: 'legs' });
  list.forEach((game, i) => {
    const status = game.completed ? 'Finished' : !game.hasRom ? 'Game file needed' : game === next ? 'Up next' : '';
    const grip = h('button', { class: 'leg__grip', type: 'button', 'aria-label': `Move ${game.title}. Drag, or use the up and down arrow keys.`, title: 'Drag to reorder' }, icon('grip', 18));
    const li = h('li', { class: `leg${game.completed ? ' is-done' : ''}${game === next ? ' is-next' : ''}`, dataset: { id: game.id } },
      grip,
      h('span', { class: 'leg__num' }, String(i + 1)),
      h('button', { class: `leg__date${game.release ? '' : ' leg__date--unset'}`, type: 'button', title: 'Change the release date', onclick: () => editRelease(game) }, game.release ? releaseLabel(game.release) : 'Set date'),
      h('div', { class: 'leg__main' },
        h('span', { class: 'leg__title' }, game.title),
        h('span', { class: 'leg__sub' }, badge(game.system), game.playTimeMs ? h('span', {}, fmtDuration(game.playTimeMs)) : null, status ? h('span', { class: 'leg__status' }, status) : null)),
      finishedBox(game),
      h('button', { class: 'iconbtn iconbtn--small', type: 'button', 'aria-label': `Details for ${game.title}`, onclick: () => openDetails(game.id) }, icon('dots', 18)),
      game.hasRom
        ? h('button', { class: `btn btn--small${game === next ? ' btn--primary' : ''}`, type: 'button', onclick: () => startGame(game.id) }, game.playTimeMs ? 'Resume' : 'Play')
        : h('button', { class: 'btn btn--small', type: 'button', onclick: chooseGames }, 'Add file'));
    wireDrag(grip, li, ol);
    ol.append(li);
  });
  view.replaceChildren(head, progress, ol);
}

function wireDrag(grip, li, ol) {
  const commit = async () => {
    await setOrder(Array.from(ol.children).map((el) => el.dataset.id));
    render();
  };
  grip.addEventListener('keydown', async (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const sib = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
    if (!sib) return;
    if (e.key === 'ArrowUp') ol.insertBefore(li, sib); else ol.insertBefore(sib, li);
    const id = li.dataset.id;
    await commit();
    const again = $(`.leg[data-id="${id}"] .leg__grip`);
    if (again) again.focus();
  });
  grip.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    li.classList.add('is-dragging');
    let moved = false;
    // Listen on the window: moving the row in the list would drop a pointer capture on the handle.
    const move = (ev) => {
      ev.preventDefault();
      let again = true;
      while (again) {
        again = false;
        const prev = li.previousElementSibling;
        const next = li.nextElementSibling;
        if (prev) {
          const r = prev.getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) { ol.insertBefore(li, prev); moved = again = true; continue; }
        }
        if (next) {
          const r = next.getBoundingClientRect();
          if (ev.clientY > r.top + r.height / 2) { ol.insertBefore(next, li); moved = again = true; }
        }
      }
      const edge = 70;
      if (ev.clientY < edge) window.scrollBy(0, -14); else if (ev.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      li.classList.remove('is-dragging');
      if (moved) commit();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

// ---- Details sheet ---------------------------------------------------------------------------
export async function openDetails(id) {
  const game = byId(id);
  if (!game) return;
  let saveRec = null;
  let states = [];
  try { [saveRec, states] = await Promise.all([store.getSaves(id), store.listStates(id)]); } catch (e) { toast(e.message, { kind: 'error' }); }
  const hasSave = !!mainSave(saveRec, coreFor(game.system, getPrefs()), id);
  const manual = states.filter((s) => s.slot !== 0).length;
  const auto = states.find((s) => s.slot === 0);
  let dlg;
  let gone = false; // set when the game is deleted from inside this sheet
  const persist = debounce(() => { if (!gone) saveGame(game, true); }, 350);

  const art = h('div', { class: 'detail__art' }, labelArt(game));
  const title = h('input', { class: 'input input--title', type: 'text', value: game.title, 'aria-label': 'Title', maxLength: 120 });
  title.addEventListener('input', () => { game.title = title.value.trim() || titleFromFile(game.fileName); persist(); });
  const notes = h('textarea', { class: 'input textarea', rows: '6', placeholder: 'Team, where you left off, goals for next time', 'aria-label': 'Notes' }, game.notes || '');
  notes.addEventListener('input', () => { game.notes = notes.value; persist(); });
  const done = finishedBox(game);
  const dateBtn = h('button', { class: 'btn btn--small', type: 'button', onclick: () => { dlg.close(); editRelease(game); } }, game.release ? releaseLabel(game.release) : 'Set date');

  const body = h('div', { class: 'detail' },
    h('div', { class: 'detail__side' }, art,
      h('button', { class: 'btn btn--small', type: 'button', onclick: async () => { if (await chooseArt(game)) { dlg.close(); openDetails(id); } } }, icon('image', 16), game.hasArt ? 'Change picture' : 'Add box art'),
      game.hasArt ? h('button', { class: 'btn btn--small btn--quiet', type: 'button', onclick: async () => {
        try { await store.deleteArt(id); } catch (e) { toast(e.message, { kind: 'error' }); }
        dropArtUrl(id); game.hasArt = false; await saveGame(game); dlg.close(); openDetails(id);
      } }, 'Remove picture') : null),
    h('div', { class: 'detail__main' },
      title,
      h('p', { class: 'detail__file dim' }, badge(game.system), h('span', {}, game.fileName), game.hasRom ? h('span', {}, fmtBytes(game.size)) : h('span', { class: 'warn' }, 'Game file needed')),
      h('dl', { class: 'facts' },
        h('dt', {}, 'Play time'), h('dd', {}, game.playTimeMs ? fmtDuration(game.playTimeMs) : 'Not played yet'),
        h('dt', {}, 'Last played'), h('dd', {}, fmtWhen(game.lastPlayedAt)),
        h('dt', {}, 'First released'), h('dd', {}, dateBtn),
        h('dt', {}, 'Status'), h('dd', {}, done)),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Notes'), notes),
      h('section', { class: 'detail__box' },
        h('h3', {}, 'Saves'),
        h('p', { class: 'dim' }, hasSave ? `In-game save stored${saveRec && saveRec.updatedAt ? `, updated ${fmtWhen(saveRec.updatedAt)}` : ''}.` : 'No in-game save yet.',
          ' ', auto ? `Auto-save from ${fmtWhen(auto.createdAt)}.` : '', ' ', manual ? `${manual} manual ${manual === 1 ? 'slot' : 'slots'} used.` : ''),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn--small', type: 'button', onclick: async () => {
            const [file] = await pickFiles({ accept: '.sav,.srm,.dsv' });
            if (file && await importSaveFile(game, file)) { dlg.close(); bus.emit('games'); }
          } }, icon('upload', 16), 'Import save file'),
          h('button', { class: 'btn btn--small', type: 'button', disabled: !hasSave, onclick: () => exportSaveFile(game) }, icon('download', 16), 'Export save file'),
          states.length ? h('button', { class: 'btn btn--small btn--quiet', type: 'button', onclick: async () => {
            if (!await confirmDialog({ title: 'Delete all save states for this game?', message: 'The auto-save and every manual slot are deleted. The in-game save stays.', confirmLabel: 'Delete save states', danger: true })) return;
            try { await store.deleteStates(id); toast('Save states deleted.'); } catch (e) { toast(e.message, { kind: 'error' }); }
            dlg.close(); bus.emit('games');
          } }, 'Delete save states') : null)),
      h('section', { class: 'detail__box detail__box--danger' },
        h('h3', {}, 'Remove'),
        h('div', { class: 'row' },
          game.hasRom ? h('button', { class: 'btn btn--small btn--quiet', type: 'button', onclick: async () => {
            if (!await confirmDialog({ title: `Remove the file for “${game.title}”?`, message: 'The game file is deleted from this browser to free space. Saves, save states and notes stay, and come back to life when you add the same file again.', confirmLabel: 'Remove game file', danger: true })) return;
            try { await store.removeRom(id); game.hasRom = false; toast('Game file removed. Its saves are kept.'); } catch (e) { toast(e.message, { kind: 'error' }); }
            dlg.close(); bus.emit('storage');
          } }, 'Remove game file') : null,
          h('button', { class: 'btn btn--small btn--danger', type: 'button', onclick: async () => { if (await deleteGame(game)) { gone = true; dlg.close(); } } }, icon('trash', 16), 'Delete game and saves')))));

  dlg = openDialog({
    title: 'Game details', body, wide: true,
    actions: [
      game.hasRom && (auto || hasSave) ? { label: 'Restart from in-game save', run: () => { startGame(id, true); } } : null,
      game.hasRom ? { label: game.playTimeMs ? 'Resume' : 'Play', primary: true, run: () => { startGame(id); } } : { label: 'Add game file', primary: true, run: () => { chooseGames(); } },
    ].filter(Boolean),
    onClose: () => { if (!gone) saveGame(game); },
  });
}

export async function deleteGame(game) {
  const ok = await confirmDialog({
    title: `Delete “${game.title}” and everything saved for it?`,
    message: 'The game file, its in-game save, all save states, notes and picture are deleted from this browser. This cannot be undone. Export a backup first if you might want the saves later.',
    confirmLabel: 'Delete game and saves', danger: true,
  });
  if (!ok) return false;
  try {
    if (player.isPlaying(game.id)) await player.stop({ discard: true });
    await player.finishLinger();
    await store.deleteGame(game.id);
    if (lastPlayed === game.id) await store.setKV('lastPlayed', null);
    if (order) await setOrder(order.filter((x) => x !== game.id));
    dropArtUrl(game.id);
    toast(`Deleted “${game.title}”.`);
  } catch (e) {
    toast(e.message, { kind: 'error' });
    return false;
  }
  bus.emit('games');
  bus.emit('storage');
  return true;
}

// ---- Wiring ----------------------------------------------------------------------------------
export async function render() {
  if (active === 'library') await renderLibrary();
  else if (active === 'playthrough') renderPlaythrough();
  bus.emit('library-rendered', { games, lastPlayed });
}

export function setActive(name) { active = name; }

export function init() {
  bus.on('games', async () => { await reload(); await render(); });

  // Drop game files anywhere.
  const veil = $('#dropveil');
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; veil.hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    veil.hidden = true;
    if (player.isPlaying()) { toast('Return to the library to add games.'); return; }
    addFiles(e.dataTransfer.files);
  });
}
