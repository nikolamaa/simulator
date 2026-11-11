// Input: one place that turns keyboard keys, gamepad buttons and on-screen touches into actions.
// Bindings are stored in IndexedDB (kv: "controls").
import { getKV, setKV } from './store.js';
import { bus } from './util.js';

// RetroPad button numbers the cores understand.
export const PAD_INDEX = { b: 0, y: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, x: 9, l: 10, r: 11 };

export const ACTIONS = [
  { id: 'up', label: 'Up', group: 'Game buttons' },
  { id: 'down', label: 'Down', group: 'Game buttons' },
  { id: 'left', label: 'Left', group: 'Game buttons' },
  { id: 'right', label: 'Right', group: 'Game buttons' },
  { id: 'a', label: 'A', group: 'Game buttons' },
  { id: 'b', label: 'B', group: 'Game buttons' },
  { id: 'x', label: 'X', group: 'Game buttons', note: 'NDS' },
  { id: 'y', label: 'Y', group: 'Game buttons', note: 'NDS' },
  { id: 'l', label: 'L', group: 'Game buttons', note: 'GBA, NDS' },
  { id: 'r', label: 'R', group: 'Game buttons', note: 'GBA, NDS' },
  { id: 'start', label: 'Start', group: 'Game buttons' },
  { id: 'select', label: 'Select', group: 'Game buttons' },
  { id: 'fastForward', label: 'Fast-forward', group: 'Shortcuts', note: 'hold' },
  { id: 'rewind', label: 'Rewind', group: 'Shortcuts', note: 'hold' },
  { id: 'pause', label: 'Pause or resume', group: 'Shortcuts' },
  { id: 'quickSave', label: 'Save to current slot', group: 'Shortcuts' },
  { id: 'quickLoad', label: 'Load current slot', group: 'Shortcuts' },
  { id: 'states', label: 'Open save states', group: 'Shortcuts' },
  { id: 'mute', label: 'Mute', group: 'Shortcuts' },
  { id: 'fullscreen', label: 'Fullscreen', group: 'Shortcuts' },
  { id: 'reset', label: 'Reset game', group: 'Shortcuts' },
  { id: 'menu', label: 'Game menu', group: 'Shortcuts' },
];

export const DEFAULT_KEYS = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  a: 'KeyX', b: 'KeyZ', x: 'KeyS', y: 'KeyA', l: 'KeyQ', r: 'KeyW', start: 'Enter', select: 'Backspace',
  fastForward: 'Space', rewind: 'KeyR', pause: 'KeyP', quickSave: 'F2', quickLoad: 'F4', states: 'Tab',
  mute: 'KeyM', fullscreen: 'KeyF', reset: '', menu: 'Escape',
};

// Positional defaults for the standard gamepad layout: the right-hand face button is A and the
// bottom one is B, as on the original handhelds, whatever letters the controller prints on them.
export const DEFAULT_PAD = {
  up: 'b12', down: 'b13', left: 'b14', right: 'b15',
  a: 'b1', b: 'b0', x: 'b3', y: 'b2', l: 'b4', r: 'b5', start: 'b9', select: 'b8',
  fastForward: 'b7', rewind: 'b6', pause: '', quickSave: '', quickLoad: '', states: '', mute: '', fullscreen: '', reset: '', menu: 'b16',
};

const ALWAYS = new Set(['menu']); // still handled while a menu or drawer is open

const st = {
  keys: { ...DEFAULT_KEYS },
  pad: { ...DEFAULT_PAD },
  stick: true,
  byCode: new Map(),
  held: new Map(),      // action -> Set(source)
  mode: 'off',          // off | game | overlay
  capture: null,        // { kind: 'keys' | 'pad', cb }
  pads: new Map(),      // index -> { id, kind, mapping, down:Set, actions:Set }
  subs: new Set(),
  raf: 0,
};

function reindex() {
  st.byCode = new Map();
  for (const [action, code] of Object.entries(st.keys)) if (code) st.byCode.set(code, action);
}

export async function loadBindings() {
  try {
    const saved = await getKV('controls');
    if (saved) {
      st.keys = { ...DEFAULT_KEYS, ...(saved.keys || {}) };
      st.pad = { ...DEFAULT_PAD, ...(saved.pad || {}) };
      st.stick = saved.stick !== false;
    }
  } catch (e) { console.warn('Longplay: controls could not be read, using defaults', e); }
  reindex();
  bus.emit('controls');
}

