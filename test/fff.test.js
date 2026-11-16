'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'esn-test-'));
const fff = require('../src/fff');

const cfg = { clubId: '500999', pattern: 'NAOURS', competitionLabel: 'D5' };

const MATCH = {
  ma_no: 2712345,
  competition: { cp_no: 432100, name: 'D5' },
  poule_journee: { number: 3 },
  date: '2026-09-27T00:00:00+00:00',
  time: '15H00',
  home: { short_name: 'NAOURS ES', club: { cl_no: 500999, logo: 'https://example.org/naours.png' } },
  away: { short_name: 'TALMAS AS', club: { cl_no: 500111, logo: 'https://example.org/talmas.png' } },
  home_score: 2, away_score: 1,
  terrain: { name: 'STADE MUNICIPAL', city: 'NAOURS' }
};

test('normalise un match FFF', () => {
  const m = fff.normalizeMatch(MATCH, cfg);
  assert.equal(m.fff_id, '2712345');
  assert.equal(m.round, 'J3');
  assert.equal(m.date, '2026-09-27');
  assert.equal(m.time, '15:00');
  assert.equal(m.is_home, 1);
  assert.equal(m.involves_us, true);
  assert.equal(m.venue, 'STADE MUNICIPAL – NAOURS');
  assert.equal(m.home_score, 2);
});

test('date ISO à minuit heure de Paris (22h UTC la veille)', () => {
  assert.equal(fff.parisDate('2026-09-26T22:00:00+00:00'), '2026-09-27');
});

test('match non joué : scores nuls', () => {
  const m = fff.normalizeMatch({ ...MATCH, home_score: null, away_score: null, home: MATCH.away, away: MATCH.home }, cfg);
  assert.equal(m.home_score, null);
  assert.equal(m.is_home, 0);
  assert.equal(m.involves_us, true);
});

test('classement : dédoublonnage et repérage de notre équipe', () => {
  const rows = [
    { rank: 2, point_count: 7, total_games_count: 3, equipe: { short_name: 'NAOURS ES', club: { cl_no: 500999 } } },
    { rank: 3, point_count: 4, total_games_count: 2, equipe: { short_name: 'NAOURS ES', club: { cl_no: 500999 } } },
    { rank: 1, point_count: 9, total_games_count: 3, goals_diff: 5, equipe: { short_name: 'TALMAS AS' } }
  ].map(r => fff.normalizeStanding(r, cfg));
  const out = fff.dedupeStandings(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].team, 'TALMAS AS');
  assert.equal(out[1].points, 7);
  assert.equal(out[1].is_us, 1);
});

test('synchronisation complète contre une API simulée (JSON-LD paginé)', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/ld+json');
    if (req.url.includes('/classement_journees')) {
      return res.end(JSON.stringify({ 'hydra:member': [
        { rank: 1, point_count: 3, total_games_count: 1, equipe: { short_name: 'NAOURS ES', club: { cl_no: 500999 } } },
        { rank: 2, point_count: 0, total_games_count: 1, equipe: { short_name: 'TALMAS AS' } }
      ] }));
    }
    if (req.url.includes('/matchs')) {
      const page2 = req.url.includes('page=2');
      return res.end(JSON.stringify({
        'hydra:member': page2
          ? [{ ...MATCH, ma_no: 2, home_score: null, away_score: null, date: '2026-10-04T00:00:00+00:00' }]
          : [MATCH, { ...MATCH, ma_no: 99, home: { short_name: 'AUTRE FC' }, away: { short_name: 'TALMAS AS' } }],
        'hydra:view': page2 ? {} : { 'hydra:next': req.url.split('?')[0] + '?page=2' }
      }));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => server.listen(0, r));
  const { setSetting, db } = require('../src/db');
  setSetting('fff_api_base', `http://127.0.0.1:${server.address().port}`);
  setSetting('fff_club_id', '500999');
  setSetting('fff_cp_no', '432100');
  setSetting('fff_poule', '1');
  const { syncAll } = require('../src/sync');
  const r = await syncAll();
  server.close();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.matches, 2, 'le match sans Naours doit être ignoré');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matches').get().n, 2);
  assert.equal(db.prepare('SELECT team FROM standings WHERE is_us = 1').get().team, 'NAOURS ES');

  // un match verrouillé n'est pas écrasé
  db.prepare("UPDATE matches SET home_score = 9, locked = 1 WHERE fff_id = '2712345'").run();
  const server2 = server; // réutilise le même gestionnaire
  await new Promise(r => server2.listen(0, r));
  setSetting('fff_api_base', `http://127.0.0.1:${server2.address().port}`);
  await syncAll();
  server2.close();
  assert.equal(db.prepare("SELECT home_score FROM matches WHERE fff_id = '2712345'").get().home_score, 9);
});

