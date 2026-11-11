// The player: runs one game, and keeps its progress safe.
//
// Saving has three layers, all in IndexedDB:
//   1. Battery saves. Every 2 s the core's save folder is compared with the last copy; any change
//      is written straight to the "saves" store (the light in the top bar blinks).
//   2. The auto-save state (slot 0). Written every 60 s, right after any battery save, when you
//      leave the game, and when the tab is hidden or closed.
//   3. Ten manual save-state slots.
import { h, $, clear, icon, toast, bus, fmtDuration, fmtStamp, equalBytes, gzip, gzipNow, gunzip, asBlob, sleep } from './util.js';
import * as store from './store.js';
import { SYSTEMS, CORES, coreFor, savesForCore } from './systems.js';
import * as emu from './emu.js';
import * as input from './input.js';
import { getPrefs, setPrefs } from './prefs.js';
import * as touch from './touch.js';

export const AUTO = 0;
export const SLOTS = 10;
const AUTOSAVE_MS = 60000;
const REWIND_MS = 10000;

let S = null;          // active session
let lingering = null;  // finished session kept alive briefly so a late-writing core can flush its save
let ui = null;
let thumbUrls = [];
let barTimer = 0;
let lastStorageToast = 0;
let modals = 0;        // dialogs open on top of the game (shortcuts sheet, confirmations)

// ---- Session helpers -------------------------------------------------------------------------
const isRunning = (s) => s.started && !s.userPaused && s.holds === 0 && !s.rewinding;
export const isPlaying = (gameId) => !!S && (!gameId || S.game.id === gameId);
export const currentGame = () => (S ? S.game : null);
/** For tests and debugging from the console. */
export const debugSession = () => S;

function applyRun(s) {
  if (!s.started || s.rewinding) return;
  try { s.api.setRunning(!s.userPaused && s.holds === 0); } catch { /* frame gone */ }
  ui.pause.replaceChildren(icon(s.userPaused ? 'play' : 'pause'));
  ui.pause.title = s.userPaused ? 'Resume' : 'Pause';
  ui.pause.setAttribute('aria-label', ui.pause.title);
  if (s.userPaused && s.holds === 0) {
    setCover('paused', h('button', { class: 'cover__resume', onclick: togglePause }, icon('play', 28), h('span', {}, 'Paused')));
  } else if (ui.cover.dataset.kind === 'paused') setCover(null);
}

function setCover(kind, ...content) {
  ui.cover.dataset.kind = kind || '';
  ui.cover.hidden = !kind;
  clear(ui.cover);
  if (kind) ui.cover.append(...content.flat().filter(Boolean).map((c) => (c.nodeType ? c : h('p', { class: 'cover__text' }, c))));
}

function flash(text, ttl = 1700) {
  const el = h('div', { class: 'hud__flash', role: 'status' }, text);
  ui.flashes.append(el);
  setTimeout(() => el.remove(), ttl);
}

function storageProblem(e) {
  console.warn('Longplay storage problem', e);
  ui.led.classList.add('saveled--warn');
  ui.ledText.textContent = 'Not saved';
  const now = Date.now();
  if (now - lastStorageToast < 20000) return;
  lastStorageToast = now;
  const msg = e && e.kind === 'quota'
    ? 'Storage is full, so this progress is not being saved. Free space in Settings, under Storage.'
    : `Progress could not be saved: ${(e && e.message) || 'unknown storage error'}`;
  toast(msg, { kind: 'error', ttl: 10000 });
}