export async function initInput() {
  await loadBindings();
  const onKey = (e) => { if (handleKeyEvent(e)) e.preventDefault(); };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => releaseSource('kb:'));
  window.addEventListener('gamepadconnected', startPolling);
  window.addEventListener('gamepaddisconnected', () => { if (!st.raf) pollPads(); });
  try { if (navigator.getGamepads && Array.from(navigator.getGamepads()).some(Boolean)) startPolling(); } catch { /* blocked by policy */ }
}

async function persist() {
  try { await setKV('controls', { keys: st.keys, pad: st.pad, stick: st.stick }); } catch (e) { bus.emit('storage-error', e); }
  bus.emit('controls');
}

export const getBindings = () => ({ keys: { ...st.keys }, pad: { ...st.pad }, stick: st.stick });

/** Binds a key code or gamepad token to an action; whatever else used it is unbound. */
export async function setBinding(kind, action, token) {
  const map = kind === 'keys' ? st.keys : st.pad;
  if (token) for (const other of Object.keys(map)) if (other !== action && map[other] === token) map[other] = '';
  map[action] = token || '';
  reindex();
  await persist();
}

export async function setStickAsDpad(on) { st.stick = !!on; await persist(); }

export async function resetBindings(kind) {
  if (!kind || kind === 'keys') st.keys = { ...DEFAULT_KEYS };
  if (!kind || kind === 'pad') { st.pad = { ...DEFAULT_PAD }; st.stick = true; }
  reindex();
  await persist();
}

export function onAction(fn) { st.subs.add(fn); return () => st.subs.delete(fn); }

function emit(action, down) {
  if (st.mode === 'off') return;
  if (st.mode === 'overlay' && !ALWAYS.has(action)) return;
  for (const fn of st.subs) { try { fn(action, down); } catch (e) { console.error(e); } }
}

export function press(action, source) {
  let set = st.held.get(action);
  if (!set) st.held.set(action, (set = new Set()));
  const was = set.size > 0;
  set.add(source);
  if (!was) emit(action, true);
}

export function release(action, source) {
  const set = st.held.get(action);
  if (!set || !set.delete(source)) return;
  if (set.size === 0) emit(action, false);
}

export function releaseSource(prefix) {
  for (const [action, set] of st.held) {
    let changed = false;
    for (const s of Array.from(set)) if (s.startsWith(prefix)) { set.delete(s); changed = true; }
    if (changed && set.size === 0) emit(action, false);
  }
}

/** off: nothing reaches the game. game: everything does. overlay: only the menu shortcut. */
export function setMode(mode) {
  if (mode === st.mode) return;
  if (st.mode === 'game') {
    for (const [action, set] of st.held) if (set.size) { set.clear(); emit(action, false); }
    for (const info of st.pads.values()) info.actions = new Set();
  }
  st.mode = mode;
}
export const getMode = () => st.mode;

function isTyping(e) {
  const t = e.target;
  if (!t || !t.closest) return false;
  if (t.closest('textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  const input = t.closest('input');
  return !!input && !['checkbox', 'radio', 'button', 'range', 'file'].includes(input.type);
}

/** Shared by the page and the game frame. Returns true when the event was used. */
export function handleKeyEvent(e) {
  const down = e.type === 'keydown';
  if (st.capture && st.capture.kind === 'keys') {
    if (down && !e.repeat) {
      const cb = st.capture.cb;
      st.capture = null;
      cb(e.code === 'Escape' ? null : e.code);
    }
    return true;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return false;
  if (e.key === '?') { if (down && !e.repeat) bus.emit('shortcuts'); return true; }
  // A dialog is open on top of everything: its own keys (Esc, Enter, Tab) belong to it.
  if (st.mode === 'off' || document.querySelector('dialog[open]')) return false;
  const action = st.byCode.get(e.code);
  if (!action) return false;
  if (st.mode === 'overlay' && !ALWAYS.has(action)) return false;
  if (down) { if (!e.repeat) press(action, 'kb:' + e.code); } else release(action, 'kb:' + e.code);
  return true;
}

/** Waits for the next key or gamepad press and passes it to cb (null if cancelled). Returns a cancel function. */
export function captureNext(kind, cb) {
  st.capture = { kind, cb };
  if (kind === 'pad') startPolling();
  return () => { if (st.capture && st.capture.cb === cb) st.capture = null; };
}

// ---- Gamepads --------------------------------------------------------------------------------
export function padKind(id) {
  const s = String(id).toLowerCase();
  if (/xbox|xinput|045e|microsoft/.test(s)) return 'xbox';
  if (/dualsense|dualshock|playstation|054c|ps[345]\b|wireless controller/.test(s)) return 'playstation';
  if (/pro controller|057e|joy-con|switch/.test(s)) return 'switch';
  return 'generic';
}

export const PAD_KIND_NAMES = { xbox: 'Xbox-style', playstation: 'PlayStation-style', switch: 'Switch Pro-style', generic: 'Generic' };

const PAD_NAMES = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L stick', 'R stick', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Guide'],
  playstation: ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'PS'],
  switch: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', 'Minus', 'Plus', 'L stick', 'R stick', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home'],
};

