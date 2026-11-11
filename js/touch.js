// On-screen controls for phones and tablets, with a drag-to-arrange layout editor.
// Layouts are kept per orientation in IndexedDB (kv: "touch").
import { h, clear, bus } from './util.js';
import { getKV, setKV } from './store.js';
import { getPrefs } from './prefs.js';
import { SYSTEMS } from './systems.js';
import * as input from './input.js';

// w/h are fractions of the shorter side of the play area.
const CONTROLS = [
  { id: 'dpad', kind: 'dpad', w: 0.40, h: 0.40 },
  { id: 'a', kind: 'round', label: 'A', action: 'a', w: 0.19, h: 0.19 },
  { id: 'b', kind: 'round', label: 'B', action: 'b', w: 0.19, h: 0.19 },
  { id: 'x', kind: 'round', label: 'X', action: 'x', w: 0.17, h: 0.17 },
  { id: 'y', kind: 'round', label: 'Y', action: 'y', w: 0.17, h: 0.17 },
  { id: 'l', kind: 'pill', label: 'L', action: 'l', w: 0.22, h: 0.105 },
  { id: 'r', kind: 'pill', label: 'R', action: 'r', w: 0.22, h: 0.105 },
  { id: 'select', kind: 'pill', label: 'Select', action: 'select', w: 0.19, h: 0.08 },
  { id: 'start', kind: 'pill', label: 'Start', action: 'start', w: 0.19, h: 0.08 },
  { id: 'rw', kind: 'pill', label: 'Rewind', action: 'rewind', w: 0.17, h: 0.075 },
  { id: 'ff', kind: 'pill', label: 'Fast', action: 'fastForward', w: 0.15, h: 0.075 },
  { id: 'menu', kind: 'pill', label: 'Menu', action: 'menu', w: 0.16, h: 0.075 },
];

const DEFAULTS = {
  portrait: {
    l: [0.15, 0.675], r: [0.85, 0.675], menu: [0.41, 0.675], ff: [0.59, 0.675], rw: [0.5, 0.74],
    dpad: [0.25, 0.82], a: [0.88, 0.80], b: [0.75, 0.875], x: [0.75, 0.735], y: [0.62, 0.80],
    select: [0.40, 0.955], start: [0.60, 0.955],
  },
  landscape: {
    l: [0.075, 0.13], r: [0.925, 0.13], menu: [0.44, 0.07], ff: [0.56, 0.07], rw: [0.32, 0.07],
    dpad: [0.115, 0.62], a: [0.945, 0.56], b: [0.875, 0.76], x: [0.875, 0.36], y: [0.805, 0.56],
    select: [0.44, 0.93], start: [0.56, 0.93],
  },
};

const st = {
  layer: null, onChange: null, system: null, shown: false, editing: false, selected: null,
  sawTouch: false, saved: { portrait: {}, landscape: {} }, els: new Map(), bar: null,
};

const orientation = () => {
  const r = st.layer.getBoundingClientRect();
  return r.height > r.width ? 'portrait' : 'landscape';
};

function spot(id) {
  const o = orientation();
  const saved = st.saved[o] && st.saved[o][id];
  const [x, y] = DEFAULTS[o][id];
  return saved ? { x: saved.x, y: saved.y, s: saved.s || 1 } : { x, y, s: 1 };
}