function ledSaved() {
  ui.led.classList.remove('saveled--warn');
  ui.led.classList.remove('saveled--blink');
  void ui.led.offsetWidth; // restart the animation
  ui.led.classList.add('saveled--blink');
  ui.ledText.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

const refocus = () => { try { ui.stage.focus({ preventScroll: true }); } catch { /* not focusable yet */ } };

// ---- Battery saves ---------------------------------------------------------------------------
function savesChanged(s, files) {
  const paths = Object.keys(files);
  if (paths.length !== s.lastSaves.size) return true;
  for (const p of paths) if (!equalBytes(files[p], s.lastSaves.get(p))) return true;
  return false;
}

function buildSavesRec(s, files) {
  const dir = CORES[s.core].saveDir + '/';
  const kept = {};
  for (const [p, d] of Object.entries((s.savesRec && s.savesRec.files) || {})) if (!p.startsWith(dir)) kept[p] = d;
  s.savesRec = { gameId: s.game.id, files: { ...kept, ...files }, updatedAt: Date.now(), core: s.core };
  return s.savesRec;
}

async function pollSaves(s) {
  if (!s.started || s.polling) return;
  let files;
  try { files = s.api.readSaves(true); } catch { return; }
  if (!savesChanged(s, files)) return;
  s.polling = true;
  s.lastSaves = new Map(Object.entries(files));
  try {
    await store.putSaves(buildSavesRec(s, files));
    if (S === s) { ledSaved(); s.saveDirtyAt = performance.now(); }
  } catch (e) {
    s.lastSaves = new Map(); // so the next poll tries again
    storageProblem(e);
  } finally { s.polling = false; }
}

function syncSaves(s) {
  const files = s.api.readSaves(true);
  if (!savesChanged(s, files)) return;
  s.lastSaves = new Map(Object.entries(files));
  store.putNow('saves', buildSavesRec(s, files));
}

// ---- Save states -----------------------------------------------------------------------------
const stateRecord = (s, slot, data, gz, rawSize) => ({
  gameId: s.game.id, slot, data, gz, rawSize, thumb: s.thumb || null,
  createdAt: Date.now(), playTimeMs: Math.round(s.playMs), core: s.core,
});

async function writeState(s, slot, bytes) {
  await store.putState(stateRecord(s, slot, await gzip(bytes), true, bytes.length));
}

export async function unpackState(rec) {
  if (rec.gz) return gunzip(rec.data);
  return new Uint8Array(await new Blob([rec.data]).arrayBuffer());
}

async function refreshThumb(s) {
  if (!isRunning(s)) return;
  try {
    const png = await s.api.screenshot(1200);
    if (png) { s.thumbBytes = png; s.thumb = new Blob([png], { type: 'image/png' }); }
  } catch { /* keep the previous one */ }
}

async function autoSave(s, reason) {
  if (s.autoBusy || !s.started || s.rewinding) return;
  s.autoBusy = true;
  try {
    const frame = s.api.frame();
    if (reason === 'timer' && frame === s.lastAutoFrame) return; // nothing has happened since
    await refreshThumb(s);
    await writeState(s, AUTO, s.api.getState());
    s.lastAutoFrame = frame;
  } catch (e) {
    if (e instanceof store.StorageError) storageProblem(e);
  } finally {
    s.lastAutoAt = performance.now();
    s.autoBusy = false;
  }
}

export async function saveSlot(slot) {
  const s = S;
  if (!s || !s.started) return;
  try {
    await refreshThumb(s);
    await writeState(s, slot, s.api.getState());
    s.slot = slot;
    flash(`Saved to slot ${slot}`);
  } catch (e) {
    if (e instanceof store.StorageError) storageProblem(e);
    else flash('This game cannot make a save state right now');
  }
  if (S === s && !ui.drawer.hidden) renderDrawer(s);
}

export async function loadSlot(slot) {
  const s = S;
  if (!s || !s.started) return;
  let rec;
  try { rec = await store.getState(s.game.id, slot); } catch (e) { storageProblem(e); return; }
  if (!rec) { flash(slot === AUTO ? 'There is no auto-save yet' : `Slot ${slot} is empty`); return; }
  if (rec.core !== s.core) { flash(`That state was made with ${(CORES[rec.core] || {}).label || rec.core}`); return; }
  try {
    const bytes = await unpackState(rec);
    if (S !== s) return;
    s.rewind.buf.length = 0;
    if (slot !== AUTO) s.slot = slot;
    closeOverlays();
    if (s.userPaused) await s.api.stepState(bytes); else s.api.loadState(bytes);
    flash(slot === AUTO ? 'Loaded the auto-save' : `Loaded slot ${slot}`);
  } catch (e) {
    console.warn(e);
    flash('That save state could not be read');
  }
}

async function removeSlot(slot) {
  const s = S;
  if (!s) return;
  try { await store.deleteState(s.game.id, slot); } catch (e) { storageProblem(e); }
  if (S === s) renderDrawer(s);
}

// Written without awaiting anything, for the moments a page can vanish: hidden tab, closed tab.
function flushNow() {
  if (lingering) { try { syncSaves(lingering.sess); } catch { /* frame gone */ } }
  const s = S;
  if (!s || !s.started) return;
  const now = performance.now();
  if (now - s.lastFlushAt < 700) return;
  s.lastFlushAt = now;
  try { syncSaves(s); } catch { /* frame gone */ }
  if (!s.rewinding) {
    try {
      // Compressed on the spot and stored as plain bytes: small enough to be written in one
      // message, with nothing left for a closing page to hand over afterwards.
      const bytes = s.api.getState();
      store.putNow('states', { ...stateRecord(s, AUTO, gzipNow(bytes), true, bytes.length), thumb: s.thumbBytes || null });
      s.lastAutoAt = now;
      s.lastAutoFrame = s.api.frame();
    } catch { /* no state support, or frame gone */ }
  }
  s.game.playTimeMs = Math.round(s.playMs);
  s.game.lastPlayedAt = Date.now();
  store.putNow('games', s.game);
}

// ---- Rewind ----------------------------------------------------------------------------------
function setupRewind(s) {
  const r = s.rewind;
  clearInterval(r.timer);
  r.buf = [];
  r.ok = false;
  r.why = '';
  if (!getPrefs().rewind) { r.why = 'Rewind is off. Turn it on in Settings.'; return; }
  let size = 0;
  try { size = s.api.getState().length; } catch { r.why = 'This game does not support rewind.'; return; }
  if (!CORES[s.core].rewind || size > 1572864) { r.why = `Rewind is not available for ${s.sys.badge} games (their save states are too large to buffer).`; return; }
  r.interval = size < 131072 ? 66 : 133;
  r.cap = Math.ceil(REWIND_MS / r.interval);
  r.ok = true;
  r.timer = setInterval(() => {
    if (S !== s || !isRunning(s) || document.hidden) return;
    try {
      r.buf.push(s.api.getState());
      if (r.buf.length > r.cap) r.buf.shift();
    } catch { /* skip this sample */ }
  }, r.interval);
}

async function rewindLoop(s) {
  const r = s.rewind;
  if (s.rewinding) return;
  if (!r.ok) { flash(r.why || 'Rewind is not available', 2600); return; }
  if (s.holds > 0) return;
  s.rewinding = true;
  ui.view.classList.add('is-rewinding');
  let last = null;
  try {
    s.api.setVolume(0);
    s.api.setRunning(false);
    while (s.rewindHeld && S === s) {
      const st = r.buf.pop();
      if (!st) { flash('Start of the rewind buffer'); break; }
      last = st;
      const t0 = performance.now();
      await s.api.stepState(st);
      await sleep(Math.max(0, r.interval - (performance.now() - t0)));
    }
    while (s.rewindHeld && S === s) await sleep(40);
  } catch (e) { console.warn('Longplay rewind stopped', e); }
  s.rewinding = false;
  ui.view.classList.remove('is-rewinding');
  if (S !== s) return;
  if (last) r.buf.push(last);
  applyRun(s);
  applyVolume();
}

// ---- Layout ----------------------------------------------------------------------------------
function readDims(s) {
  try {
    const d = s.api.dims();
    if (d.width > 0 && d.height > 0) {
      const aspect = d.aspect > 0.1 ? d.aspect : d.width / d.height;
      if (d.width !== s.dims.width || d.height !== s.dims.height || Math.abs(aspect - s.dims.aspect) > 0.001) {
        s.dims = { width: d.width, height: d.height, aspect };
        return true;
      }
    }
  } catch { /* keep the system defaults */ }
  return false;
}

export function layout() {
  const s = S;
  if (!s || !ui) return;
  const prefs = getPrefs();
  const rect = ui.stage.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  if (W < 4 || H < 4) return;
  const portrait = H > W;
  const touchOn = touch.isVisible();
  const chromeless = !!document.fullscreenElement || ui.view.classList.contains('is-immersive');
  const pad = chromeless ? 0 : Math.min(14, W * 0.02);
  const availW = W - pad * 2;
  const availH = touchOn && portrait ? Math.max(120, H * 0.62 - pad) : H - pad * 2;
  const nw = s.dims.width;
  const nh = s.dims.height;
  const aspect = s.dims.aspect || nw / nh;
  const dpr = window.devicePixelRatio || 1;

  const fit = Math.min(availW / (nh * aspect), availH / nh);
  const fw = nh * aspect * fit;
  const fh = nh * fit;
  let tw = fw;
  let th = fh;
  if (prefs.aspect === 'stretch') { tw = availW; th = availH; }
  else if (prefs.aspect === 'integer') {
    const k = Math.floor(Math.min((availW * dpr) / nw, (availH * dpr) / nh));
    if (k >= 1) { tw = (nw * k) / dpr; th = (nh * k) / dpr; }
  }
  const snap = (v) => Math.round(v * dpr) / dpr;
  const left = snap((W - tw) / 2);
  const top = snap(touchOn && portrait ? pad : pad + (availH - th) / 2);
  Object.assign(ui.screen.style, { width: `${tw}px`, height: `${th}px`, left: `${left}px`, top: `${top}px` });

  const frame = emu.frameElement();
  if (frame) {
    // The core always draws at the game's own resolution, one canvas pixel per game pixel, and
    // the browser does all the scaling in a single step: nearest-neighbour for Sharp and LCD
    // grid, filtered for Smooth. Small canvases are also much cheaper to draw.
    frame.style.width = `${nw}px`;
    frame.style.height = `${nh}px`;
    frame.style.transform = `scale(${tw / nw}, ${th / nh})`;
  }
  const cw = tw / nw;
  const ch = th / nh;
  const grid = prefs.filter === 'lcd' && cw >= 2.5;
  ui.lcd.hidden = !grid;
  if (grid) {
    ui.lcd.style.setProperty('--cw', `${cw}px`);
    ui.lcd.style.setProperty('--ch', `${ch}px`);
    ui.lcd.style.setProperty('--line', `${Math.max(1, Math.round(cw * 0.15))}px`);
  }
  touch.layout();
}

// ---- Audio and speed -------------------------------------------------------------------------
function applyVolume() {
  const p = getPrefs();
  ui.vol.value = String(Math.round(p.volume * 100));
  ui.mute.replaceChildren(icon(p.muted || p.volume === 0 ? 'mute' : 'volume'));
  ui.mute.title = p.muted ? 'Unmute' : 'Mute';
  ui.mute.setAttribute('aria-label', ui.mute.title);
  ui.mute.setAttribute('aria-pressed', String(!!p.muted));
  if (S && S.started && !S.rewinding) { try { S.api.setVolume(p.muted ? 0 : p.volume); } catch { /* frame gone */ } }
}

function toggleMute() { setPrefs({ muted: !getPrefs().muted }); }

function applyFf(s) {
  const on = s.ffHeld || s.ffLatched;
  try { s.api.fastForward(on); } catch { /* frame gone */ }
  ui.view.classList.toggle('is-ff', on);
  ui.ff.setAttribute('aria-pressed', String(s.ffLatched));
}

function nudgeAudio() {
  const s = S;
  if (!s || !s.started || !s.audioWaiting) return;
  try {
    s.api.resumeAudio();
    setTimeout(() => {
      if (S === s && s.api.audioState() !== 'suspended') { s.audioWaiting = false; ui.view.classList.remove('needs-sound'); }
    }, 250);
  } catch { /* try again on the next gesture */ }
}

function togglePause() {
  const s = S;
  if (!s || !s.started) return;
  s.userPaused = !s.userPaused;
  applyRun(s);
}

function resetGame() {
  const s = S;
  if (!s || !s.started) return;
  try { s.api.reset(); s.rewind.buf.length = 0; flash('Game reset'); } catch { /* frame gone */ }
}

// ---- Overlays: states drawer, game menu, touch editor ----------------------------------------
function syncOverlays() {
  const s = S;
  const open = (!ui.drawer.hidden ? 1 : 0) + (!ui.menu.hidden ? 1 : 0) + (touch.isEditing() ? 1 : 0) + modals;
  if (!s || !s.started) return;
  s.holds = open;
  input.setMode(open ? 'overlay' : 'game');
  applyRun(s);
}

function revokeThumbs() { thumbUrls.forEach((u) => URL.revokeObjectURL(u)); thumbUrls = []; }

function armed(btn, label, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; fn(); return; }
  const old = btn.textContent;
  btn.dataset.armed = '1';
  if (label) btn.textContent = label;
  btn.classList.add('is-armed');
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.classList.remove('is-armed'); if (label) btn.textContent = old; } }, 2600);
}