export function padLabel(token, kind = 'generic') {
  if (!token) return '';
  const b = token.match(/^b(\d+)$/);
  if (b) {
    const names = PAD_NAMES[kind];
    return (names && names[Number(b[1])]) || `Button ${Number(b[1]) + 1}`;
  }
  const a = token.match(/^a(\d+)([+-])$/);
  if (a) return `Axis ${Number(a[1]) + 1} ${a[2] === '+' ? '+' : '-'}`;
  return token;
}

const KEY_NAMES = {
  ArrowUp: 'Up arrow', ArrowDown: 'Down arrow', ArrowLeft: 'Left arrow', ArrowRight: 'Right arrow',
  Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Escape: 'Esc', Tab: 'Tab',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', CapsLock: 'Caps Lock',
};
export function keyLabel(code) {
  if (!code) return '';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit(\d)$/))) return m[1];
  if ((m = code.match(/^Numpad(.+)$/))) return 'Numpad ' + m[1];
  return code;
}

export const connectedPads = () => Array.from(st.pads.values()).map((p) => ({ id: p.id, kind: p.kind, standard: p.mapping === 'standard' }));
export const currentPadKind = () => { const p = st.pads.values().next().value; return p ? p.kind : 'generic'; };

function startPolling() { if (!st.raf) st.raf = requestAnimationFrame(pollPads); }

function pollPads() {
  st.raf = 0;
  let list = [];
  try { list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch { list = []; }
  const seen = new Set();
  for (const gp of list) {
    if (!gp || !gp.connected) continue;
    seen.add(gp.index);
    let info = st.pads.get(gp.index);
    if (!info) {
      info = { id: gp.id, kind: padKind(gp.id), mapping: gp.mapping, down: new Set(), actions: new Set() };
      st.pads.set(gp.index, info);
      bus.emit('pad-connected', info);
    }
    const now = new Set();
    gp.buttons.forEach((btn, i) => { if (btn.pressed || btn.value > 0.5) now.add('b' + i); });
    gp.axes.forEach((v, i) => { if (v > 0.55) now.add(`a${i}+`); else if (v < -0.55) now.add(`a${i}-`); });

    if (st.capture && st.capture.kind === 'pad') {
      for (const t of now) {
        if (!info.down.has(t)) { const cb = st.capture.cb; st.capture = null; cb(t); break; }
      }
      info.down = now;
      continue;
    }
    const want = new Set();
    for (const [action, token] of Object.entries(st.pad)) if (token && now.has(token)) want.add(action);
    if (st.stick) {
      if (now.has('a1-')) want.add('up');
      if (now.has('a1+')) want.add('down');
      if (now.has('a0-')) want.add('left');
      if (now.has('a0+')) want.add('right');
    }
    const src = `gp${gp.index}:`;
    if (st.mode !== 'off') {
      for (const a of want) if (!info.actions.has(a)) press(a, src);
      for (const a of info.actions) if (!want.has(a)) release(a, src);
      info.actions = want;
    }
    info.down = now;
  }
  for (const [index, info] of st.pads) {
    if (seen.has(index)) continue;
    st.pads.delete(index);
    releaseSource(`gp${index}:`);
    bus.emit('pad-lost', info);
  }
  if (st.pads.size || (st.capture && st.capture.kind === 'pad')) st.raf = requestAnimationFrame(pollPads);
}
