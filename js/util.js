// Small shared helpers. No framework: views are plain DOM built with h().
import { gzipSync, gunzipSync } from '../vendor/fflate.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

/** h('div', {class:'x', onclick(){}}, child, 'text') */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && !['list', 'form', 'type'].includes(k)) {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      } else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---- Icons (original, 24px stroke set) -------------------------------------------------------
const ICONS = {
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v5h5"/>',
  ff: '<path d="M4 6v12l8-6zM12 6v12l8-6z" fill="currentColor" stroke="none"/>',
  rewind: '<path d="M20 6v12l-8-6zM12 6v12l-8-6z" fill="currentColor" stroke="none"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  windowed: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  slots: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v6h8V4M8 20v-5h8v5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  dots: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  back: '<path d="M14.5 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10 10.5v6M14 10.5v6"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14"/>',
  download: '<path d="M12 5v11M7.5 11.5L12 16l4.5-4.5M5 19h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  grip: '<circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  shelf: '<rect x="4" y="4" width="6.5" height="7" rx="1"/><rect x="13.5" y="4" width="6.5" height="7" rx="1"/><rect x="4" y="14" width="6.5" height="6" rx="1"/><rect x="13.5" y="14" width="6.5" height="6" rx="1"/>',
  route: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><path d="M6 8v8M11 6h9M11 12h9M11 18h9"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 16l4.5-4.5 4 4 2.5-2.5L20 17"/><circle cx="15" cy="9.5" r="1.3" fill="currentColor" stroke="none"/>',
  up: '<path d="M6 14.5l6-6 6 6"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  pad: '<rect x="3" y="7" width="18" height="10" rx="5"/><path d="M7.5 10.5v3M6 12h3"/><circle cx="16.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  keys: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>',
  hand: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10.5 17.5h3"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.5v.01"/>',
};

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

// ---- Formatting ------------------------------------------------------------------------------
export function fmtDuration(ms) {
  const m = Math.floor((ms || 0) / 60000);
  if (m < 1) return 'under a minute';
  const hrs = Math.floor(m / 60);
  const min = m % 60;
  return hrs ? `${hrs}h ${String(min).padStart(2, '0')}m` : `${min}m`;
}

export function fmtBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function fmtWhen(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  const now = new Date();
  const day = 86400000;
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / day);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return `today, ${time}`;
  if (diffDays === 1) return `yesterday, ${time}`;
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtStamp(ts) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---- Hashing ---------------------------------------------------------------------------------
// A 64-bit non-cryptographic content hash. Used only to recognise "the same game file again";
// it runs everywhere (crypto.subtle is missing on plain-http LAN addresses), so IDs stay
// identical between hosts and inside backups.
export function hashBytes(bytes) {
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  const words = bytes.length >>> 2;
  if (words && bytes.byteOffset % 4 === 0) {
    const u32 = new Uint32Array(bytes.buffer, bytes.byteOffset, words);
    for (let i = 0; i < words; i++) {
      const w = u32[i];
      h1 = Math.imul(h1 ^ w, 2654435761);
      h2 = Math.imul(h2 ^ w, 1597334677);
      h1 = (h1 << 13) | (h1 >>> 19);
      h2 = (h2 << 15) | (h2 >>> 17);
    }
  } else {
    for (let i = 0; i < words; i++) {
      const o = i * 4;
      const w = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
      h1 = Math.imul(h1 ^ w, 2654435761);
      h2 = Math.imul(h2 ^ w, 1597334677);
      h1 = (h1 << 13) | (h1 >>> 19);
      h2 = (h2 << 15) | (h2 >>> 17);
    }
  }
  for (let i = words * 4; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function equalBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---- Compression -------------------------------------------------------------------------------
// Native streams where the browser has them (fast, off the main thread), fflate otherwise.
const nativeGzip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
export const canGzip = true;

export async function gzip(bytes) {
  if (!nativeGzip) return new Blob([gzipSync(bytes, { level: 4 })]);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/** Synchronous and quick: for the moment a page is being closed. */
export const gzipNow = (bytes) => gzipSync(bytes, { level: 1 });

export async function gunzip(data) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  if (!nativeGzip) return gunzipSync(new Uint8Array(await blob.arrayBuffer()));
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const asBlob = (x, type = 'image/png') => (x instanceof Blob ? x : new Blob([x], { type }));
export const byteSize = (x) => (x ? (x.size ?? x.byteLength ?? 0) : 0);

// ---- Event bus -------------------------------------------------------------------------------
const listeners = new Map();
export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt).delete(fn);
  },
  emit(evt, data) {
    for (const fn of listeners.get(evt) || []) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  },
};

// ---- Toasts ----------------------------------------------------------------------------------
export function toast(message, opts = {}) {
  const host = $('#toasts');
  if (!host) return;
  const el = h('div', { class: `toast${opts.kind ? ' toast--' + opts.kind : ''}`, role: opts.kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast__msg' }, message));
  if (opts.action) {
    el.append(h('button', { class: 'toast__action', onclick: () => { opts.action.run(); el.remove(); } }, opts.action.label));
  }
  host.append(el);
  const ttl = opts.ttl ?? (opts.kind === 'error' ? 8000 : 3200);
  setTimeout(() => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 220);
  }, ttl);
  return el;
}

// ---- Dialogs ---------------------------------------------------------------------------------
/** Modal dialog. Returns { el, close }. Body may be a node or array of nodes. */
export function openDialog({ title, body, actions = [], wide = false, onClose, className = '' }) {
  const dlg = h('dialog', { class: `dialog${wide ? ' dialog--wide' : ''} ${className}` });
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    if (dlg.open) dlg.close();
    dlg.remove();
    bus.emit('modal', -1);
    onClose && onClose(value);
  };
  const head = h('header', { class: 'dialog__head' },
    h('h2', { class: 'dialog__title' }, title),
    h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: () => close() }, icon('close')));
  const foot = actions.length
    ? h('footer', { class: 'dialog__foot' }, actions.map((a) =>
      h('button', {
        class: `btn${a.primary ? ' btn--primary' : ''}${a.danger ? ' btn--danger' : ''}`,
        onclick: async () => {
          const r = a.run ? await a.run() : undefined;
          if (r !== false) close(a.value);
        },
      }, a.label)))
    : null;
  dlg.append(head, h('div', { class: 'dialog__body' }, body), foot || '');
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  // Dialogs opened while the player is fullscreen must live inside the fullscreen element.
  (document.fullscreenElement || document.body).append(dlg);
  dlg.showModal();
  bus.emit('modal', 1);
  return { el: dlg, close };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    openDialog({
      title,
      body: typeof message === 'string' ? h('p', {}, message) : message,
      actions: [
        { label: cancelLabel, run: () => done(false) },
        { label: confirmLabel, primary: !danger, danger, run: () => done(true) },
      ],
      onClose: () => done(false),
    });
  });
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'game';
}