async function renderDrawer(s) {
  let recs = [];
  try { recs = await store.listStates(s.game.id); } catch (e) { storageProblem(e); }
  if (S !== s || ui.drawer.hidden) return;
  revokeThumbs();
  const by = new Map(recs.map((r) => [r.slot, r]));
  const card = (slot) => {
    const rec = by.get(slot);
    const auto = slot === AUTO;
    const foreign = rec && rec.core !== s.core;
    let pic;
    if (rec && rec.thumb) {
      const u = URL.createObjectURL(asBlob(rec.thumb));
      thumbUrls.push(u);
      pic = h('img', { class: 'slot__img', src: u, alt: '' });
    } else pic = h('span', { class: 'slot__none' }, rec ? 'No picture' : 'Empty');
    const save = auto ? null : h('button', { class: 'btn btn--small', type: 'button' }, rec ? 'Overwrite' : 'Save');
    if (save) save.addEventListener('click', () => (rec ? armed(save, 'Really overwrite?', () => saveSlot(slot)) : saveSlot(slot)));
    const delBtn = rec && !auto ? h('button', { class: 'iconbtn iconbtn--small', type: 'button', 'aria-label': `Delete slot ${slot}`, title: 'Delete (press twice)' }, icon('trash', 17)) : null;
    if (delBtn) delBtn.addEventListener('click', () => armed(delBtn, '', () => removeSlot(slot)));
    return h('li', { class: `slot${!auto && slot === s.slot ? ' slot--current' : ''}${auto ? ' slot--auto' : ''}`, dataset: { slot: String(slot) } },
      h('div', { class: 'slot__pic', style: { aspectRatio: `${s.dims.width} / ${s.dims.height}` } }, pic),
      h('div', { class: 'slot__info' },
        h('strong', { class: 'slot__name' }, auto ? 'Auto-save' : `Slot ${slot}`),
        rec ? h('span', { class: 'slot__when' }, fmtStamp(rec.createdAt)) : h('span', { class: 'slot__when dim' }, auto ? 'Made every minute and whenever you leave' : 'Nothing saved here yet'),
        rec ? h('span', { class: 'slot__time dim' }, `Play time ${fmtDuration(rec.playTimeMs)}`) : null,
        foreign ? h('span', { class: 'slot__warn' }, `Made with ${(CORES[rec.core] || {}).label || rec.core}; switch cores in Settings to load it`) : null),
      h('div', { class: 'slot__acts' },
        rec ? h('button', { class: 'btn btn--small btn--primary', type: 'button', disabled: !!foreign, onclick: () => loadSlot(slot) }, 'Load') : null,
        save, delBtn));
  };
  const slots = [];
  for (let i = 1; i <= SLOTS; i++) slots.push(card(i));
  ui.drawer.replaceChildren(
    h('header', { class: 'drawer__head' },
      h('h2', {}, 'Save states'),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close save states', onclick: closeOverlays }, icon('close'))),
    h('p', { class: 'drawer__hint' }, `Quick save and quick load use slot ${s.slot}.`),
    h('ul', { class: 'slots' }, card(AUTO), slots));
}

async function openStates() {
  const s = S;
  if (!s || !s.started) return;
  ui.menu.hidden = true;
  await refreshThumb(s); // taken before pausing: screenshots only work while the game runs
  if (S !== s) return;
  ui.drawer.hidden = false;
  syncOverlays();
  await renderDrawer(s);
}

function seg(label, value, options, pick) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label },
    h('span', { class: 'seg__label' }, label),
    h('div', { class: 'seg__opts' }, options.map(([v, text]) =>
      h('button', { type: 'button', class: `seg__opt${v === value ? ' is-on' : ''}`, 'aria-pressed': String(v === value), onclick: () => pick(v) }, text))));
}

