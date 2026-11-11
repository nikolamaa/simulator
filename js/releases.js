// First-release dates (anywhere in the world, usually Japan) for well-known games, used to order
// the chronological playthrough. Matching is done on the file name; anything not listed here
// simply shows as "no date" and can be set by hand in the app.
//
// Format: [family, date, ...keywords]. Every keyword must appear in the squashed file name
// ("a|b" means either). When several entries match, the most specific one wins.

const P = 'pokemon|pocketmonsters';

const TABLE = [
  // ---- GB / GBC ----
  ['gb', '1989-04-21', 'supermarioland'],
  ['gb', '1989-06-14', 'tetris'],
  ['gb', '1989-12-15', 'finalfantasylegend'],
  ['gb', '1990-07-27', 'drmario'],
  ['gb', '1991-06-28', 'finalfantasyadventure'],
  ['gb', '1991-11', 'metroid2|metroidii'],
  ['gb', '1992-04-27', 'kirbysdreamland'],
  ['gb', '1992-10-21', 'supermarioland2'],
  ['gb', '1993-06-06', 'zelda', 'linksawakening'],
  ['gb', '1994-01-21', 'warioland'],
  ['gb', '1994-01-21', 'warioland', 'supermarioland3'],
  ['gb', '1994-06-14', 'donkeykong'],
  ['gb', '1995-03-21', 'kirbysdreamland2'],
  ['gb', '1996-02-27', P, 'red'],
  ['gb', '1996-02-27', P, 'green'],
  ['gb', '1996-10-15', P, 'blue'],
  ['gb', '1998-03-09', 'warioland2|wariolandii'],
  ['gb', '1998-09-12', P, 'yellow'],
  ['gb', '1998-09-25', 'dragonwarriormonsters|dragonquestmonsters'],
  ['gb', '1998-12-12', 'zelda', 'linksawakening', 'dx'],
  ['gb', '1998-12-18', P, 'tradingcard'],
  ['gb', '1999-04-14', P, 'pinball'],
  ['gb', '1999-05-10', 'supermariobros', 'deluxe'],
  ['gb', '1999-11-21', P, 'gold'],
  ['gb', '1999-11-21', P, 'silver'],
  ['gb', '2000-03-21', 'warioland3|wariolandiii'],
  ['gb', '2000-04-27', 'metalgearsolid'],
  ['gb', '2000-12-14', P, 'crystal'],
  ['gb', '2001-02-27', 'zelda', 'oracleofseasons'],
  ['gb', '2001-02-27', 'zelda', 'oracleofages'],
  ['gb', '2002-06-04', 'shantae'],

  // ---- GBA ----
  ['gba', '2001-03-21', 'supermarioadvance'],
  ['gba', '2001-03-21', 'castlevania', 'circleofthemoon'],
  ['gba', '2001-07-21', 'mariokart', 'supercircuit'],
  ['gba', '2001-08-01', 'goldensun'],
  ['gba', '2001-08-21', 'warioland4|warioland advance'],
  ['gba', '2001-09-10', 'advancewars'],
  ['gba', '2001-12-14', 'supermarioadvance2|supermarioworld'],
  ['gba', '2002-03-29', 'fireemblem', 'bindingblade|fuuinnotsurugi|swordofseals'],
  ['gba', '2002-06-06', 'castlevania', 'harmonyofdissonance'],
  ['gba', '2002-06-28', 'goldensun', 'lostage'],
  ['gba', '2002-09-20', 'supermarioadvance3|yoshisisland'],
  ['gba', '2002-10-25', 'kirby', 'nightmareindreamland'],
  ['gba', '2002-11-17', 'metroid', 'fusion'],
  ['gba', '2002-11-21', P, 'ruby'],
  ['gba', '2002-11-21', P, 'sapphire'],
  ['gba', '2002-12-02', 'zelda', 'linktothepast'],
  ['gba', '2003-02-14', 'finalfantasytactics'],
  ['gba', '2003-03-21', 'warioware'],
  ['gba', '2003-04-25', 'fireemblem'],
  ['gba', '2003-05-06', 'castlevania', 'ariaofsorrow'],
  ['gba', '2003-06-23', 'advancewars2|advancewars', 'blackholerising'],
  ['gba', '2003-07-11', 'supermarioadvance4|supermariobros3'],
  ['gba', '2003-08-01', P, 'pinball', 'ruby'],
  ['gba', '2003-11-17', 'marioandluigi|marioluigi', 'superstarsaga'],
  ['gba', '2004-01-29', P, 'firered'],
  ['gba', '2004-01-29', P, 'leafgreen'],
  ['gba', '2004-02-09', 'metroid', 'zeromission'],
  ['gba', '2004-04-15', 'kirby', 'amazingmirror'],
  ['gba', '2004-09-16', P, 'emerald'],
  ['gba', '2004-10-07', 'fireemblem', 'sacredstones'],
  ['gba', '2004-11-04', 'zelda', 'minishcap'],
  ['gba', '2005-11-17', P, 'mysterydungeon', 'red'],
  ['gba', '2006-04-20', 'mother3'],

  // ---- NDS ----
  ['nds', '2004-11-21', 'supermario64'],
  ['nds', '2005-03-24', 'kirby', 'canvascurse|powerpaintbrush'],
  ['nds', '2005-06-23', 'advancewars', 'dualstrike'],
  ['nds', '2005-08-25', 'castlevania', 'dawnofsorrow'],
  ['nds', '2005-09-15', 'phoenixwright', 'aceattorney'],
  ['nds', '2005-11-14', 'mariokart'],
  ['nds', '2005-11-17', P, 'mysterydungeon', 'blue'],
  ['nds', '2005-11-23', 'animalcrossing', 'wildworld'],
  ['nds', '2005-11-28', 'marioandluigi|marioluigi', 'partnersintime'],
  ['nds', '2006-03-20', 'metroidprime', 'hunters'],
  ['nds', '2006-03-23', P, 'ranger'],
  ['nds', '2006-05-15', 'newsupermariobros'],
  ['nds', '2006-09-28', P, 'diamond'],
  ['nds', '2006-09-28', P, 'pearl'],
  ['nds', '2006-11-16', 'castlevania', 'portraitofruin'],
  ['nds', '2007-02-15', 'professorlayton', 'curiousvillage'],
  ['nds', '2007-06-23', 'zelda', 'phantomhourglass'],
  ['nds', '2007-07-27', 'worldendswithyou'],
  ['nds', '2007-09-13', P, 'explorersoftime'],
  ['nds', '2007-09-13', P, 'explorersofdarkness'],
  ['nds', '2008-01-21', 'advancewars', 'daysofruin|darkconflict'],
  ['nds', '2008-03-20', P, 'ranger', 'shadowsofalmia'],
  ['nds', '2008-08-07', 'fireemblem', 'shadowdragon'],
  ['nds', '2008-09-13', P, 'platinum'],
  ['nds', '2008-09-22', 'kirby', 'superstarultra'],
  ['nds', '2008-10-21', 'castlevania', 'orderofecclesia'],
  ['nds', '2008-11-20', 'chronotrigger'],
  ['nds', '2009-02-11', 'marioandluigi|marioluigi', 'bowsersinsidestory'],
  ['nds', '2009-04-18', P, 'explorersofsky'],
  ['nds', '2009-07-11', 'dragonquest9|dragonquestix'],
  ['nds', '2009-09-12', P, 'heartgold'],
  ['nds', '2009-09-12', P, 'soulsilver'],
  ['nds', '2009-12-07', 'zelda', 'spirittracks'],
  ['nds', '2010-03-06', P, 'ranger', 'guardiansigns'],
  ['nds', '2010-09-18', P, 'black'],
  ['nds', '2010-09-18', P, 'white'],
  ['nds', '2010-10-28', 'goldensun', 'darkdawn'],
  ['nds', '2012-06-23', P, 'black2'],
  ['nds', '2012-06-23', P, 'white2'],
];

