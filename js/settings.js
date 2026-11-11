// Settings: picture, sound, emulation, controls, storage, backup, about. Also the "?" shortcuts sheet.
import { h, $, icon, toast, bus, fmtBytes, openDialog, confirmDialog, pickFiles } from './util.js';
import * as store from './store.js';
import { getPrefs, setPrefs } from './prefs.js';
import { SYSTEMS, CORES } from './systems.js';
import * as input from './input.js';
import * as library from './library.js';
import { exportBackup, importBackup } from './backup.js';

let cancelCapture = null;
let shortcutsDlg = null;
const visible = () => !$('#view-settings').hidden && !$('#app').hidden;

function seg(label, value, options, pick) {
  return h('div', { class: 'seg__opts', role: 'group', 'aria-label': label }, options.map(([v, text]) =>
    h('button', { type: 'button', class: `seg__opt${v === value ? ' is-on' : ''}`, 'aria-pressed': String(v === value), onclick: async () => { await pick(v); render(); } }, text)));
}

function toggle(label, on, change) {
  const box = h('input', { type: 'checkbox', checked: !!on, 'aria-label': label });
  box.addEventListener('change', () => change(box.checked));
  return h('span', { class: 'switch' }, box, h('i'));
}

function setting(name, help, control) {
  return h('div', { class: 'setting' },
    h('div', { class: 'setting__name' }, name),
    help ? h('div', { class: 'setting__help' }, help) : null,
    h('div', { class: 'setting__ctl' }, control));
}

const panel = (title, sub, ...kids) => h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, title), sub ? h('p', { class: 'panel__sub' }, sub) : null, kids);

// ---- Controls --------------------------------------------------------------------------------
function bindButton(kind, action) {
  const b = input.getBindings();
  const token = (kind === 'keys' ? b.keys : b.pad)[action.id];
  const label = kind === 'keys' ? input.keyLabel(token) : input.padLabel(token, input.currentPadKind());
  const what = kind === 'keys' ? 'key' : 'controller button';
  const btn = h('button', { class: `bind${token ? '' : ' bind--empty'}`, type: 'button', 'aria-label': `${action.label}, ${what}: ${label || 'not set'}. Press to change.` }, label || 'Not set');
  btn.addEventListener('click', () => {
    if (cancelCapture) { cancelCapture(); cancelCapture = null; render(); return; }
    btn.classList.add('is-listening');
    btn.textContent = kind === 'keys' ? 'Press a key (Esc cancels)' : 'Press a button (Esc cancels)';
    const stop = input.captureNext(kind, async (tok) => {
      cancelCapture = null;
      window.removeEventListener('keydown', onEsc, true);
      if (tok) await input.setBinding(kind, action.id, tok);
      render();
    });
    const onEsc = (e) => {
      if (e.code !== 'Escape' || kind === 'keys') return;
      e.preventDefault();
      stop(); cancelCapture = null;
      window.removeEventListener('keydown', onEsc, true);
      render();
    };
    window.addEventListener('keydown', onEsc, true);
    cancelCapture = () => { stop(); window.removeEventListener('keydown', onEsc, true); };
  });
  const clearBtn = token ? h('button', { class: 'iconbtn iconbtn--small', type: 'button', 'aria-label': `Clear the ${what} for ${action.label}`, title: 'Clear', onclick: async () => { await input.setBinding(kind, action.id, ''); render(); } }, icon('close', 14)) : null;
  return h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '2px' } }, btn, clearBtn);
}