function renderMenu(s) {
  const p = getPrefs();
  const item = (label, iconName, fn) => h('button', { class: 'pmenu__item', type: 'button', onclick: fn }, icon(iconName, 22), h('span', {}, label));
  const resetBtn = item('Reset game', 'reset', () => armed(resetBtn.lastChild, 'Press again to reset', () => { resetGame(); closeOverlays(); }));
  const full = !!document.fullscreenElement || ui.view.classList.contains('is-immersive');
  ui.menu.replaceChildren(h('div', { class: 'pmenu__panel', role: 'dialog', 'aria-label': 'Game menu' },
    h('h2', { class: 'pmenu__title' }, s.game.title),
    h('p', { class: 'pmenu__sub' }, `Play time ${fmtDuration(s.playMs)}`),
    h('div', { class: 'pmenu__grid' },
      item('Resume', 'play', closeOverlays),
      item('Save states', 'slots', openStates),
      resetBtn,
      item(full ? 'Leave fullscreen' : 'Fullscreen', full ? 'windowed' : 'fullscreen', () => { closeOverlays(); toggleFullscreen(); }),
      item(p.muted ? 'Unmute' : 'Mute', p.muted ? 'mute' : 'volume', toggleMute),
      item('Edit touch layout', 'hand', () => { ui.menu.hidden = true; touch.edit(); syncOverlays(); }),
      item('Shortcuts', 'help', () => bus.emit('shortcuts'))),
    seg('Picture', p.filter, [['none', 'Sharp'], ['lcd', 'LCD grid'], ['smooth', 'Smooth']], (v) => setPrefs({ filter: v })),
    seg('Shape', p.aspect, [['original', 'Original'], ['integer', 'Whole pixels'], ['stretch', 'Stretch']], (v) => setPrefs({ aspect: v })),
    h('button', { class: 'btn btn--wide', type: 'button', onclick: () => { location.hash = '#/library'; } }, 'Save and return to library')));
}

