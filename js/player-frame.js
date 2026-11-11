// Runs inside player.html, an iframe the app creates for one play session. It boots EmulatorJS for
// a single game and hands a small API back to the host page. Tearing the iframe down is what frees
// the emulator: EmulatorJS is built to run once per page.
(function () {
  'use strict';
  window.__lpBooted = true;

  var L = null;
  try { L = window.parent !== window ? window.parent.__lpLaunch : null; } catch (e) { L = null; }
  if (!L) {
    document.body.innerHTML = '<p style="color:#bbb;font:15px system-ui;padding:20px">This page is only the game screen. Open index.html instead.</p>';
    return;
  }

  var SCRIPTS = ['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'socket.io.min.js', 'compression.js'];
  var SAVE_ROOT = '/data/saves';
  var emu = null;
  var started = false;
  var failed = false;

  function fail(kind, detail) {
    if (failed) return;
    failed = !started;
    try { L.onError(kind, String(detail || '')); } catch (e) { /* host is gone */ }
  }

  // Keys: the host owns every binding. Nothing else in this frame may see keyboard events,
  // otherwise the emulator's own defaults would double up with the user's mapping.
  function forwardKey(e) {
    e.stopImmediatePropagation();
    var used = false;
    try { used = L.onKey(e); } catch (err) { /* ignore */ }
    if (used) e.preventDefault();
  }
  window.addEventListener('keydown', forwardKey, true);
  window.addEventListener('keyup', forwardKey, true);
  window.addEventListener('pointerdown', function () { try { L.onPointer(); } catch (e) { /* ignore */ } }, true);
  window.addEventListener('blur', function () { try { L.onBlur(); } catch (e) { /* ignore */ } });
  // EmulatorJS resets the game when its page unloads. The host captures the auto-save while the
  // tab closes, so that reset must never run.
  window.addEventListener('beforeunload', function (e) { e.stopImmediatePropagation(); }, true);
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('unhandledrejection', function (e) {
    if (/wake ?lock/i.test(String(e.reason))) e.preventDefault();
  });
  window.addEventListener('error', function (e) {
    var msg = String((e && e.message) || '');
    if (started && /abort|RuntimeError|out of memory|unreachable/i.test(msg)) fail('crash', msg);
  });

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error(src)); };
      document.head.appendChild(s);
    });
  }

  function mkdirp(FS, dir) {
    var cur = '';
    dir.split('/').forEach(function (part) {
      if (!part) return;
      cur += '/' + part;
      try { FS.mkdir(cur); } catch (e) { /* exists */ }
    });
  }

  function walk(FS, dir, rel, out) {
    var names;
    try { names = FS.readdir(dir); } catch (e) { return; }
    names.forEach(function (name) {
      if (name === '.' || name === '..') return;
      var path = dir + '/' + name;
      var st;
      try { st = FS.stat(path); } catch (e) { return; }
      if (FS.isDir(st.mode)) walk(FS, path, rel + name + '/', out);
      else if (st.size > 0) {
        try { out[rel + name] = FS.readFile(path); } catch (e) { /* being written */ }
      }
    });
  }

  function pngComplete(d) {
    var n = d.length;
    return n > 20 && d[n - 8] === 0x49 && d[n - 7] === 0x45 && d[n - 6] === 0x4e && d[n - 5] === 0x44;
  }

  function audioCtx() {
    try {
      var al = emu.Module.AL;
      return al && al.currentCtx ? al.currentCtx.audioCtx : null;
    } catch (e) { return null; }
  }

  // Pointer bridge for the game picture (this is what makes the NDS stylus work).
  //  1. Fingers and pens: the cores read the stylus from mouse events, and browsers only send
  //     those for a finished tap, so a held or dragged finger would never register. Touch and
  //     pen pointers are turned into mouse events as they happen.
  //  2. Scale: the core multiplies mouse positions by the display's pixel ratio but draws its
  //     canvas at one canvas pixel per CSS pixel, so on any high-density screen a press lands
  //     in the wrong place. Every mouse event is re-sent with the position corrected.
  function bridgePointer() {
    var canvas = emu.canvas;
    var active = null;
    function fire(type, e, buttons, button) {
      var r = canvas.getBoundingClientRect();
      var k = r.width && canvas.width ? ((window.devicePixelRatio || 1) * r.width) / canvas.width : 1;
      canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: r.left + (e.clientX - r.left) / k, clientY: r.top + (e.clientY - r.top) / k,
        screenX: e.screenX, screenY: e.screenY,
        movementX: e.movementX || 0, movementY: e.movementY || 0, button: button || 0, buttons: buttons,
      }));
    }
    ['mousedown', 'mousemove', 'mouseup'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (!e.isTrusted || e.target !== canvas) return;
        e.stopImmediatePropagation();
        fire(type, e, e.buttons, e.button);
      }, true);
    });
    // The core's own touch handling has the same scaling problem and would override the
    // corrected mouse position while a finger is down, so raw touch events stop here.
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (e.target !== canvas) return;
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
      }, { capture: true, passive: false });
    });
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || active !== null) return;
      active = e.pointerId;
      e.preventDefault(); // also stops the browser's own late mouse events for this touch
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      fire('mousemove', e, 0);
      fire('mousedown', e, 1);
    });
    canvas.addEventListener('pointermove', function (e) { if (e.pointerId === active) fire('mousemove', e, 1); });
    function end(e) {
      if (e.pointerId !== active) return;
      active = null;
      fire('mouseup', e, 0);
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
  var shots = Promise.resolve();
  var stateSeq = 0;
  var stateCleanup = 0;

  var api = {
    core: L.core,
    dims: function () {
      var g = emu.gameManager;
      return {
        width: g.getVideoDimensions('width') || 0,
        height: g.getVideoDimensions('height') || 0,
        aspect: g.getVideoDimensions('aspect') || 0,
      };
    },
    frame: function () { return emu.gameManager.getFrameNum(); },
    input: function (index, value) { emu.gameManager.simulateInput(0, index, value); },
    setRunning: function (on) { emu.gameManager.toggleMainLoop(on ? 1 : 0); emu.paused = !on; },
    reset: function () { emu.gameManager.restart(); },
    fastForward: function (on) { emu.gameManager.toggleFastForward(on ? 1 : 0); },
    setFastForwardRatio: function (ratio) { emu.gameManager.setFastForwardRatio(ratio); },
    setVolume: function (v) { emu.volume = v; emu.setVolume(v); },
    setSmooth: function (on) { document.documentElement.classList.toggle('smooth', !!on); },
    setMouseCapture: function (on) { emu.enableMouseLock = !!on; },
    wantsMouse: function () { return !!emu.enableMouseLock; },
    supportsStates: function () { try { return emu.gameManager.supportsStates(); } catch (e) { return false; } },
    getState: function () { return emu.gameManager.getState(); },
    // Like EmulatorJS's loadState, but without its delayed file cleanup (which can delete a
    // newer state file while it is still being read when loads come close together).
    loadState: function (bytes) {
      var g = emu.gameManager;
      var name = 'lp-' + (stateSeq++ % 2) + '.state';
      try { g.FS.unlink('/' + name); } catch (e) { /* not there */ }
      g.FS.writeFile('/' + name, bytes);
      g.clearEJSResetTimer();
      g.functions.loadState(name, 0);
      clearTimeout(stateCleanup);
      stateCleanup = setTimeout(function () {
        ['lp-0.state', 'lp-1.state'].forEach(function (n) { try { g.FS.unlink('/' + n); } catch (e) { /* gone */ } });
      }, 4000);
    },
    // Rewind step: load a state and let exactly enough frames through to show it.
    stepState: function (bytes) {
      api.loadState(bytes);
      emu.gameManager.toggleMainLoop(1);
      return raf().then(raf).then(function () { emu.gameManager.toggleMainLoop(0); });
    },
    // PNG of the game's own frame at native resolution. Only works while the game is running.
    // Requests are queued: they share one file, so two at once would steal each other's picture.
    screenshot: function (timeoutMs) {
      var run = function () { return api.screenshotNow(timeoutMs); };
      shots = shots.then(run, run);
      return shots;
    },
    screenshotNow: function (timeoutMs) {
      var g = emu.gameManager;
      var FS = g.FS;
      var deadline = performance.now() + (timeoutMs || 1500);
      try { FS.unlink('/screenshot.png'); } catch (e) { /* not there */ }
      try { g.functions.screenshot(); } catch (e) { return Promise.resolve(null); }
      return new Promise(function (resolve) {
        (function poll() {
          try {
            if (FS.stat('/screenshot.png').size > 0) {
              var data = FS.readFile('/screenshot.png');
              if (pngComplete(data)) {
                try { FS.unlink('/screenshot.png'); } catch (e) { /* gone */ }
                resolve(data);
                return;
              }
            }
          } catch (e) { /* not written yet */ }
          if (performance.now() > deadline) resolve(null);
          else setTimeout(poll, 30);
        })();
      });
    },
    savePath: function () {
      try {
        var p = emu.gameManager.getSaveFilePath();
        return p && p.indexOf(SAVE_ROOT + '/') === 0 ? p.slice(SAVE_ROOT.length + 1) : null;
      } catch (e) { return null; }
    },
    // Everything in the core's save folder, keyed by path relative to it.
    readSaves: function (flush) {
      var g = emu.gameManager;
      if (flush) { try { g.functions.saveSaveFiles(); } catch (e) { /* core has no save memory */ } }
      var files = {};
      walk(g.FS, SAVE_ROOT, '', files);
      return files;
    },
    audioState: function () { var c = audioCtx(); return c ? c.state : 'none'; },
    resumeAudio: function () { var c = audioCtx(); if (c && c.state !== 'running') { try { c.resume(); } catch (e) { /* needs a gesture */ } } },
    focus: function () { try { window.focus(); } catch (e) { /* ignore */ } },
    destroy: function () {
      try { emu.gameManager.toggleMainLoop(0); } catch (e) { /* not started */ }
      try { var c = audioCtx(); if (c) c.close(); } catch (e) { /* ignore */ }
    },
  };

  (async function boot() {
    var base = L.dataPath;
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = base + 'emulator.css';
    document.head.appendChild(css);
    try {
      for (var i = 0; i < SCRIPTS.length; i++) await loadScript(base + 'src/' + SCRIPTS[i]);
    } catch (e) {
      fail('files-missing', e.message);
      return;
    }
    if (typeof EmulatorJS !== 'function') { fail('files-missing', 'emulator.js'); return; }

    // No update pings to third parties; this copy is pinned on purpose.
    EmulatorJS.prototype.checkForUpdates = function () {};
    var showError = EmulatorJS.prototype.startGameError;
    EmulatorJS.prototype.startGameError = function (message) {
      try { showError.call(this, message); } catch (e) { /* its UI is hidden anyway */ }
      fail('core-error', message);
    };

    try {
      emu = new EmulatorJS('#game', {
        gameUrl: new File([L.rom], L.fileName),
        gameName: L.gameName,
        system: L.core,
        dataPath: base,
        startOnLoad: true,
        volume: L.volume,
        threads: false,
        disableDatabases: true,
        disableLocalStorage: true,
        noAutoFocus: true,
        defaultControllers: { 0: {}, 1: {}, 2: {}, 3: {} },
        defaultOptions: L.options || {},
        shaders: {},
        backgroundColor: '#000',
      });
    } catch (e) {
      fail('core-error', (e && e.message) || e);
      return;
    }
    window.EJS_emulator = emu;

    var lastText = '';
    var mo = new MutationObserver(function () {
      var t = emu.textElem ? emu.textElem.textContent : '';
      if (t && t !== lastText) { lastText = t; try { L.onProgress(t); } catch (e) { /* ignore */ } }
    });
    mo.observe(document.getElementById('game'), { childList: true, subtree: true, characterData: true });

    // The save folder is ready but the game has not booted yet: make the host's copy the only copy.
    emu.on('saveDatabaseLoaded', function (FS) {
      try { FS.unmount(SAVE_ROOT); } catch (e) { /* was not mounted */ }
      mkdirp(FS, SAVE_ROOT);
      Object.keys(L.saves || {}).forEach(function (rel) {
        try {
          var path = SAVE_ROOT + '/' + rel;
          mkdirp(FS, path.slice(0, path.lastIndexOf('/')));
          FS.writeFile(path, L.saves[rel]);
        } catch (e) { console.warn('Longplay: could not restore save file', rel, e); }
      });
    });

    emu.on('start', function () {
      started = true;
      mo.disconnect();
      emu.functions.exit = [];                       // see the beforeunload note above
      try { emu.gamepad.terminate(); } catch (e) { /* host polls gamepads itself */ }
      try { bridgePointer(); } catch (e) { console.warn('Longplay: pointer bridge not installed', e); }
      try { L.onStart(api); } catch (e) { console.error(e); }
    });
  })();
})();
