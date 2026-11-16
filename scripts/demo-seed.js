'use strict';
/*
 * Données de démonstration pour prévisualiser le site en local.
 * NE PAS lancer en production : utilise des joueurs et adversaires fictifs.
 *   DATA_DIR=./data-demo npm run demo
 */
const { db, setSetting, tx } = require('../src/db');
const { saveImage } = require('../src/upload');

if (db.prepare('SELECT COUNT(*) n FROM players').get().n > 0 && !process.argv.includes('--force')) {
  console.error('La base contient déjà des joueurs. Relance avec --force pour ajouter quand même la démo.');
  process.exit(1);
}

const today = new Date();
const ymd = d => d.toISOString().slice(0, 10);
const addDays = n => { const d = new Date(today); d.setDate(d.getDate() + n); return ymd(d); };

const players = [
  ['Thomas', 'Lefebvre', 1, 'GB', 'Gardien titulaire', 1],
  ['Kévin', 'Dupont', 16, 'GB', 'Gardien', 0],
  ['Julien', 'Martin', 2, 'DEF', 'Latéral droit', 0],
  ['Maxime', 'Bernard', 4, 'DEF', 'Défenseur central', 0],
  ['Antoine', 'Petit', 5, 'DEF', 'Défenseur central', 0],
  ['Romain', 'Durand', 3, 'DEF', 'Latéral gauche', 0],
  ['Nicolas', 'Leroy', 13, 'DEF', 'Défenseur', 0],
  ['Florian', 'Moreau', 6, 'MIL', 'Milieu défensif', 0],
  ['Alexandre', 'Simon', 8, 'MIL', 'Milieu relayeur', 0],
  ['Quentin', 'Laurent', 10, 'MIL', 'Meneur de jeu', 0],
  ['Benjamin', 'Michel', 7, 'MIL', 'Ailier droit', 0],
  ['Pierre', 'Garcia', 14, 'MIL', 'Milieu', 0],
  ['Hugo', 'Roux', 9, 'ATT', 'Avant-centre', 0],
  ['Lucas', 'Fournier', 11, 'ATT', 'Ailier gauche', 0],
  ['Mathieu', 'Girard', 17, 'ATT', 'Attaquant', 0],
  ['Philippe', 'Bonnet', null, 'STAFF', 'Entraîneur', 0],
  ['Sébastien', 'Lambert', null, 'STAFF', 'Dirigeant / délégué', 0]
];

const teams = ['ES Naours', 'US Bertangles', 'AS Talmas', 'FC Villers-Bocage 2', 'ES Flesselles 3', 'JS Rubempré', 'AS Wargnies', 'US Vignacourt 3', 'FC Canaples', 'ES Molliens 2'];