function toggleMenu() {
  const s = S;
  if (!s) return;
  if (touch.isEditing()) { touch.stopEditing(); syncOverlays(); return; }
  if (!ui.drawer.hidden || !ui.menu.hidden) { closeOverlays(); return; }
  if (!s.started) return;
  renderMenu(s);
  ui.menu.hidden = false;
  syncOverlays();
  const first = $('.pmenu__item', ui.menu);
  if (first) first.focus();
}

function closeOverlays() {
  const had = !ui.drawer.hidden || !ui.menu.hidden;
  ui.drawer.hidden = true;
  ui.menu.hidden = true;
  revokeThumbs();
  syncOverlays();
  if (had) refocus();
}

// ---- Fullscreen ------------------------------------------------------------------------------
function toggleFullscreen() {
  const el = ui.view;
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  if (el.classList.contains('is-immersive')) { el.classList.remove('is-immersive'); onFullscreenChange(); return; }
  if (el.requestFullscreen && document.fullscreenEnabled) {
    el.requestFullscreen({ navigationUI: 'hide' }).catch(() => { el.classList.add('is-immersive'); onFullscreenChange(); });
  } else { el.classList.add('is-immersive'); onFullscreenChange(); } // phones without the fullscreen API
}

function onFullscreenChange() {
  const full = !!document.fullscreenElement || ui.view.classList.contains('is-immersive');
  ui.view.classList.toggle('is-full', full);
  ui.full.replaceChildren(icon(full ? 'windowed' : 'fullscreen'));
  ui.full.title = full ? 'Leave fullscreen' : 'Fullscreen';
  ui.full.setAttribute('aria-label', ui.full.title);
  // Toasts must sit inside the fullscreen element to stay visible there.
  const toasts = $('#toasts');
  if (toasts) (document.fullscreenElement || document.body).append(toasts);
  pokeBar();
  layout();
}

function pokeBar() {
  ui.view.classList.remove('bar-away');
  clearTimeout(barTimer);
  if (ui.view.classList.contains('is-full')) {
    barTimer = setTimeout(() => { if (S && S.holds === 0) ui.view.classList.add('bar-away'); }, 2600);
  }
}

// ---- Actions ---------------------------------------------------------------------------------
function onAction(action, down) {
  const s = S;
  if (!s || !s.started) return;
  if (action in input.PAD_INDEX) {
    try { s.api.input(input.PAD_INDEX[action], down ? 1 : 0); } catch { /* frame gone */ }
    return;
  }
  if (action === 'fastForward') { s.ffHeld = down; applyFf(s); return; }
  if (action === 'rewind') { s.rewindHeld = down; if (down) rewindLoop(s); return; }
  if (!down) return;
  if (action === 'pause') togglePause();
  else if (action === 'quickSave') saveSlot(s.slot);
  else if (action === 'quickLoad') loadSlot(s.slot);
  else if (action === 'states') { if (ui.drawer.hidden) openStates(); else closeOverlays(); }
  else if (action === 'mute') toggleMute();
  else if (action === 'fullscreen') toggleFullscreen();
  else if (action === 'reset') resetGame();
  else if (action === 'menu') toggleMenu();
}

// ---- Clock -----------------------------------------------------------------------------------
function tick(s) {
  if (S !== s || !s.started) return;
  const now = performance.now();
  if (isRunning(s) && !document.hidden) s.playMs += Math.min(now - s.lastTick, 2500);
  s.lastTick = now;
  s.ticks++;
  if (s.ticks % 2 === 0) pollSaves(s);
  if (s.ticks % 10 === 0) {
    refreshThumb(s);
    s.game.playTimeMs = Math.round(s.playMs);
    store.putGame(s.game).catch(storageProblem);
    if (readDims(s)) layout();
  }
  if (s.saveDirtyAt && now - s.saveDirtyAt > 1500) { s.saveDirtyAt = 0; autoSave(s, 'after-save'); }
  else if (now - s.lastAutoAt >= AUTOSAVE_MS) autoSave(s, 'timer');
}

// ---- Launch ----------------------------------------------------------------------------------
function progressText(t) {
  const pct = (String(t).match(/\d+%/) || [''])[0];
  if (/core/i.test(t)) return /decompress/i.test(t) ? 'Unpacking the emulator core' : `Loading the emulator core ${pct}`.trim();
  if (/data|game/i.test(t)) return 'Loading the game';
  return 'Starting';
}

function launchProblem(e, s) {
  const core = CORES[s.core].label;
  const others = s.sys.cores.filter((c) => c !== s.core);
  const d = String(e.detail || e.message || '');
  if (e.kind === 'files-missing') return { title: 'Part of this site is missing', text: `The emulator files could not be loaded (${d}). Upload the whole Longplay folder again, including vendor/emulatorjs.` };
  if (e.kind === 'timeout') return { title: 'The game took too long to start', text: 'Check the connection to this site, then try again.' };
  if (/graphics/i.test(d)) return { title: 'This browser cannot draw the game', text: 'The emulator needs WebGL, which is switched off or not supported here. Try another browser or device.' };
  if (/network|downloading core/i.test(d)) return { title: `The ${core} core did not load`, text: `Its file could not be fetched (${d}). If you are offline, connect once so the browser can keep a copy.`, others };
  return { title: `${core} could not start this game`, text: `The file may be damaged, or it is not really a ${s.sys.badge} game.${others.length ? ' You can also try the other core for this system.' : ''}`, others };
}

