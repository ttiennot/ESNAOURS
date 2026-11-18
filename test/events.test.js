'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'esn-events-'));
const { db } = require('../src/db');
const events = require('../src/events');

const pid = (f, l, n) => Number(db.prepare("INSERT INTO players (first_name, last_name, number, position) VALUES (?,?,?, 'ATT')").run(f, l, n).lastInsertRowid);
const roux = pid('Hugo', 'Roux', 9);
const simon = pid('Alexandre', 'Simon', 8);
const petit = pid('Antoine', 'Petit', 5);
const match = Number(db.prepare("INSERT INTO matches (home_team, away_team, home_score, away_score, is_home, date) VALUES ('ES Naours', 'AS Talmas', 3, 1, 1, '2026-11-08')").run().lastInsertRowid);
db.prepare('INSERT INTO lineups (match_id, slots, subs, published) VALUES (?,?,?,1)').run(match, JSON.stringify([roux, simon]), JSON.stringify([petit]));

test('saisie des faits de match', () => {
  events.add(match, { type: 'goal', side: 'us', minute: '12', player_id: String(roux), assist_id: String(simon) });
  events.add(match, { type: 'penalty', side: 'us', minute: '45', minute_extra: '2', player_id: String(roux) });
  events.add(match, { type: 'goal', side: 'them', minute: '50', player_name: 'Dupuis' });
  events.add(match, { type: 'own_goal', side: 'us', minute: '80', player_name: 'Martin' }); // CSC adverse en notre faveur
  events.add(match, { type: 'yellow', side: 'us', minute: '33', player_id: String(petit) });
  events.add(match, { type: 'sub', side: 'us', minute: '60', player_id: String(simon), player2_id: String(petit) });
  events.add(match, { type: 'red', side: 'them', minute: '88' });
  assert.throws(() => events.add(match, { type: 'goal', side: 'us', minute: '1' }), /joueur/);

  const list = events.list(match);
  assert.deepEqual(list.map(e => e.time), ["12'", "33'", "45+2'", "50'", "60'", "80'", "88'"]);
  assert.equal(list[0].who, 'H. Roux');
  assert.equal(list[0].assist, 'A. Simon');
  assert.equal(list.find(e => e.type === 'sub').who2, 'A. Petit');
  assert.deepEqual(events.goalCount(match), { us: 3, them: 1 });

  const sc = events.scorers(list);
  assert.deepEqual(sc.us.map(s => [s.name, s.times.join(', ')]), [['H. Roux', "12', 45+2' (pen.)"], ['Martin (csc)', "80'"]]);
  assert.deepEqual(sc.them.map(s => s.name), ['Dupuis']);
});

test('le nom reste affiché si le joueur est supprimé', () => {
  const tmp = pid('Jean', 'Temp', 20);
  events.add(match, { type: 'yellow', side: 'us', minute: '70', player_id: String(tmp) });
  db.prepare('DELETE FROM players WHERE id = ?').run(tmp);
  const e = events.list(match).find(x => x.minute === 70);
  assert.equal(e.who, 'Jean Temp');
  events.remove(match, e.id);
});

test('recalcul des statistiques des joueurs', () => {
  events.recomputePlayerStats();
  const get = id => db.prepare('SELECT matches, goals, assists, yellow_cards, red_cards FROM players WHERE id = ?').get(id);
  assert.deepEqual({ ...get(roux) }, { matches: 1, goals: 2, assists: 0, yellow_cards: 0, red_cards: 0 });
  assert.deepEqual({ ...get(simon) }, { matches: 1, goals: 0, assists: 1, yellow_cards: 0, red_cards: 0 });
  assert.deepEqual({ ...get(petit) }, { matches: 1, goals: 0, assists: 0, yellow_cards: 1, red_cards: 0 });
});
