# Licences

Longplay's own code (everything outside `vendor/` and `fonts/`) is released under the
GNU General Public License, version 3 or later. See `LICENSE`. It has to be GPL-compatible because
it ships with, and drives, EmulatorJS.

Longplay contains no games, no console firmware and no BIOS files.

## Bundled third-party software

| Component | Where | Licence | Source |
|---|---|---|---|
| EmulatorJS 4.2.3 (web front end for RetroArch) | `vendor/emulatorjs/data/` | GPL-3.0 (`vendor/emulatorjs/LICENSE`) | https://github.com/EmulatorJS/EmulatorJS |
| RetroArch (inside every core file) | `vendor/emulatorjs/data/cores/*.data` | GPL-3.0 | https://github.com/EmulatorJS/RetroArch |
| Gambatte core (GB, GBC) | `cores/gambatte-*.data` | GPL-2.0 | https://github.com/EmulatorJS/gambatte-libretro |
| mGBA core (GBA; optional for GB, GBC) | `cores/mgba-*.data` | MPL-2.0 | https://github.com/EmulatorJS/mgba |
| melonDS core (NDS) | `cores/melonds-*.data` | GPL-3.0 | https://github.com/EmulatorJS/melonDS |
| DeSmuME 2015 core (NDS, alternative) | `cores/desmume2015-*.data` | GPL-2.0 | https://github.com/EmulatorJS/desmume2015 |
| fflate 0.8 (zip and gzip) | `vendor/fflate.js` | MIT (`vendor/fflate.LICENSE`) | https://github.com/101arrowz/fflate |
| Bai Jamjuree typeface | `fonts/` | SIL Open Font License 1.1 (`fonts/OFL.txt`) | https://github.com/cadsondemak/Bai-Jamjuree |

The EmulatorJS files are unmodified copies from the npm packages `@emulatorjs/emulatorjs@4.2.3`
and `@emulatorjs/core-<name>@4.2.3`. Each `.data` file is a 7-Zip archive; the Gambatte, mGBA and
melonDS archives carry their licence text as `license.txt`. Longplay changes EmulatorJS's
behaviour only at run time, from `js/player-frame.js` (it hides EmulatorJS's own menus, disables
its update check and its storage, and routes input itself).

If you pass this folder on to someone else, pass on these notices and the licence files with it.