function failLaunch(s, problem) {
  if (S === s) S = null;
  clearInterval(s.timer);
  clearInterval(s.rewind.timer);
  input.setMode('off');
  emu.destroy();
  touch.hide();
  const actions = [h('button', { class: 'btn btn--primary', type: 'button', onclick: () => { location.hash = '#/library'; } }, 'Back to library')];
  for (const other of problem.others || []) {
    actions.push(h('button', { class: 'btn', type: 'button', onclick: async () => {
      await setPrefs({ cores: { [s.game.system]: other } });
      play(s.game.id, { resume: false });
    } }, `Try the ${CORES[other].label} core`));
  }
  if (problem.retry) actions.push(h('button', { class: 'btn', type: 'button', onclick: () => play(s.game.id, problem.retry) }, problem.retryLabel || 'Try again'));
  setCover('error', h('h2', { class: 'cover__title' }, problem.title), h('p', { class: 'cover__text' }, problem.text), h('div', { class: 'cover__acts' }, actions));
  return false;
}

const stylusDirect = () => getPrefs().ndsTouch !== 'capture';

function coreOptions(core) {
  if (core === 'melonds') return { melonds_touch_mode: stylusDirect() ? 'Touch' : 'Mouse' };
  if (core === 'desmume2015') return { desmume_pointer_type: stylusDirect() ? 'touch' : 'mouse' };
  return {};
}

export async function play(gameId, { resume = true, slot = null } = {}) {
  await stop();
  await finishLinger();
  let game = null;
  try { game = await store.getGame(gameId); } catch (e) { toast(e.message, { kind: 'error' }); }
  if (!game || !game.hasRom) {
    toast(game ? `Add the game file for “${game.title}” before playing it.` : 'That game is not in your library any more.', { kind: 'error' });
    if (location.hash.startsWith('#/play')) location.hash = '#/library';
    return false;
  }
  const prefs = getPrefs();
  const sys = SYSTEMS[game.system];
  const core = coreFor(game.system, prefs);
  const s = S = {
    game, core, sys, api: null, started: false, userPaused: false, holds: 0,
    rewinding: false, rewindHeld: false, ffHeld: false, ffLatched: false,
    dims: { width: sys.width, height: sys.height, aspect: sys.width / sys.height },
    lastSaves: new Map(), savesRec: null, thumb: null, thumbBytes: null, slot: 1,
    playMs: game.playTimeMs || 0, lastTick: performance.now(), ticks: 0,
    lastAutoAt: performance.now(), lastAutoFrame: -1, saveDirtyAt: 0, autoBusy: false, polling: false, lastFlushAt: 0,
    rewind: { ok: false, buf: [], timer: 0, interval: 0, cap: 0, why: '' }, timer: 0, audioWaiting: false,
  };
  ui.title.textContent = game.title;
  ui.badge.textContent = sys.badge;
  ui.ledText.textContent = '';
  ui.led.classList.remove('saveled--warn', 'saveled--blink');
  ui.view.classList.remove('is-ff', 'is-rewinding', 'needs-sound');
  ui.view.dataset.system = game.system;
  closeOverlays();
  applyVolume();
  setCover('loading', h('div', { class: 'cover__spin' }), 'Opening your game');
  layout();

  let rom;
  let bootState = null;
  try {
    [rom, s.savesRec] = await Promise.all([store.getRom(gameId), store.getSaves(gameId)]);
    if (slot != null) bootState = await store.getState(gameId, slot);
    else if (resume) bootState = await store.getState(gameId, AUTO);
  } catch (e) {
    return failLaunch(s, { title: 'Storage could not be read', text: e.message });
  }
  if (S !== s) return false;
  if (!rom) return failLaunch(s, { title: 'The game file is missing', text: 'Its file is no longer in this browser. Add it again from the library; your saves are still here.' });
  if (bootState && bootState.core !== core) {
    toast(`The saved state was made with ${(CORES[bootState.core] || {}).label || 'another core'}, so the game is starting from its in-game save.`);
    bootState = null;
  }
  const injected = savesForCore(s.savesRec, core, game.id);
  try {
    const api = await emu.launch({
      host: ui.screen, rom, ext: game.system, gameName: game.id, core,
      volume: prefs.muted ? 0 : prefs.volume, saves: injected, options: coreOptions(core),
      onProgress: (t) => { if (S === s && !s.started) setCover('loading', h('div', { class: 'cover__spin' }), progressText(t)); },
      onKey: (e) => { nudgeAudio(); return input.handleKeyEvent(e); },
      onPointer: () => { nudgeAudio(); pokeBar(); },
      onBlur: () => input.releaseSource('kb:'),
      onRuntimeError: (e) => onCrash(s, e),
    });
    if (S !== s) { emu.destroy(); return false; }
    s.api = api;
  } catch (e) {
    if (S !== s) return false;
    return failLaunch(s, launchProblem(e, s));
  }
  return afterStart(s, bootState, injected);
}

