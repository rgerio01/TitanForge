import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = os.tmpdir();
const games = JSON.parse(fs.readFileSync(path.join(tmp, 'ryuu-games.json'), 'utf-8'));

// Lista do Pub's Lounge com preço por hype/lançamento (R$ 29.90 a R$ 39.90)
// Critério:
//   39.90 = hits AAA recentes, hype máximo (Wukong, Stellar Blade, Wilds, MK1, etc)
//   37.90 = AAA recentes/sólidos (Persona 5 Royal, Hogwarts, Mafia, etc)
//   34.90 = AAA mais antigos / nicho forte (Sniper Elite 5, Civ VII, FM2024, etc)
//   31.90 = jogos médios / mais antigos (Sonic Frontiers, Code Vein, Sonic Origins, etc)
//   29.90 = nichos pequenos / antigos / esportivos (Sonic Colors, FM antigo, etc)

const wanted = [
  ['A Total War Saga: TROY', 31.90],
  ['Anno 117: Pax Romana', 39.90],
  ['Anno 1800', 34.90],
  ["Assassin's Creed Shadows", 39.90],
  ['Atomfall', 37.90],
  ['Atomic Heart', 34.90],
  ['Avatar: Frontiers of Pandora', 37.90],
  ['Black Myth: Wukong', 39.90],
  ['Bravely Default Flying Fairy HD Remaster', 34.90],
  ['Code Vein', 29.90],
  ['Code Vein II', 39.90],
  ['Construction Simulator', 31.90],
  ['Crimson Desert', 39.90],
  ['Demon Slayer -Kimetsu no Yaiba- Sweep the Board!', 31.90],
  ['Demon Slayer -Kimetsu no Yaiba- The Hinokami Chronicles', 31.90],
  ['Demon Slayer -Kimetsu no Yaiba- The Hinokami Chronicles 2', 37.90],
  ['Digimon Story Time Stranger', 37.90],
  ['Dragon Quest I & II HD-2D Remake', 37.90],
  ['Dragon Quest VII Reimagined', 39.90],
  ["Dragon's Dogma 2", 37.90],
  ['F1 25', 37.90],
  ['F1 Manager 2024', 31.90],
  ['FAR: Changing Tides', 29.90],
  ['Final Fantasy Tactics - The Ivalice Chronicles', 37.90],
  ['Final Fantasy XV Windows Edition', 31.90],
  ['Five Nights At Skibidi Toilets', 29.90],
  ['Football Manager 2024', 31.90],
  ['Football Manager 26', 39.90],
  ['Hatsune Miku: Project DIVA Mega Mix+', 31.90],
  ['Hello Kitty Island Adventure', 31.90],
  ['Hogwarts Legacy', 37.90],
  ['I Am Jesus Christ', 29.90],
  ['Jurassic World Evolution 2', 31.90],
  ['Jurassic World Evolution 3', 39.90],
  ['Life is Strange: Reunion', 37.90],
  ['Like a Dragon Gaiden: The Man Who Erased His Name', 31.90],
  ['Like a Dragon: Infinite Wealth', 37.90],
  ['Like a Dragon: Ishin!', 31.90],
  ['Like a Dragon: Pirate Yakuza in Hawaii', 37.90],
  ['Lost Judgment', 31.90],
  ['Mafia: The Old Country', 39.90],
  ["Marvel's Midnight Suns", 31.90],
  ['Mega Man Star Force Legacy Collection', 34.90],
  ['Metal Gear Solid V: The Phantom Pain', 29.90],
  ['Metaphor: ReFantazio', 39.90],
  ['Monster Hunter Stories 3: Twisted Reflection', 39.90],
  ['Monster Hunter Wilds', 39.90],
  ['Mortal Kombat 1', 39.90],
  ['Octopath Traveler 0', 37.90],
  ["PARANORMASIGHT: The Mermaid's Curse", 34.90],
  ['Persona 3 Portable', 29.90],
  ['Persona 3 Reload', 37.90],
  ['Persona 4 Arena Ultimax', 29.90],
  ['Persona 4 Golden', 31.90],
  ['Persona 5 Royal', 37.90],
  ['Persona 5 Strikers', 31.90],
  ['Persona 5 Tactica', 31.90],
  ['PGA Tour 2K25', 29.90],
  ['Planet Coaster 2', 34.90],
  ['Planet Zoo', 31.90],
  ['PRAGMATA', 39.90],
  ['Prince of Persia: The Lost Crown', 31.90],
  ['Raidou Remastered: The Mystery of the Soulless Army', 37.90],
  ['Redfall', 29.90],
  ['Resident Evil Requiem', 39.90],
  ['Shin Megami Tensei V: Vengeance', 37.90],
  ['SHINOBI: Art of Vengeance', 37.90],
  ["Sid Meier's Civilization VII", 39.90],
  ['Sniper Elite 4', 29.90],
  ['Sniper Elite 5', 31.90],
  ['Sniper Elite: Resistance', 37.90],
  ['Sonic Colors: Ultimate', 29.90],
  ['Sonic Frontiers', 31.90],
  ['Sonic Origins', 29.90],
  ['Sonic Racing: CrossWorlds', 37.90],
  ['Sonic Superstars', 29.90],
  ['Sonic X Shadow Generations', 34.90],
  ['Soul Hackers 2', 31.90],
  ['Star Wars Outlaws', 37.90],
  ['Stellar Blade', 39.90],
  ['Street Fighter 6', 37.90],
  ['The Bus', 29.90],
  ['The First Berserker: Khazan', 37.90],
  ['TopSpin 2K25', 29.90],
  ['Total War: PHARAOH', 31.90],
  ['Total War: Warhammer III', 31.90],
  ['Two Point Museum', 34.90],
  ['Undisputed', 31.90],
  ['Warhammer 40,000: Chaos Gate - Daemonhunters', 31.90],
  ['Warhammer Age of Sigmar: Realms of Ruin', 29.90],
  ['WWE 2K26', 39.90],
  ['Yakuza Kiwami 3 & Dark Ties', 39.90],
  ['プロ野球スピリッツ 2024-2025', 29.90],
];

