// Start-up and navigation.
import { $, $$, h, toast, bus, icon, fmtDuration } from './util.js';
import * as store from './store.js';
import { loadPrefs } from './prefs.js';
import * as input from './input.js';
import * as player from './player.js';
import * as library from './library.js';
import * as settings from './settings.js';

const VIEWS = ['library', 'playthrough', 'settings'];
const extras = { settings };

let firstRoute = true;
let chain = Promise.resolve();

function show(name) {
  const playing = name === 'player';
  $('#app').hidden = playing;
  $('#view-player').hidden = !playing;
  if (playing) return;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== name;
  for (const a of $$('[data-nav]')) {
    const on = a.dataset.nav === name;
    a.classList.toggle('is-on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

async function route() {
  const hash = location.hash || '#/library';
  const m = hash.match(/^#\/play\/([0-9a-f]{16})(\?(.*))?$/);
  if (m && firstRoute) {
    // After a reload, land on the library; Continue is one click away and the auto-save is intact.
    firstRoute = false;
    history.replaceState(null, '', '#/library');
    return route();
  }
  firstRoute = false;
  if (m) {
    if (player.isPlaying(m[1])) return;
    show('player');
    const fresh = new URLSearchParams(m[3] || '').get('fresh') === '1';
    const ok = await player.play(m[1], { resume: !fresh });
    const g = player.currentGame();
    document.title = ok && g ? `${g.title} | Longplay` : 'Longplay';
    return;
  }
  await player.stop();
  const name = VIEWS.find((v) => hash.startsWith(`#/${v}`)) || 'library';
  document.title = name === 'library' ? 'Longplay' : `${name[0].toUpperCase()}${name.slice(1)} | Longplay`;
  library.setActive(name);
  show(name);
  await library.reload();
  if (extras[name]) { await extras[name].render(); bus.emit('library-rendered', { games: library.getGames(), lastPlayed: await store.getKV('lastPlayed', null).catch(() => null) }); }
  else await library.render();
}

const go = () => { chain = chain.then(route).catch((e) => { console.error(e); toast(`Something went wrong: ${e.message}`, { kind: 'error' }); }); };

function updateRail({ games, lastPlayed }) {
  const btn = $('#continue');
  const game = lastPlayed && games.find((g) => g.id === lastPlayed && g.hasRom);
  btn.hidden = !game;
  if (game) {
    btn.replaceChildren(icon('play', 18), h('span', { class: 'rail__continue-text' }, h('b', {}, 'Continue'), h('small', {}, game.title)));
    btn.onclick = () => library.startGame(game.id);
    btn.title = `Continue ${game.title} (${fmtDuration(game.playTimeMs)} played)`;
  }
}

async function updateStorageNote() {
  const foot = $('#rail-foot');
  const est = await store.storageEstimate();
  if (est.persisted === true) foot.replaceChildren(h('i', { class: 'dot dot--ok' }), 'Saves are protected from clean-up');
  else if (est.persisted === false) foot.replaceChildren(h('i', { class: 'dot dot--warn' }), h('a', { href: '#/settings' }, 'The browser may clear saves. Fix in Settings'));
  else foot.replaceChildren();
}

function fatal(e) {
  document.body.replaceChildren(h('div', { class: 'fatal' },
    h('h1', {}, 'Longplay cannot store anything here'),
    h('p', {}, e.message || 'IndexedDB is not available.'),
    h('p', {}, 'Game files and saves live in the browser\'s storage. Open this page in a normal (not private) window of a current browser.')));
}

async function boot() {
  for (const el of $$('[data-icon]')) el.replaceWith(icon(el.dataset.icon, 20));
  const topBrand = $('.brand').cloneNode(true);
  topBrand.classList.add('brand--top');
  $('#main').prepend(topBrand);
  try { await store.openDb(); } catch (e) { fatal(e); return; }
  await loadPrefs();
  await input.initInput();
  player.initPlayer();
  library.init();
  settings.init();
  bus.on('library-rendered', updateRail);
  bus.on('storage', updateStorageNote);
  bus.on('storage-error', (e) => toast(e.message || 'A storage request failed.', { kind: 'error' }));
  window.addEventListener('hashchange', go);
  window.addEventListener('unhandledrejection', (e) => console.error('Unhandled:', e.reason));
  // Handy from the browser console when something needs a closer look.
  window.longplay = { store, player, library, input, settings };
  await library.reload();
  go();
  updateStorageNote();
}

boot();