async function afterStart(s, bootState, injected) {
  const api = s.api;
  const prefs = getPrefs();
  s.started = true;
  readDims(s);
  try { api.setSmooth(prefs.filter === 'smooth'); api.setFastForwardRatio(prefs.ffSpeed); } catch { /* optional */ }
  if (s.game.system === 'nds') { try { api.setMouseCapture(!stylusDirect()); } catch { /* optional */ } }
  applyVolume();
  touch.show(s.game.system);
  layout();

  // Baseline of the save folder. Also proves the stored save really reached the core: if it did
  // not, stop before the game can write a blank save over it.
  try {
    const files = api.readSaves(true);
    if (CORES[s.core].verify !== false) {
      for (const [path, data] of Object.entries(injected)) {
        const now = files[path];
        const n = now ? Math.min(now.length, data.length) : 0;
        if (!now || !equalBytes(now.subarray(0, n), data.subarray(0, n))) {
          return failLaunch(s, {
            title: 'Your in-game save did not load',
            text: 'To protect it, the game was stopped before anything could be overwritten. Try again. If this keeps happening, export a backup from Settings first.',
            retry: { resume: false }, retryLabel: 'Try again',
          });
        }
      }
    }
    s.lastSaves = new Map(Object.entries(files));
    const stored = (s.savesRec && s.savesRec.files) || {};
    if (Object.keys(files).some((p) => !stored[p])) await store.putSaves(buildSavesRec(s, files));
  } catch (e) {
    if (e instanceof store.StorageError) storageProblem(e);
  }
  if (S !== s) return false;

  if (bootState) {
    try {
      const bytes = await unpackState(bootState);
      await sleep(80);
      if (S !== s) return false;
      api.loadState(bytes);
      if (bootState.thumb) s.thumb = asBlob(bootState.thumb);
    } catch (e) {
      console.warn(e);
      toast('The saved state could not be read, so the game started from its in-game save.', { kind: 'error' });
    }
  }
  setCover(null);
  s.game.lastPlayedAt = Date.now();
  try {
    await store.putGame(s.game);
    await store.setKV('lastPlayed', s.game.id);
  } catch (e) { storageProblem(e); }
  bus.emit('games');
  if (S !== s) return false;

  s.lastTick = performance.now();
  s.lastAutoAt = performance.now();
  s.timer = setInterval(() => tick(s), 1000);
  setupRewind(s);
  input.setMode('game');
  refocus();
  try {
    if (api.audioState() === 'suspended') { s.audioWaiting = true; ui.view.classList.add('needs-sound'); api.resumeAudio(); nudgeAudio(); }
  } catch { /* no audio context */ }
  setTimeout(() => { if (S === s) refreshThumb(s); }, 1500);
  return true;
}

function onCrash(s, e) {
  if (S !== s) return;
  console.error('Longplay: the emulator stopped', e);
  failLaunch(s, {
    title: 'The emulator stopped unexpectedly',
    text: 'Your in-game saves and the last auto-save are safe. Reloading picks up from the last auto-save.',
    retry: { resume: true }, retryLabel: 'Reload from the auto-save',
  });
}

// ---- Leaving ---------------------------------------------------------------------------------
/** Ends the session. Unless discard is set, the battery save and an auto-save state are written first. */
export async function stop({ discard = false } = {}) {
  const s = S;
  if (!s) { if (ui) setCover(null); return; }
  S = null;
  clearInterval(s.timer);
  clearInterval(s.rewind.timer);
  s.rewind.buf = [];
  s.rewindHeld = false;
  input.setMode('off');
  ui.drawer.hidden = true;
  ui.menu.hidden = true;
  touch.hide();
  revokeThumbs();
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* already left */ } }
  ui.view.classList.remove('is-immersive', 'is-full', 'bar-away');
  let linger = 0;
  if (s.started && !discard) {
    try {
      await refreshThumb(s);
      const files = s.api.readSaves(true);
      if (savesChanged(s, files)) {
        s.lastSaves = new Map(Object.entries(files));
        await store.putSaves(buildSavesRec(s, files));
      }
      await writeState(s, AUTO, s.api.getState());
    } catch (e) {
      if (e instanceof store.StorageError) storageProblem(e); else console.warn(e);
    }
    s.game.playTimeMs = Math.round(s.playMs);
    s.game.lastPlayedAt = Date.now();
    try { await store.putGame(s.game); } catch (e) { storageProblem(e); }
    linger = CORES[s.core].linger || 0;
  }
  if (linger) startLinger(s, linger); else emu.destroy();
  setCover(null);
  bus.emit('games');
}

// Some cores write a save out a little after the game makes it (see CORES.linger). If you save and
// leave straight away, the game is kept running out of sight just long enough to catch it. The
// auto-save state was already taken at the moment you left.
function startLinger(s, ms) {
  try { s.api.setVolume(0); s.userPaused = false; s.holds = 0; s.api.setRunning(true); } catch { /* frame gone */ }
  ui.view.classList.add('is-lingering');
  const done = async () => {
    if (!lingering || lingering.sess !== s) return;
    lingering = null;
    try {
      const files = s.api.readSaves(true);
      if (savesChanged(s, files)) await store.putSaves(buildSavesRec(s, files));
    } catch (e) { console.warn(e); }
    emu.destroy();
    ui.view.classList.remove('is-lingering');
  };
  lingering = { sess: s, done, timer: setTimeout(done, ms), until: performance.now() + ms };
}

/** Ends the out-of-sight run now (waiting it out first when it is nearly over). */
export async function finishLinger() {
  if (!lingering) return;
  const l = lingering;
  const left = l.until - performance.now();
  if (left > 0 && left <= 800) await sleep(left);
  clearTimeout(l.timer);
  await l.done();
}

