# Longplay

A single-page front end for playing your own GB, GBC, GBA and NDS game files in the browser, in
order of release, with progress saved automatically. Everything runs in the browser: there is no
server code, no account and no upload. You supply the game files (`.gb`, `.gbc`, `.gba`, `.nds`).

Emulation is done by [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) 4.2.3 (RetroArch cores
compiled to WebAssembly), bundled in `vendor/` so the site is self-contained:

| System | Core | Alternative |
|---|---|---|
| GB, GBC | Gambatte | mGBA |
| GBA | mGBA | |
| NDS | melonDS | DeSmuME 2015 |

## Run it

It is a plain static site: no build step, no dependencies to install. It does need to be served
over HTTP, because browsers refuse to load modules and WebAssembly from `file://`.

```
cd longplay
python3 -m http.server 8080        # or: npx serve .
```

Then open <http://localhost:8080>.

## Host it

Upload the whole folder, unchanged, to any static host. `index.html` must sit next to `js/`,
`css/`, `fonts/`, `vendor/` and `player.html`. All paths are relative, so a sub-folder works.

- **GitHub Pages**: push the folder to a repository, then Settings, Pages, deploy from the branch.
  The included `.nojekyll` file stops GitHub from processing the files.
- **Netlify / Cloudflare Pages / Vercel**: drag the folder in, or connect the repository.
  Build command: none. Output directory: the folder itself.
- **Your own server** (nginx, Apache, Caddy, a NAS): point a site at the folder.

Things worth knowing:

- **Use HTTPS** (or `localhost`). Over plain HTTP on a LAN address the app still runs, but
  browsers will not grant persistent storage or let it be installed, and some hide gamepads.
- **No special headers** are needed. The cores run single-threaded, so the site does not need
  cross-origin isolation.
- **Saves belong to the address.** Browsers keep storage per origin, so
  `https://example.com` and `http://localhost:8080` each have their own library. Move between
  them with Settings, Export backup / Import backup.
- The folder is about 9.5 MB, nearly all of it the four emulator cores.

## How saving works

Everything is in IndexedDB (database `longplay`).

1. **The game file** is stored the first time you add it. Files are recognised by content, so
   adding the same file twice is harmless, and re-adding a removed file reconnects it to its saves.
2. **In-game (battery) saves.** Every 2 seconds the emulator's save folder is compared with the
   last copy and any change is written. The light in the top bar blinks red and then reads
   "Saved" with the time once it is stored.
3. **Auto-save state.** Written every 60 seconds, right after every in-game save, when you leave
   the game, when the tab is hidden, and when the tab is closed. **Continue** resumes from it.
4. **Ten manual slots** per game, each with a thumbnail, the time it was made and the play time
   at that moment. F2 saves to the current slot, F4 loads it, Tab opens the panel.

"Play time" is the time the game has been running in Longplay. It is not read from the game's
own clock.

Settings, Storage shows what each game uses, asks the browser to protect the data from automatic
clean-up (`navigator.storage.persist()`), and lets you delete a game or just its save states.

**Backups.** Settings, Export backup writes one `.zip` with every in-game save, save state,
thumbnail, note, finished mark, release date, box art and setting. Game files are not included.
Import it on another browser, then add the game files: each reconnects to its saves.
In-game saves in the zip are plain `.srm`/`.sav` files; save states are raw core states.

**Saves from other emulators.** Open a game's details (the ... button) and choose Import save
file. Raw `.sav`/`.srm` files work as they are; the footer DeSmuME adds to `.dsv` files is removed.
Export save file gives you a plain `.sav` to take elsewhere.

## Controls

All of these can be changed in Settings, Controls. Press `?` anywhere for the current list.

| Action | Keyboard | Controller (standard layout) |
|---|---|---|
| D-pad | Arrow keys | D-pad or left stick |
| A / B | X / Z | right / bottom face button |
| X / Y (NDS) | S / A | top / left face button |
| L / R | Q / W | shoulder buttons |
| Start / Select | Enter / Backspace | Start / Select |
| Fast-forward (hold) | Space | right trigger |
| Rewind (hold) | R | left trigger |
| Pause | P | |
| Save / load current slot | F2 / F4 | |
| Save states panel | Tab | |
| Mute, fullscreen | M, F | |
| Game menu | Esc | Home / Guide |

Controllers are detected through the Gamepad API when you press a button. Button names follow
the controller family (Xbox, PlayStation, Switch Pro); the default mapping is by position, so
the right-hand face button is always A. If a controller disconnects, the game pauses.

On phones and tablets, on-screen controls appear by themselves. To move or resize them, open the
game menu and choose Edit touch layout; portrait and landscape are stored separately.

**NDS stylus.** Click or touch the lower screen. Settings also offers a captured-mouse mode
(click to lock the mouse to the game, Esc to release).

## Playthrough