(async () => {
  setSetting('fff_team_pattern', 'NAOURS');
  tx(() => {
    const ins = db.prepare(`INSERT INTO players (first_name, last_name, number, position, role, is_captain, birth_date, height, foot, joined, matches, goals, assists, yellow_cards, bio)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    players.forEach(([f, l, n, pos, role, cap], i) => {
      const staff = pos === 'STAFF';
      ins.run(f, l, n, pos, role, cap, staff ? null : `${1990 + (i % 12)}-0${1 + (i % 9)}-1${i % 9}`, staff ? null : 170 + (i * 3) % 20,
        staff ? null : (i % 4 === 0 ? 'Gauche' : 'Droit'), String(2012 + (i % 12)), staff ? 0 : 3 + (i % 6), pos === 'ATT' ? 2 + i % 5 : pos === 'MIL' ? i % 3 : 0,
        i % 4, i % 3 === 0 ? 1 : 0, staff ? 'Fidèle au club depuis de nombreuses saisons.' : 'Formé au club, **toujours fidèle au poste** le dimanche.');
    });

    const insM = db.prepare(`INSERT INTO matches (source, competition, round, date, time, home_team, away_team, home_score, away_score, is_home, venue) VALUES ('manual','D5',?,?,?,?,?,?,?,?,?)`);
    const scores = [[3, 1], [1, 1], [0, 2], [4, 0], [2, 2], [1, 0]];
    for (let j = 1; j <= 9; j++) {
      const opp = teams[j];
      const home = j % 2 === 1;
      const played = j <= 6;
      const s = played ? scores[j - 1] : [null, null];
      const [hs, as] = home ? s : [s[1], s[0]];
      insM.run(`J${j}`, addDays((j - 7) * 7 + 6), '15:00', home ? 'ES Naours' : opp, home ? opp : 'ES Naours', hs, as, home ? 1 : 0, home ? 'Stade municipal – Naours' : `Stade de ${opp.replace(/^\w+ /, '').replace(/ \d$/, '')}`);
    }

    const table = [
      ['US Bertangles', 16, 6, 5, 1, 0, 15, 5], ['ES Naours', 11, 6, 3, 2, 1, 11, 6], ['AS Talmas', 11, 6, 3, 2, 1, 9, 6],
      ['FC Villers-Bocage 2', 9, 6, 3, 0, 3, 10, 9], ['JS Rubempré', 8, 6, 2, 2, 2, 8, 8], ['ES Flesselles 3', 7, 6, 2, 1, 3, 7, 10],
      ['AS Wargnies', 6, 6, 1, 3, 2, 6, 8], ['US Vignacourt 3', 5, 6, 1, 2, 3, 5, 9], ['FC Canaples', 4, 6, 1, 1, 4, 6, 12], ['ES Molliens 2', 2, 6, 0, 2, 4, 4, 13]
    ];
    const insS = db.prepare('INSERT INTO standings (rank, team, points, played, won, drawn, lost, goals_for, goals_against, goal_diff, is_us) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    table.forEach((r, i) => insS.run(i + 1, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[6] - r[7], r[0] === 'ES Naours' ? 1 : 0));

    db.prepare('INSERT INTO posts (title, body, pinned) VALUES (?,?,1)').run('Reprise de l\'entraînement', "Les entraînements reprennent **mercredi à 19h** au stade.\n\n- Venez avec vos crampons\n- Licences à renouveler avant fin du mois");
    db.prepare('INSERT INTO posts (title, body) VALUES (?,?)').run('Loto du club : merci à tous !', 'Grand succès pour notre loto annuel. Merci aux bénévoles et à tous les participants !');
  });

  // compo du prochain match
  const next = db.prepare("SELECT id FROM matches WHERE home_score IS NULL ORDER BY date LIMIT 1").get();
  const ids = db.prepare("SELECT id, position FROM players WHERE position != 'STAFF' ORDER BY id").all().map(p => p.id);
  db.prepare('INSERT INTO lineups (match_id, formation, slots, subs, captain_id, meeting, notes, published) VALUES (?,?,?,?,?,?,?,1)')
    .run(next.id, '4-4-2', JSON.stringify([ids[0], ids[5], ids[3], ids[4], ids[2], ids[13], ids[7], ids[8], ids[10], ids[12], ids[9]]), JSON.stringify([ids[1], ids[6], ids[11], ids[14]]), ids[0],
      '13h45 au stade de Naours', 'On reste **solidaires** et on joue simple. Allez les verts !');

  // album photo avec images générées
  const last = db.prepare('SELECT * FROM matches WHERE home_score IS NOT NULL ORDER BY date DESC LIMIT 1').get();
  const aid = Number(db.prepare('INSERT INTO albums (title, match_id, date, description) VALUES (?,?,?,?)').run(`${last.home_team} – ${last.away_team}`, last.id, last.date, 'Les photos du dernier match.').lastInsertRowid);
  const colors = ['#0a6b3a', '#16a05a', '#053b21', '#0d8247', '#7fd1a3', '#13894b'];
  for (let i = 0; i < 6; i++) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${i % 2 ? 800 : 900}"><rect width="100%" height="100%" fill="${colors[i]}"/><circle cx="600" cy="420" r="160" fill="none" stroke="#fff" stroke-width="8" opacity=".6"/><text x="600" y="450" font-size="90" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="bold">Photo ${i + 1}</text></svg>`;
    const s = await saveImage(Buffer.from(svg), `albums/${aid}`, { max: 2000, thumb: 480 });
    db.prepare('INSERT INTO photos (album_id, file, thumb, sort_order, caption) VALUES (?,?,?,?,?)').run(aid, s.file, s.thumb, i, i === 0 ? 'Avant le coup d\'envoi' : null);
  }
  console.log('Données de démonstration ajoutées.');
})();