// ---- Setup -----------------------------------------------------------------------------------
export function initPlayer() {
  const view = $('#view-player');
  ui = { view };
  const tool = (name, label, fn, cls = '') => {
    const b = h('button', { class: `iconbtn ${cls}`, type: 'button', 'aria-label': label, title: label }, icon(name));
    b.addEventListener('click', () => { fn(); if (ui.drawer.hidden && ui.menu.hidden) refocus(); });
    return b;
  };
  ui.exit = tool('back', 'Save and return to library', () => { location.hash = '#/library'; });
  ui.title = h('h1', { class: 'pbar__title' });
  ui.badge = h('span', { class: 'badge' });
  ui.ledText = h('span', { class: 'saveled__text' });
  ui.led = h('span', { class: 'saveled', title: 'In-game saves are copied into this browser as soon as the game writes them' }, h('i', { class: 'saveled__dot' }), ui.ledText);
  ui.rewind = h('button', { class: 'iconbtn pbar__opt', type: 'button', 'aria-label': 'Rewind (hold)', title: 'Rewind (hold)' }, icon('rewind'));
  ui.rewind.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press('rewind', 'ui:rewind'); });
  for (const evt of ['pointerup', 'pointerleave', 'pointercancel']) ui.rewind.addEventListener(evt, () => input.release('rewind', 'ui:rewind'));
  ui.pause = tool('pause', 'Pause', togglePause);
  ui.ff = tool('ff', 'Fast-forward', () => { if (S && S.started) { S.ffLatched = !S.ffLatched; applyFf(S); } }, 'pbar__opt');
  ui.reset = tool('reset', 'Reset game (press twice)', () => armed(ui.reset, '', resetGame), 'pbar__opt');
  ui.states = tool('slots', 'Save states', () => (ui.drawer.hidden ? openStates() : closeOverlays()));
  ui.mute = tool('volume', 'Mute', toggleMute, 'pbar__opt');
  ui.vol = h('input', { type: 'range', min: '0', max: '100', step: '1', class: 'pbar__vol pbar__opt', 'aria-label': 'Volume' });
  ui.vol.addEventListener('input', () => { const v = Number(ui.vol.value) / 100; setPrefs({ volume: v, muted: v === 0 ? getPrefs().muted : false }); });
  ui.vol.addEventListener('change', () => { ui.vol.blur(); refocus(); });
  ui.full = tool('fullscreen', 'Fullscreen', toggleFullscreen);
  ui.menuBtn = tool('menu', 'Game menu', toggleMenu);
  ui.bar = h('header', { class: 'pbar' },
    ui.exit, h('div', { class: 'pbar__name' }, ui.title, ui.badge), ui.led,
    h('div', { class: 'pbar__tools' }, ui.rewind, ui.pause, ui.ff, ui.reset, ui.states, ui.mute, ui.vol, ui.full, ui.menuBtn));
  ui.lcd = h('div', { class: 'screen__lcd', hidden: true });
  ui.screen = h('div', { class: 'screen' }, ui.lcd);
  ui.cover = h('div', { class: 'cover', hidden: true });
  ui.touch = h('div', { class: 'touch' });
  ui.flashes = h('div', { class: 'hud__flashes' });
  ui.hud = h('div', { class: 'hud' },
    h('span', { class: 'hud__chip hud__chip--ff' }, icon('ff', 16), 'Fast-forward'),
    h('span', { class: 'hud__chip hud__chip--rw' }, icon('rewind', 16), 'Rewinding'),
    h('span', { class: 'hud__chip hud__chip--sound' }, icon('mute', 16), 'Press a key or tap for sound'),
    ui.flashes);
  ui.stage = h('div', { class: 'stage', tabindex: '-1' }, ui.screen, ui.touch, ui.hud, ui.cover);
  ui.drawer = h('aside', { class: 'drawer', hidden: true, 'aria-label': 'Save states' });
  ui.menu = h('div', { class: 'pmenu', hidden: true });
  ui.menu.addEventListener('click', (e) => { if (e.target === ui.menu) closeOverlays(); });
  view.append(ui.bar, ui.stage, ui.drawer, ui.menu);

  touch.init(ui.touch, { onChange: () => { syncOverlays(); layout(); } });
  input.onAction(onAction);
  new ResizeObserver(() => layout()).observe(ui.stage);
  ui.stage.addEventListener('pointerdown', () => { nudgeAudio(); pokeBar(); });
  view.addEventListener('mousemove', pokeBar);
  window.addEventListener('keydown', nudgeAudio, true);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow(); });
  window.addEventListener('pagehide', flushNow);
  window.addEventListener('beforeunload', flushNow);

  bus.on('prefs', () => {
    applyVolume();
    const s = S;
    if (!s || !s.started) return;
    const p = getPrefs();
    try { s.api.setSmooth(p.filter === 'smooth'); s.api.setFastForwardRatio(p.ffSpeed); } catch { /* frame gone */ }
    if (p.rewind !== s.rewind.ok && !(p.rewind && s.rewind.why && !/off/i.test(s.rewind.why))) setupRewind(s);
    touch.refresh();
    layout();
    if (!ui.menu.hidden) renderMenu(s);
  });
  bus.on('modal', (delta) => { modals = Math.max(0, modals + delta); if (S && S.started) syncOverlays(); });
  bus.on('pad-lost', () => {
    const s = S;
    if (s && s.started && !s.userPaused && s.holds === 0) { s.userPaused = true; applyRun(s); toast('Controller disconnected. The game is paused.'); }
    else toast('Controller disconnected.');
  });
  bus.on('pad-connected', (info) => toast(`${input.PAD_KIND_NAMES[info.kind]} controller connected.`));
}