function wanted() {
  const mode = getPrefs().touchMode;
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return st.sawTouch || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

export const isVisible = () => st.shown && (wanted() || st.editing);
export const isEditing = () => st.editing;

function buzz() {
  if (getPrefs().haptics && navigator.vibrate) { try { navigator.vibrate(8); } catch { /* not allowed */ } }
}

function buttonFor(c) {
  if (c.kind === 'dpad') {
    const el = h('div', { class: 'tc tc--dpad', dataset: { id: c.id }, role: 'group', 'aria-label': 'Direction pad' },
      h('i', { class: 'tc__arm tc__arm--up' }), h('i', { class: 'tc__arm tc__arm--right' }),
      h('i', { class: 'tc__arm tc__arm--down' }), h('i', { class: 'tc__arm tc__arm--left' }), h('i', { class: 'tc__hub' }));
    let dirs = new Set();
    const set = (want) => {
      for (const d of want) if (!dirs.has(d)) input.press(d, 'touch:dpad');
      for (const d of dirs) if (!want.has(d)) input.release(d, 'touch:dpad');
      if (want.size && !dirs.size) buzz();
      dirs = want;
      for (const d of ['up', 'right', 'down', 'left']) el.classList.toggle('is-' + d, want.has(d));
    };
    const read = (e) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const want = new Set();
      if (Math.hypot(dx, dy) > 0.2) {
        const oct = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
        if (oct === 7 || oct === 0 || oct === 1) want.add('right');
        if (oct >= 1 && oct <= 3) want.add('down');
        if (oct >= 3 && oct <= 5) want.add('left');
        if (oct >= 5 && oct <= 7) want.add('up');
      }
      set(want);
    };
    el.addEventListener('pointerdown', (e) => {
      if (st.editing) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
      el.dataset.pid = String(e.pointerId);
      read(e);
    });
    el.addEventListener('pointermove', (e) => { if (!st.editing && el.dataset.pid === String(e.pointerId)) read(e); });
    const end = (e) => { if (el.dataset.pid === String(e.pointerId)) { delete el.dataset.pid; set(new Set()); } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    return el;
  }
  const el = h('button', { class: `tc tc--${c.kind}`, type: 'button', dataset: { id: c.id }, tabindex: '-1', 'aria-label': c.label }, h('span', {}, c.label));
  const src = 'touch:' + c.id;
  el.addEventListener('pointerdown', (e) => {
    if (st.editing) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    el.classList.add('is-down');
    input.press(c.action, src);
    buzz();
  });
  const end = () => { el.classList.remove('is-down'); input.release(c.action, src); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

function build() {
  clear(st.layer);
  st.els.clear();
  for (const c of CONTROLS) {
    const el = buttonFor(c);
    el.addEventListener('pointerdown', (e) => { if (st.editing) startDrag(e, c, el); });
    st.els.set(c.id, el);
    st.layer.append(el);
  }
  st.bar = h('div', { class: 'tcbar', hidden: true },
    h('span', { class: 'tcbar__hint' }, 'Drag a control to move it'),
    h('button', { class: 'btn btn--small', type: 'button', onclick: () => resize(-0.1) }, 'Smaller'),
    h('button', { class: 'btn btn--small', type: 'button', onclick: () => resize(0.1) }, 'Larger'),
    h('button', { class: 'btn btn--small', type: 'button', onclick: resetLayout }, 'Reset'),
    h('button', { class: 'btn btn--small btn--primary', type: 'button', onclick: stopEditing }, 'Done'));
  st.layer.append(st.bar);
}

export function layout() {
  if (!st.layer) return;
  const on = isVisible();
  st.layer.hidden = !on;
  if (!on) return;
  const r = st.layer.getBoundingClientRect();
  if (r.width < 4) return;
  const unit = Math.min(Math.max(Math.min(r.width, r.height), 300), 470);
  const buttons = st.system ? SYSTEMS[st.system].buttons : [];
  st.layer.style.setProperty('--tc-alpha', String(getPrefs().touchOpacity));
  for (const c of CONTROLS) {
    const el = st.els.get(c.id);
    const gameButton = ['a', 'b', 'x', 'y', 'l', 'r'].includes(c.id);
    el.hidden = !st.editing && gameButton && !buttons.includes(c.id);
    const p = spot(c.id);
    const w = c.w * unit * p.s;
    const hgt = c.h * unit * p.s;
    Object.assign(el.style, { width: `${w}px`, height: `${hgt}px`, left: `${p.x * r.width - w / 2}px`, top: `${p.y * r.height - hgt / 2}px`, fontSize: `${Math.max(11, hgt * (c.kind === 'round' ? 0.4 : 0.42))}px` });
    el.classList.toggle('is-selected', st.editing && st.selected === c.id);
  }
}

async function save() {
  try { await setKV('touch', st.saved); } catch (e) { bus.emit('storage-error', e); }
}

function startDrag(e, c, el) {
  e.preventDefault();
  e.stopPropagation();
  st.selected = c.id;
  const r = st.layer.getBoundingClientRect();
  const o = orientation();
  const cur = spot(c.id);
  const offX = e.clientX - cur.x * r.width;
  const offY = e.clientY - cur.y * r.height;
  try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
  const move = (ev) => {
    const x = Math.min(0.97, Math.max(0.03, (ev.clientX - offX) / r.width));
    const y = Math.min(0.97, Math.max(0.03, (ev.clientY - offY) / r.height));
    st.saved[o] = { ...(st.saved[o] || {}), [c.id]: { x, y, s: cur.s } };
    layout();
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    save();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  layout();
}

function resize(delta) {
  const id = st.selected;
  if (!id) return;
  const o = orientation();
  const cur = spot(id);
  const s = Math.min(1.8, Math.max(0.6, Math.round((cur.s + delta) * 10) / 10));
  st.saved[o] = { ...(st.saved[o] || {}), [id]: { x: cur.x, y: cur.y, s } };
  layout();
  save();
}

function resetLayout() {
  st.saved[orientation()] = {};
  layout();
  save();
}

export function edit() {
  if (!st.shown) return;
  st.editing = true;
  st.selected = st.selected || 'dpad';
  st.layer.classList.add('is-editing');
  st.bar.hidden = false;
  input.releaseSource('touch:');
  layout();
  st.onChange && st.onChange();
}

export function stopEditing() {
  if (!st.editing) return;
  st.editing = false;
  st.layer.classList.remove('is-editing');
  st.bar.hidden = true;
  layout();
  st.onChange && st.onChange();
}

export function show(system) {
  st.system = system;
  st.shown = true;
  layout();
}

export function hide() {
  st.shown = false;
  st.editing = false;
  if (st.layer) { st.layer.classList.remove('is-editing'); st.bar.hidden = true; st.layer.hidden = true; }
  input.releaseSource('touch:');
}

export const refresh = () => layout();

export function init(layer, { onChange } = {}) {
  st.layer = layer;
  st.onChange = onChange;
  build();
  layer.hidden = true;
  getKV('touch').then((saved) => {
    if (saved && typeof saved === 'object') st.saved = { portrait: saved.portrait || {}, landscape: saved.landscape || {} };
    layout();
  }).catch(() => {});
  window.addEventListener('touchstart', () => {
    if (st.sawTouch) return;
    st.sawTouch = true;
    if (st.shown) { layout(); st.onChange && st.onChange(); }
  }, { passive: true, capture: true });
}
