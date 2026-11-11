// Host side of the emulator: creates the player iframe for one session and resolves with its API.
const DATA_PATH = new URL('../vendor/emulatorjs/data/', import.meta.url).href;
const FRAME_URL = new URL('../player.html', import.meta.url).href;

export class EmuError extends Error {
  constructor(kind, detail) {
    super(detail || kind);
    this.name = 'EmuError';
    this.kind = kind; // files-missing | core-error | timeout | crash
    this.detail = detail || '';
  }
}

let current = null;

export function destroy() {
  if (!current) return;
  const { frame, api } = current;
  current = null;
  try { api && api.destroy(); } catch { /* frame already gone */ }
  frame.remove();
  delete window.__lpLaunch;
}

export const frameElement = () => (current ? current.frame : null);

/**
 * @param {object} o  host (element), rom (Blob), ext, gameName, core, volume, saves ({path: bytes}),
 *                    options (core options), onProgress, onKey, onPointer, onBlur, onRuntimeError
 * @returns {Promise<object>} the frame API (see player-frame.js)
 */
export function launch(o) {
  destroy();
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.className = 'screen__frame';
    frame.title = 'Game screen';
    frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    frame.tabIndex = -1;
    const mine = { frame, api: null };
    let settled = false;
    const finish = (err, api) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        if (current === mine) destroy();
        reject(err);
      } else {
        mine.api = api;
        resolve(api);
      }
    };
    const timer = setTimeout(() => finish(new EmuError('timeout')), 120000);

    window.__lpLaunch = {
      rom: o.rom,
      fileName: `${o.gameName}.${o.ext}`,
      gameName: o.gameName,
      core: o.core,
      dataPath: DATA_PATH,
      volume: o.volume,
      saves: o.saves || {},
      options: o.options || {},
      onProgress: (text) => o.onProgress && o.onProgress(text),
      onStart: (api) => finish(null, api),
      onError: (kind, detail) => {
        if (!settled) finish(new EmuError(kind, detail));
        else if (current === mine && o.onRuntimeError) o.onRuntimeError(new EmuError(kind, detail));
      },
      onKey: (e) => (current === mine && o.onKey ? o.onKey(e) : false),
      onPointer: () => current === mine && o.onPointer && o.onPointer(),
      onBlur: () => current === mine && o.onBlur && o.onBlur(),
    };
    frame.addEventListener('load', () => {
      let booted = false;
      try { booted = !!frame.contentWindow.__lpBooted; } catch { booted = false; }
      if (!booted) finish(new EmuError('files-missing', 'player.html'));
    });
    current = mine;
    frame.src = FRAME_URL;
    o.host.prepend(frame);
  });
}