The Playthrough view lists your games by first release (anywhere in the world, usually Japan),
shows which one is up next, and tracks what you have finished. Drag a row by its handle, or use
the arrow keys on the handle, to arrange the list by hand; "Sort by release date" undoes that.

Dates come from a built-in list of about 110 well-known games in `js/releases.js`, matched
against the file name. Click any date to change it, or to set one for a game the list does not
know. The list was written from memory, so treat it as a starting point and correct anything
that looks wrong; it is one plain array and easy to extend.

## What was tested, and what was not

Tested in Google Chrome for Testing 153.0.8010.12  (headless, software rendering), with small test cartridges written for the
purpose. No commercial game was used.

Checked and working there:

- GB, GBC, GBA and NDS files boot through the app and take keyboard input. Speed on the test
  machine (one CPU core, no GPU): 60 fps in a 640x480 window, 51 to 58 fps at 1280x800.
- In-game saves reach IndexedDB by themselves and survive a reload; Continue resumes exactly
  where play stopped after leaving, after a hidden tab, after navigating away and after closing
  the tab.
- Ten slots with thumbnails, quick save/load, rewind (GB, GBC, GBA), fast-forward, pause, reset,
  mute, volume, fullscreen, the three picture filters and three picture shapes.
- Library, details, notes, box art, release ordering, drag and keyboard reordering.
- Key remapping; controllers through a simulated Gamepad API; touch controls and the layout
  editor on an emulated phone; the NDS stylus by mouse (ordinary and high-density screens) and by
  finger, on both NDS cores.
- Backup export, and import into an empty browser; `.sav` import and export.
- Failure handling: damaged, empty, zipped and unreadable game files; storage full while adding a
  game and while playing; a core that fails to load; a lost controller.

Not tested, so please check these yourself:

- **Real commercial games.** The cores are the standard EmulatorJS ones, but nothing here has
  been run against a retail cartridge dump.
- **Firefox and Safari.** Only Chromium was available. Sharp scaling relies on the browser
  honouring `image-rendering: pixelated` for a scaled frame; if a browser does not, the picture
  will look soft rather than break.
- **Real controllers, real phones, real speakers.** Gamepads and touch were simulated, and audio
  was only checked as "running", not listened to.
- **Speed on real hardware**, in particular NDS on phones.

Known limits:

- **NDS**: no rewind (its save states are 6 to 12 MB each). melonDS writes its save file about
  five seconds after the game saves, so wait for the save light before closing the tab; if you
  leave through the app, it waits for you. A close-time auto-save of that size may not finish
  writing; the 60-second auto-save is the fallback.
- **GBA**: after a save state has been loaded, mGBA holds a new in-game save back for about a
  quarter of a second before writing it out. Leaving through the app waits for it.
- **DeSmuME 2015**: booting, save states and the stylus were checked. Whether its in-game saves
  round-trip correctly was not, because the test cartridge does not suit its save detection.
- **Big NDS files** are copied into the emulator's memory. A 256 MB game needs well over 500 MB
  of free RAM and may not start on a phone.
- **Safari** deletes a site's storage after seven days without a visit unless the site is added
  to the Home Screen. On iPhone there is no real fullscreen, so Longplay hides its own bars
  instead.
- **Offline**: there is no service worker. Once loaded the app needs no network, but opening it
  again needs the host (or the browser's cache).
- A save state only loads in the core that made it. In-game saves carry over between cores.

## Updating EmulatorJS or adding cores

`vendor/emulatorjs/data/` mirrors EmulatorJS's `data/` folder: `src/`, `compression/`,
`emulator.css` and `cores/` (the `<core>-wasm.data` and `<core>-legacy-wasm.data` files plus
`cores/reports/<core>.json`). To update, replace those with the same files from a newer
`@emulatorjs/emulatorjs` and `@emulatorjs/core-*` npm release of matching version, then test:
`js/player-frame.js` relies on a few EmulatorJS internals (the save folder, the state calls and
the event names) and `js/systems.js` records where each core keeps its save.

## Files

```
index.html            the app shell
player.html           the game screen, loaded in a frame for each play session
css/app.css           all styles
js/app.js             start-up and navigation
js/store.js           IndexedDB
js/player.js          play session: saving, states, rewind, layout, menus
js/player-frame.js    boots EmulatorJS inside player.html
js/emu.js             creates and removes that frame
js/library.js         library, playthrough, game details
js/releases.js        release dates
js/input.js           keyboard and controller bindings
js/touch.js           on-screen controls and their editor
js/settings.js        settings and the shortcuts sheet
js/backup.js          zip export and import
js/saves.js           .sav import and export
js/systems.js         systems, cores, file checks
vendor/               EmulatorJS 4.2.3 with four cores, and fflate
fonts/                Bai Jamjuree
```

## Licence

GPL-3.0-or-later; see `LICENSE` and `LICENSES.md` for the bundled components. Longplay includes
no games. Use it with game files you are entitled to use.