// Normaliza pra comparar (lowercase, sem pontuação especial)
function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[®™©]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^\w\s:'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function score(needle, hay) {
  const n = norm(needle);
  const h = norm(hay);
  if (h === n) return 1000;
  if (h.startsWith(n + ' ') || h.startsWith(n + ':')) return 700;
  if (h.includes(n)) return 500;
  // Token overlap
  const nTokens = new Set(n.split(' ').filter(t => t.length >= 3));
  const hTokens = new Set(h.split(' ').filter(t => t.length >= 3));
  let common = 0;
  for (const t of nTokens) if (hTokens.has(t)) common++;
  return common * 50 - Math.abs(h.length - n.length) * 0.5;
}

// Aliases pra nomes que diferem entre Steam e a lista
const aliases = {
  'F1 25': ['F1® 25', 'F1 25'],
  'F1 Manager 2024': ['F1® Manager 2024'],
  'プロ野球スピリッツ 2024-2025': ['Pro Yakyuu Spirits 2024-2025', 'プロ野球スピリッツ', 'eBASEBALL Pro Yakyuu Spirits'],
  'Bravely Default Flying Fairy HD Remaster': ['BRAVELY DEFAULT FLYING FAIRY HD Remaster'],
  'Code Vein': ['CODE VEIN'],
  'Demon Slayer -Kimetsu no Yaiba- Sweep the Board!': ['Demon Slayer -Kimetsu no Yaiba- Sweep the Board'],
  'Final Fantasy XV Windows Edition': ['FINAL FANTASY XV WINDOWS EDITION'],
  'Football Manager 26': ['Football Manager 2026', 'Football Manager 26'],
  'Hatsune Miku: Project DIVA Mega Mix+': ['Hatsune Miku: Project DIVA Mega Mix+'],
  'Mortal Kombat 1': ['Mortal Kombat 1', 'MK1'],
  'Mafia: The Old Country': ['Mafia: The Old Country'],
  'Resident Evil Requiem': ['Resident Evil Requiem'],
  'Sid Meier\'s Civilization VII': ["Sid Meier's Civilization VII"],
  'Sniper Elite: Resistance': ['Sniper Elite: Resistance'],
  'Sonic X Shadow Generations': ['SONIC X SHADOW GENERATIONS'],
  'WWE 2K26': ['WWE 2K26'],
  'Yakuza Kiwami 3 & Dark Ties': ['Yakuza Kiwami 3', 'Like a Dragon: Kiwami 3'],
  'Stellar Blade': ['Stellar Blade'],
  'PRAGMATA': ['PRAGMATA', 'Pragmata'],
  'Atomfall': ['Atomfall'],
  'Crimson Desert': ['Crimson Desert'],
  'Anno 117: Pax Romana': ['Anno 117: Pax Romana', 'Anno 117'],
  'Assassin\'s Creed Shadows': ["Assassin's Creed Shadows"],
  'Code Vein II': ['CODE VEIN II', 'Code Vein 2'],
  'Construction Simulator': ['Construction Simulator'],
  'Demon Slayer -Kimetsu no Yaiba- The Hinokami Chronicles': ['Demon Slayer -Kimetsu no Yaiba- The Hinokami Chronicles'],
  'Demon Slayer -Kimetsu no Yaiba- The Hinokami Chronicles 2': ['Demon Slayer -Kimetsu no Yaiba- The Hinokami Chronicles 2'],
  'Digimon Story Time Stranger': ['DIGIMON STORY: TIME STRANGER'],
  'Dragon Quest I & II HD-2D Remake': ['DRAGON QUEST I & II HD-2D Remake'],
  'Dragon Quest VII Reimagined': ['DRAGON QUEST VII Reimagined'],
  'Dragon\'s Dogma 2': ['Dragon\'s Dogma 2'],
  'FAR: Changing Tides': ['FAR: Changing Tides'],
  'Final Fantasy Tactics - The Ivalice Chronicles': ['FINAL FANTASY TACTICS - The Ivalice Chronicles'],
  'Five Nights At Skibidi Toilets': ['Five Nights At Skibidi Toilets', 'Five Nights at Skibidi Toilets'],
  'Hello Kitty Island Adventure': ['Hello Kitty Island Adventure'],
  'I Am Jesus Christ': ['I Am Jesus Christ'],
  'Jurassic World Evolution 2': ['Jurassic World Evolution 2'],
  'Jurassic World Evolution 3': ['Jurassic World Evolution 3'],
  'Life is Strange: Reunion': ['Life is Strange: Reunion'],
  'Like a Dragon Gaiden: The Man Who Erased His Name': ['Like a Dragon Gaiden: The Man Who Erased His Name'],
  'Like a Dragon: Infinite Wealth': ['Like a Dragon: Infinite Wealth'],
  'Like a Dragon: Ishin!': ['Like a Dragon: Ishin!'],
  'Like a Dragon: Pirate Yakuza in Hawaii': ['Like a Dragon: Pirate Yakuza in Hawaii'],
  'Lost Judgment': ['Lost Judgment'],
  'Marvel\'s Midnight Suns': ["Marvel's Midnight Suns"],
  'Mega Man Star Force Legacy Collection': ['MEGA MAN STAR FORCE Legacy Collection'],
  'Metal Gear Solid V: The Phantom Pain': ['METAL GEAR SOLID V: The Phantom Pain'],
  'Metaphor: ReFantazio': ['Metaphor: ReFantazio'],
  'Monster Hunter Stories 3: Twisted Reflection': ['Monster Hunter Stories 3: Twisted Reflection'],
  'Monster Hunter Wilds': ['Monster Hunter Wilds'],
  'Octopath Traveler 0': ['OCTOPATH TRAVELER 0'],
  'PARANORMASIGHT: The Mermaid\'s Curse': ['PARANORMASIGHT: The Mermaid\'s Curse'],
  'Persona 3 Portable': ['Persona 3 Portable'],
  'Persona 3 Reload': ['Persona 3 Reload'],
  'Persona 4 Arena Ultimax': ['Persona 4 Arena Ultimax'],
  'Persona 4 Golden': ['Persona 4 Golden'],
  'Persona 5 Royal': ['Persona 5 Royal'],
  'Persona 5 Strikers': ['Persona 5 Strikers'],
  'Persona 5 Tactica': ['Persona 5 Tactica'],
  'PGA Tour 2K25': ['PGA TOUR 2K25'],
  'Planet Coaster 2': ['Planet Coaster 2'],
  'Planet Zoo': ['Planet Zoo'],
  'Prince of Persia: The Lost Crown': ['Prince of Persia: The Lost Crown'],
  'Raidou Remastered: The Mystery of the Soulless Army': ['Raidou Remastered: The Mystery of the Soulless Army'],
  'Redfall': ['Redfall'],
  'Shin Megami Tensei V: Vengeance': ['Shin Megami Tensei V: Vengeance'],
  'SHINOBI: Art of Vengeance': ['SHINOBI: Art of Vengeance'],
  'Sniper Elite 4': ['Sniper Elite 4'],
  'Sniper Elite 5': ['Sniper Elite 5'],
  'Sonic Colors: Ultimate': ['Sonic Colors: Ultimate'],
  'Sonic Frontiers': ['Sonic Frontiers'],
  'Sonic Origins': ['Sonic Origins'],
  'Sonic Racing: CrossWorlds': ['Sonic Racing: CrossWorlds'],
  'Sonic Superstars': ['SONIC SUPERSTARS'],
  'Soul Hackers 2': ['Soul Hackers 2'],
  'Star Wars Outlaws': ['Star Wars Outlaws'],
  'Street Fighter 6': ['Street Fighter 6'],
  'The Bus': ['The Bus'],
  'The First Berserker: Khazan': ['The First Berserker: Khazan'],
  'TopSpin 2K25': ['TopSpin 2K25'],
  'Total War: PHARAOH': ['Total War: PHARAOH'],
  'Total War: Warhammer III': ['Total War: WARHAMMER III'],
  'A Total War Saga: TROY': ['A Total War Saga: TROY'],
  'Two Point Museum': ['Two Point Museum'],
  'Undisputed': ['Undisputed'],
  'Warhammer 40,000: Chaos Gate - Daemonhunters': ['Warhammer 40,000: Chaos Gate - Daemonhunters'],
  'Warhammer Age of Sigmar: Realms of Ruin': ['Warhammer Age of Sigmar: Realms of Ruin'],
  'Atomic Heart': ['Atomic Heart'],
  'Avatar: Frontiers of Pandora': ["Avatar: Frontiers of Pandora"],
  'Black Myth: Wukong': ['Black Myth: Wukong'],
  'Hogwarts Legacy': ['Hogwarts Legacy'],
};

