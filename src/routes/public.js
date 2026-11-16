'use strict';
const express = require('express');
const { q, hydrateLineup } = require('../queries');
const { POSITIONS } = require('../helpers');

const router = express.Router();
const id = v => Number.parseInt(v, 10) || 0;

router.get('/', (req, res) => {
  const next = q.nextMatch();
  const nextLineup = next ? q.lineup(next.id) : null;
  const standings = q.standings();
  const usIdx = standings.findIndex(s => s.is_us);
  // extrait du classement centré sur l'ES Naours
  let excerpt = standings.slice(0, 5);
  if (usIdx >= 4) excerpt = standings.slice(Math.max(0, usIdx - 2), usIdx + 3);
  res.render('home', {
    title: null,
    next,
    nextLineup: nextLineup && nextLineup.published ? hydrateLineup(nextLineup) : null,
    results: q.lastResults(5),
    upcoming: q.upcoming(4).filter(m => !next || m.id !== next.id).slice(0, 3),
    standings, excerpt, us: usIdx >= 0 ? standings[usIdx] : null,
    posts: q.posts(3),
    albums: q.albums().slice(0, 4)
  });
});

router.get('/calendrier', (req, res) => {
  const matches = q.allMatches();
  const lineupIds = new Set(q.publishedLineups().map(l => l.match_id));
  res.render('calendrier', { title: 'Calendrier & résultats', matches, lineupIds });
});

router.get('/classement', (req, res) => {
  res.render('classement', { title: 'Classement', standings: q.standings(), form: recentForm() });
});

function recentForm() {
  const { outcome } = require('../helpers');
  return q.lastResults(5).map(outcome).filter(Boolean).reverse();
}

router.get('/effectif', (req, res) => {
  const players = q.players();
  const groups = Object.keys(POSITIONS).map(k => ({ key: k, ...POSITIONS[k], players: players.filter(p => p.position === k) })).filter(g => g.players.length);
  res.render('effectif', { title: 'Effectif', groups, players });
});

router.get('/effectif/:id', (req, res, next) => {
  const p = q.player(id(req.params.id));
  if (!p || !p.active) return next();
  res.render('joueur', { title: `${p.first_name} ${p.last_name}`, p });
});

router.get('/match/:id', (req, res, next) => {
  const m = q.match(id(req.params.id));
  if (!m) return next();
  const l = q.lineup(m.id);
  res.render('match', {
    title: `${m.home_team} – ${m.away_team}`,
    m,
    lineup: l && (l.published || res.locals.isAdmin) ? hydrateLineup(l) : null,
    albums: q.albumsForMatch(m.id)
  });
});

router.get('/compo', (req, res) => {
  const next = q.nextMatch();
  const l = next ? q.lineup(next.id) : null;
  if (l && l.published) return res.redirect(`/match/${next.id}#compo`);
  res.render('compos', { title: 'Compositions', next, lineups: q.publishedLineups() });
});

router.get('/club', (req, res) => {
  res.render('club', { title: 'Le club', sections: q.clubSections(), posts: q.posts(30) });
});

router.get('/actus/:id', (req, res, next) => {
  const p = q.post(id(req.params.id));
  if (!p || (!p.published && !res.locals.isAdmin)) return next();
  res.render('actu', { title: p.title, post: p, others: q.posts(4).filter(o => o.id !== p.id).slice(0, 3) });
});

router.get('/photos', (req, res) => {
  res.render('photos', { title: 'Photothèque', albums: q.albums() });
});

router.get('/photos/:id', (req, res, next) => {
  const a = q.album(id(req.params.id));
  if (!a || (!a.published && !res.locals.isAdmin)) return next();
  res.render('album', { title: a.title, album: a, photos: q.photos(a.id) });
});

module.exports = router;
