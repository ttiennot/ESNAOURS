'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'esn-import-'));
const { db, setSetting } = require('../src/db');
const { importFffText, importLinks } = require('../src/importer');

// Structure identique à la réponse réelle de /resultat (valeurs fictives).
const team = (cl_no, aff, name, number = 1) => ({
  club: { cl_no, logo: `https://cdn-transverse.azureedge.net/phlogos/BC${aff}.jpg` },
  category_code: 'SEM', number, short_name: name, type: 'C'
});
const match = (ma_no, j, home, away, hs, as, extra = {}) => ({
  ma_no,
  competition: { cp_no: 455189, season: 2026, type: 'CH', name: 'Seniors D5' },
  phase: { number: 1 }, poule: { stage_number: 3, name: 'POULE C' },
  poule_journee: { number: j, name: String(j) },
  home, away,
  terrain: { name: 'STADE MUNICIPAL', zip_code: '80260', city: 'NAOURS' },
  status: 'A', date: '2026-11-08T00:00:00+00:00', time: '14H30',
  home_score: hs, away_score: as, home_is_forfeit: 'N', away_is_forfeit: 'N', status_label: '/',
  ...extra
});
const NAOURS = team(201032, 561114, 'NAOURS ES');
const A = team(5001, 900001, 'EQUIPE A AS');
const B = team(5002, 900002, 'EQUIPE B FC', 2);
const C = team(5003, 900003, 'EQUIPE C US');

const page = (items, next) => JSON.stringify({ '@type': 'hydra:Collection', 'hydra:member': items, 'hydra:totalItems': items.length, ...(next ? { 'hydra:view': { 'hydra:next': next } } : {}) })
  .replace(/\//g, '\\/'); // la FFF échappe les « / » comme dans la vraie réponse

setSetting('fff_cp_no', '455189');
setSetting('fff_phase', '1');
setSetting('fff_poule', '3');
setSetting('fff_club_id', '561114'); // n° d'affiliation (≠ cl_no de l'API)

test('liens générés depuis les réglages', () => {
  const l = importLinks();
  assert.equal(l.matches, null, 'calendrier disponible après le premier import');
  assert.match(l.results, /\/resultat\?ma_dat%5Bafter%5D=\d{4}-07-01&ma_dat%5Bbefore%5D=\d{4}-06-30$/);
});

test('import des résultats de la poule : nos matchs + classement recalculé', () => {
  const r = importFffText(page([
    match(1, 6, NAOURS, A, 0, 2),
    match(2, 6, B, C, 1, 1),
    match(3, 5, C, NAOURS, 1, 3),
    match(4, 5, A, B, 3, 0, { away_is_forfeit: 'O' })
  ], '/api/compets/455189/phases/1/poules/3/resultat?page=2'));
  assert.equal(r.matches, 4);
  assert.equal(r.ours, 2, 'reconnu via le n° d\'affiliation présent dans le logo');
  assert.equal(r.source, 'calculé');
  assert.equal(r.hasNext, true);

  const m = db.prepare("SELECT * FROM matches WHERE fff_id = '1'").get();
  assert.equal(m.home_team, 'NAOURS ES');
  assert.equal(m.is_home, 1);
  assert.equal(m.date, '2026-11-08');
  assert.equal(m.time, '14:30');
  assert.equal(m.round, 'J6');
  assert.equal(m.status, null, 'status_label « / » n\'est pas un report');

  const st = Object.fromEntries(db.prepare('SELECT * FROM standings').all().map(s => [s.team, s]));
  assert.equal(st['EQUIPE A AS'].points, 6);
  assert.equal(st['NAOURS ES'].points, 3);
  assert.equal(st['NAOURS ES'].is_us, 1);
  assert.equal(st['EQUIPE B FC'].points, 0, 'nul (+1) puis forfait (-1)');
});

test('le numéro interne de l\'API (cl_no) est mémorisé pour les liens', () => {
  assert.match(importLinks().matches, /\/api\/compets\/455189\/phases\/1\/poules\/3\/matchs\?clNo=201032$/);
});

test('import du calendrier du club seul : ne casse pas le classement', () => {
  importFffText(page([match(10, 7, A, NAOURS, null, null, { date: '2026-11-15T00:00:00+00:00' })]));
  const m = db.prepare("SELECT * FROM matches WHERE fff_id = '10'").get();
  assert.equal(m.home_score, null);
  assert.equal(m.is_home, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standings').get().n, 4);
});

test('import du classement officiel', () => {
  const r = importFffText(page([
    { rank: 1, point_count: 13, total_games_count: 6, goals_diff: 9, equipe: NAOURS },
    { rank: 2, point_count: 10, total_games_count: 6, equipe: A }
  ]));
  assert.equal(r.source, 'officiel');
  assert.equal(db.prepare("SELECT points FROM standings WHERE is_us = 1").get().points, 13);
});

test('erreurs explicites', () => {
  assert.throws(() => importFffText(''), /Rien à importer/);
  assert.throws(() => importFffText('<!doctype html><html>'), /page web/);
  assert.throws(() => importFffText('{"hydra:member": [{"ma_no"'), /pas complet/);
  assert.throws(() => importFffText('{"hydra:member": []}'), /vide/);
});