test("réponse HTML (accès filtré) => erreur explicite", async () => {
  const server = http.createServer((req, res) => { res.statusCode = 403; res.setHeader('Content-Type', 'text/html'); res.end('<html>blocked</html>'); });
  await new Promise(r => server.listen(0, r));
  await assert.rejects(fff.getJson(`http://127.0.0.1:${server.address().port}`, '/api/x'), /HTTP 403/);
  server.close();
});

test('classement recalculé depuis les résultats (forfait = -1 pt)', () => {
  const T = n => ({ short_name: n });
  const raw = [
    { ma_no: 1, home: T('NAOURS ES'), away: T('TALMAS AS'), home_score: 2, away_score: 0 },
    { ma_no: 2, home: T('TALMAS AS'), away: T('BERTANGLES US'), home_score: 1, away_score: 1 },
    { ma_no: 3, home: T('BERTANGLES US'), away: T('NAOURS ES'), home_score: 0, away_score: 3, home_is_forfeit: true },
    { ma_no: 4, home: T('NAOURS ES'), away: T('BERTANGLES US'), home_score: null, away_score: null }
  ];
  const t = fff.standingsFromMatches(raw, cfg);
  const by = Object.fromEntries(t.map(r => [r.team, r]));
  assert.equal(t[0].team, 'NAOURS ES');
  assert.equal(by['NAOURS ES'].points, 6);
  assert.equal(by['NAOURS ES'].played, 2);
  assert.equal(by['NAOURS ES'].is_us, 1);
  assert.equal(by['BERTANGLES US'].points, 0); // nul (+1) puis forfait (-1)
  assert.equal(by['BERTANGLES US'].forfeits, 1);
  assert.equal(by['TALMAS AS'].goal_diff, -2);
});

test('route /resultat + classement de repli + en-têtes envoyés', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, origin: req.headers.origin, referer: req.headers.referer });
    res.setHeader('Content-Type', 'application/ld+json');
    if (req.url.includes('/resultat?ma_dat')) {
      return res.end(JSON.stringify({ 'hydra:member': [
        { ...MATCH, ma_no: 501 },
        { ...MATCH, ma_no: 502, home: { short_name: 'AUTRE FC' }, away: { short_name: 'TALMAS AS' }, home_score: 0, away_score: 1 }
      ] }));
    }
    res.statusCode = 404; res.end('{}'); // classement_journees indisponible
  });
  await new Promise(r => server.listen(0, r));
  const c = { ...cfg, base: `http://127.0.0.1:${server.address().port}`, cpNo: '1', phase: '1', poule: '2' };
  const raw = await fff.fetchPouleMatches(c);
  const st = await fff.fetchStandings(c, raw);
  const matches = await fff.fetchMatches(c, raw);
  server.close();
  assert.equal(st.source, 'calculé');
  assert.equal(st.rows.find(r => r.team === 'TALMAS AS').played, 2);
  assert.deepEqual(matches.map(m => m.fff_id), ['501']);
  assert.equal(seen[0].origin, 'https://www.fff.fr');
  assert.equal(seen[0].referer, 'https://www.fff.fr/');
});