const FAMILY = { gb: 'gb', gbc: 'gb', gba: 'gba', nds: 'nds' };

export function squash(name) {
  return String(name)
    .replace(/\.[a-z0-9]+$/i, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\(\[][^\)\]]*[\)\]]/g, ' ')
    .replace(/&/g, 'and')
    .replace(/\bversion\b|\bthe\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/** Returns 'YYYY-MM-DD' / 'YYYY-MM' or '' when the game is not recognised. */
export function lookupRelease(system, ...names) {
  const family = FAMILY[system];
  let best = '';
  let bestScore = 0;
  for (const name of names) {
    const s = squash(name || '');
    if (!s) continue;
    for (const [fam, date, ...keys] of TABLE) {
      if (fam !== family) continue;
      let score = 0;
      for (const key of keys) {
        const hit = key.split('|').map((k) => k.replace(/\s+/g, '')).find((k) => s.includes(k));
        if (!hit) { score = 0; break; }
        score += hit.length;
      }
      if (score > bestScore) { bestScore = score; best = date; }
    }
  }
  return best;
}

/** Sort key for a release string: unknown dates go last. */
export function releaseKey(release) {
  if (!release) return '9999-99-99';
  const [y, m = '00', d = '00'] = String(release).split('-');
  return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function releaseLabel(release) {
  if (!release) return 'No date';
  const [y, m, d] = String(release).split('-');
  if (!m) return y;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] || '';
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}