function controlsPanel() {
  const pads = input.connectedPads();
  const b = input.getBindings();
  const rows = [];
  let group = '';
  for (const a of input.ACTIONS) {
    if (a.group !== group) { group = a.group; rows.push(h('tr', { class: 'table__group' }, h('td', { colSpan: 3 }, group))); }
    rows.push(h('tr', {},
      h('td', {}, a.label, a.note ? h('span', { class: 'dim' }, ` (${a.note})`) : null),
      h('td', {}, bindButton('keys', a)),
      h('td', {}, bindButton('pad', a))));
  }
  const padNote = pads.length
    ? h('p', { class: 'note note--ok', id: 'pad-status' }, pads.map((p) => `${input.PAD_KIND_NAMES[p.kind]} controller connected${p.standard ? '' : ' (non-standard layout: check the buttons below and remap any that are off)'}`).join('. '), '.')
    : h('p', { class: 'note', id: 'pad-status' }, 'No controller detected. Plug one in or pair it, then press any button on it to wake it up.');
  const p = getPrefs();
  return panel('Controls', 'Click a binding, then press the key or controller button you want. A key can only do one thing, so reusing it clears the old binding.',
    padNote,
    h('div', { class: 'tablewrap' }, h('table', { class: 'table', id: 'binds' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Keyboard'), h('th', {}, 'Controller'))),
      h('tbody', {}, rows))),
    h('div', { class: 'row', style: { margin: '14px 0 4px' } },
      h('button', { class: 'btn btn--small', type: 'button', onclick: async () => { await input.resetBindings('keys'); toast('Keyboard controls reset.'); render(); } }, 'Reset keyboard'),
      h('button', { class: 'btn btn--small', type: 'button', onclick: async () => { await input.resetBindings('pad'); toast('Controller controls reset.'); render(); } }, 'Reset controller'),
      h('button', { class: 'btn btn--small btn--quiet', type: 'button', onclick: showShortcuts }, icon('help', 16), 'Show shortcuts')),
    setting('Left stick as D-pad', 'The left analogue stick moves like the direction pad, on top of whatever is bound above.',
      toggle('Left stick as D-pad', b.stick, async (on) => { await input.setStickAsDpad(on); })),
    setting('On-screen controls', 'Auto shows them on phones and tablets. To move or resize them, start a game, open the game menu and choose "Edit touch layout".',
      seg('On-screen controls', p.touchMode, [['auto', 'Auto'], ['always', 'Always'], ['never', 'Never']], (v) => setPrefs({ touchMode: v }))),
    setting('On-screen control opacity', null, (() => {
      const r = h('input', { type: 'range', min: '20', max: '100', step: '5', value: String(Math.round(p.touchOpacity * 100)), 'aria-label': 'On-screen control opacity', style: { accentColor: 'var(--lcd)' } });
      r.addEventListener('change', () => setPrefs({ touchOpacity: Number(r.value) / 100 }));
      return r;
    })()),
    setting('Vibrate on touch', 'A short buzz when an on-screen button is pressed, on phones that support it.',
      toggle('Vibrate on touch', p.haptics, (on) => setPrefs({ haptics: on }))),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn btn--small btn--quiet', type: 'button', onclick: async () => { try { await store.setKV('touch', { portrait: {}, landscape: {} }); toast('Touch layout reset. It applies the next time the page loads.'); } catch (e) { toast(e.message, { kind: 'error' }); } } }, 'Reset touch layout')));
}

// ---- Storage ---------------------------------------------------------------------------------
async function storagePanel() {
  let est = { usage: null, quota: null, persisted: null, canPersist: false };
  let usage = {};
  let lastBackup = null;
  try { [est, usage, lastBackup] = await Promise.all([store.storageEstimate(), store.usageByGame(), store.getKV('lastBackupAt', null)]); } catch (e) { toast(e.message, { kind: 'error' }); }
  const games = library.getGames().slice().sort((a, b) => a.title.localeCompare(b.title));
  let total = 0;
  const rows = games.map((g) => {
    const u = usage[g.id] || { rom: 0, saves: 0, states: 0, art: 0 };
    const sum = u.rom + u.saves + u.states + u.art;
    total += sum;
    return h('tr', { dataset: { id: g.id } },
      h('td', {}, g.title, ' ', h('span', { class: 'badge' }, SYSTEMS[g.system].badge)),
      h('td', { class: 'num' }, g.hasRom ? fmtBytes(u.rom) : h('span', { class: 'dim' }, 'removed')),
      h('td', { class: 'num' }, u.saves ? fmtBytes(u.saves) : h('span', { class: 'dim' }, 'none')),
      h('td', { class: 'num' }, u.states ? fmtBytes(u.states) : h('span', { class: 'dim' }, 'none')),
      h('td', { class: 'num' }, fmtBytes(sum)),
      h('td', {}, h('div', { class: 'row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
        u.states ? h('button', { class: 'btn btn--small btn--quiet', type: 'button', onclick: async () => {
          if (!await confirmDialog({ title: `Delete the save states for “${g.title}”?`, message: 'The auto-save and all manual slots are deleted. The in-game save stays.', confirmLabel: 'Delete save states', danger: true })) return;
          try { await store.deleteStates(g.id); toast('Save states deleted.'); } catch (e) { toast(e.message, { kind: 'error' }); }
          bus.emit('games'); render();
        } }, 'Delete states') : null,
        h('button', { class: 'btn btn--small btn--danger', type: 'button', onclick: async () => { if (await library.deleteGame(g)) { await library.reload(); render(); } } }, 'Delete game'))));
  });
  const pct = est.usage != null && est.quota ? Math.min(100, (est.usage / est.quota) * 100) : null;
  const protect = est.persisted === true
    ? h('p', { class: 'note note--ok', id: 'persist-status' }, 'Protected. The browser has agreed not to clear Longplay\'s data to free up space.')
    : h('div', { class: 'note', id: 'persist-status' },
      h('p', {}, est.persisted === false
        ? 'Not protected yet. When a device runs low on space, browsers may clear a site\'s data, saves included.'
        : 'This browser cannot tell whether saves are protected from automatic clean-up.'),
      est.canPersist ? h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn btn--small btn--primary', type: 'button', onclick: async () => {
        const ok = await store.requestPersistence();
        toast(ok ? 'Saves are now protected from clean-up.' : 'The browser said no for now. Bookmarking this site, installing it to your home screen or allowing notifications usually makes it say yes. Keep a backup meanwhile.', { ttl: 9000, kind: ok ? undefined : 'error' });
        bus.emit('storage'); render();
      } }, 'Protect my saves')) : null);
  return panel('Storage', 'Game files, saves and save states are kept in this browser on this device, and nowhere else.',
    protect,
    pct != null ? h('div', { style: { margin: '14px 0' } },
      h('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)), 'aria-label': 'Storage used' }, h('i', { style: { width: `${Math.max(0.5, pct)}%` } })),
      h('p', { class: 'dim', id: 'usage-line', style: { marginTop: '6px', fontSize: '13.5px' } }, `${fmtBytes(est.usage)} used of about ${fmtBytes(est.quota)} this browser allows. Longplay's own data is ${fmtBytes(total)}.`))
      : h('p', { class: 'dim', style: { margin: '12px 0' } }, `Longplay's data is ${fmtBytes(total)}. This browser does not report how much room is left.`),
    games.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'table', id: 'usage' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Game'), h('th', { class: 'num' }, 'Game file'), h('th', { class: 'num' }, 'In-game save'), h('th', { class: 'num' }, 'Save states'), h('th', { class: 'num' }, 'Total'), h('th', {}, ''))),
      h('tbody', {}, rows))) : h('p', { class: 'dim' }, 'No games stored yet.'),
    h('h2', { class: 'panel__title', style: { marginTop: '22px' } }, 'Backup'),
    h('p', { class: 'panel__sub' }, `One .zip with every in-game save, save state, note and setting. Game files are not included. ${lastBackup ? `Last backup: ${new Date(lastBackup).toLocaleString()}.` : 'You have not made a backup from this browser yet.'}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn--primary', type: 'button', id: 'export-backup', onclick: exportBackup }, icon('download', 18), 'Export backup'),
      h('button', { class: 'btn', type: 'button', id: 'import-backup', onclick: async () => { const [f] = await pickFiles({ accept: '.zip,application/zip' }); if (f) { await importBackup(f); await library.reload(); render(); } } }, icon('upload', 18), 'Import backup')));
}

// ---- The view --------------------------------------------------------------------------------
export async function render() {
  if (cancelCapture) { cancelCapture(); cancelCapture = null; }
  const p = getPrefs();
  const view = $('#view-settings');
  const y = window.scrollY;
  const vol = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(p.volume * 100)), 'aria-label': 'Volume', style: { accentColor: 'var(--lcd)' } });
  vol.addEventListener('change', () => setPrefs({ volume: Number(vol.value) / 100 }));
  const coreSelect = (system, label) => h('select', { class: 'select', 'aria-label': label, onchange: (e) => setPrefs({ cores: { [system]: e.target.value } }) },
    SYSTEMS[system].cores.map((c) => h('option', { value: c, selected: p.cores[system] === c }, CORES[c].label)));
  const storage = await storagePanel();
  view.replaceChildren(
    h('header', { class: 'viewhead' }, h('div', {}, h('h1', { class: 'viewhead__title' }, 'Settings'), h('p', { class: 'viewhead__sub' }, 'Changes are saved as you make them.'))),
    panel('Picture', null,
      setting('Filter', 'Sharp shows crisp pixels. LCD grid draws the lines between pixels like a handheld screen (best with whole-pixel scaling). Smooth blends pixels.',
        seg('Filter', p.filter, [['none', 'Sharp'], ['lcd', 'LCD grid'], ['smooth', 'Smooth']], (v) => setPrefs({ filter: v }))),
      setting('Shape', 'Original keeps the game\'s proportions. Whole pixels only uses exact multiples of the original size, so every pixel is the same width. Stretch fills the space.',
        seg('Shape', p.aspect, [['original', 'Original'], ['integer', 'Whole pixels'], ['stretch', 'Stretch']], (v) => setPrefs({ aspect: v })))),
    panel('Sound', null,
      setting('Volume', null, vol),
      setting('Mute', null, toggle('Mute', p.muted, (on) => setPrefs({ muted: on })))),
    panel('Emulation', null,
      setting('Rewind', 'Hold the rewind key to step back through the last 10 seconds. Works for GB, GBC and GBA; NDS save states are too large to buffer.',
        toggle('Rewind', p.rewind, (on) => setPrefs({ rewind: on }))),
      setting('Fast-forward speed', 'How fast the game runs while fast-forward is held.',
        seg('Fast-forward speed', p.ffSpeed, [[2, '2x'], [3, '3x'], [4, '4x'], [0, 'Max']], (v) => setPrefs({ ffSpeed: v }))),
      setting('NDS stylus', 'Direct: click or tap the lower screen where you want to touch. Captured mouse: click the game to lock the mouse to it and move a cursor; Esc lets go. Applies the next time a game starts.',
        seg('NDS stylus', p.ndsTouch, [['direct', 'Direct'], ['capture', 'Captured mouse']], (v) => setPrefs({ ndsTouch: v }))),
      setting('GB and GBC core', 'Gambatte is the more accurate choice. In-game saves carry over between cores; save states do not.', coreSelect('gb', 'GB and GBC core')),
      setting('NDS core', 'melonDS is the default. Try DeSmuME 2015 if a game misbehaves.', coreSelect('nds', 'NDS core'))),
    controlsPanel(),
    storage,
    panel('About', null,
      h('p', { class: 'panel__sub' }, 'Longplay is a front end. It contains no games and no console firmware; you add your own game files.'),
      h('p', { class: 'dim', style: { fontSize: '13.5px', maxWidth: '72ch' } },
        'Emulation by EmulatorJS 4.2.3 (GPL-3.0) with the Gambatte, mGBA, melonDS and DeSmuME 2015 cores. Zip handling by fflate (MIT). Typeface: Bai Jamjuree (SIL Open Font License). See LICENSES.md in the site folder for sources and full terms.')));
  // the GB select drives both gb and gbc
  const gbSel = $('select[aria-label="GB and GBC core"]', view);
  if (gbSel) gbSel.onchange = (e) => setPrefs({ cores: { gb: e.target.value, gbc: e.target.value } });
  window.scrollTo(0, y);
}

// ---- Shortcuts sheet -------------------------------------------------------------------------
export function showShortcuts() {
  if (shortcutsDlg) { shortcutsDlg.close(); return; }
  const b = input.getBindings();
  const kind = input.currentPadKind();
  const hasPad = input.connectedPads().length > 0;
  const kids = [];
  let group = '';
  for (const a of input.ACTIONS) {
    if (a.group !== group) { group = a.group; kids.push(h('h3', {}, group)); }
    const key = input.keyLabel(b.keys[a.id]);
    const pad = input.padLabel(b.pad[a.id], kind);
    kids.push(h('div', { class: 'keys__row' },
      h('span', {}, a.label, a.note === 'hold' ? h('span', { class: 'dim' }, ' (hold)') : null),
      h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
        key ? h('span', { class: 'kbd' }, key) : h('span', { class: 'dim' }, 'not set'),
        hasPad && pad ? h('span', { class: 'kbd' }, pad) : null)));
  }
  kids.push(h('div', { class: 'keys__row' }, h('span', {}, 'This sheet'), h('span', { class: 'kbd' }, '?')));
  shortcutsDlg = openDialog({
    title: 'Shortcuts', wide: true, className: 'dialog--keys',
    body: h('div', {}, h('div', { class: 'keys' }, kids),
      h('p', { class: 'dim', style: { marginTop: '14px', fontSize: '13.5px' } }, 'Change any of these in Settings, under Controls.')),
    onClose: () => { shortcutsDlg = null; },
  });
}

export function init() {
  bus.on('shortcuts', showShortcuts);
  bus.on('backup-file', async (file) => { await importBackup(file); });
  const refresh = () => { if (visible() && !cancelCapture) render(); };
  bus.on('pad-connected', refresh);
  bus.on('pad-lost', refresh);
  bus.on('storage', refresh);
}