// Filtra games que parecem ser jogos full (não DLC/soundtrack)
const candidates = games.filter(g => {
  const t = String(g.type || '').toLowerCase();
  if (t === 'dlc' || t === 'demo' || t === 'music' || t === 'video' || t === 'soundtrack' || t === 'series') return false;
  return true;
});

const results = [];
const missing = [];

for (const [name, price] of wanted) {
  const tries = aliases[name] ? [name, ...aliases[name]] : [name];
  let best = null;
  let bestScore = -Infinity;

  for (const tryName of tries) {
    for (const g of candidates) {
      const s = score(tryName, g.name);
      if (s > bestScore) {
        bestScore = s;
        best = g;
      }
    }
  }

  if (!best || bestScore < 100) {
    missing.push({ name, bestScore, bestMatch: best?.name });
    continue;
  }

  results.push({
    requested: name,
    matched: best.name,
    appid: best.appid,
    score: bestScore,
    price,
  });
}

console.log('\n=== ENCONTRADOS ===');
for (const r of results) {
  const flag = r.score >= 700 ? '✅' : r.score >= 500 ? '🟡' : '⚠️';
  console.log(`${flag} [${r.score}] "${r.requested}" → "${r.matched}" (${r.appid}) — R$ ${r.price.toFixed(2)}`);
}

console.log('\n=== NÃO ENCONTRADOS ===');
for (const m of missing) {
  console.log(`❌ "${m.name}" — melhor match: "${m.bestMatch}" (score ${m.bestScore})`);
}

console.log(`\nTotal: ${results.length} encontrados / ${missing.length} faltando de ${wanted.length}`);

// Gera SQL
let sql = '-- Insere jogos do Pub\'s Lounge na denuvo_games\n';
sql += '-- Preços baseados em hype/lançamento (R$ 29.90 a R$ 39.90)\n\n';
sql += 'INSERT INTO denuvo_games (name, game_id, price, active) VALUES\n';
// Escapa aspas simples pra Postgres (Brazil's → Brazil''s)
const sqlEscape = (s) => `'${String(s).replace(/'/g, "''")}'`;
const rows = results.map(r => `  (${sqlEscape(r.matched)}, '${r.appid}', ${r.price.toFixed(2)}, true)`);
sql += rows.join(',\n') + '\n';
sql += "ON CONFLICT DO NOTHING;\n";

const sqlPath = path.join(tmp, 'insert-denuvo-games.sql');
fs.writeFileSync(sqlPath, sql);
console.log('\n📝 SQL gerado em', sqlPath);
