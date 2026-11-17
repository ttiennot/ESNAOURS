'use strict';
const express = require('express');
const { db, getSettings, setSetting, tx } = require('../db');
const { q } = require('../queries');
const auth = require('../auth');
const { upload, saveImage, removeUpload } = require('../upload');
const { syncAll, configFromSettings } = require('../sync');
const fff = require('../fff');
const { FORMATIONS } = require('../formations');
const { importFffText, importLinks } = require('../importer');

const router = express.Router();
const csrf = auth.verifyCsrf;
const int = v => (v === undefined || v === null || String(v).trim() === '' || Number.isNaN(Number(v)) ? null : Number.parseInt(v, 10));
const str = v => (v === undefined || v === null ? null : String(v).trim() || null);
const bool = v => (v === 'on' || v === '1' || v === 'true' || v === 1 || v === true ? 1 : 0);
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };

router.use((req, res, next) => {
  res.locals.csrf = auth.csrfToken(req);
  res.set('Cache-Control', 'no-store');
  next();
});

/* ---------- Connexion ---------- */
router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Connexion', error: null, next: req.query.next || '/admin' });
});

router.post('/login', csrf, (req, res) => {
  const ip = req.ip;
  const nextUrl = typeof req.body.next === 'string' && req.body.next.startsWith('/admin') ? req.body.next : '/admin';
  if (auth.tooManyAttempts(ip)) {
    return res.status(429).render('admin/login', { title: 'Connexion', error: 'Trop de tentatives. Réessaie dans 15 minutes.', next: nextUrl });
  }
  if (!auth.checkPassword(req.body.password)) {
    auth.recordFailure(ip);
    return res.status(401).render('admin/login', { title: 'Connexion', error: 'Mot de passe incorrect.', next: nextUrl });
  }
  auth.clearFailures(ip);
  req.session.admin = true;
  res.redirect(nextUrl);
});

router.post('/logout', csrf, (req, res) => { req.session = null; res.redirect('/'); });

router.use(auth.requireAdmin);

/* ---------- Tableau de bord ---------- */
router.get('/', (req, res) => {
  const next = q.nextMatch();
  res.render('admin/dashboard', {
    title: 'Tableau de bord',
    next,
    nextLineup: next ? q.lineup(next.id) : null,
    counts: {
      players: db.prepare('SELECT COUNT(*) n FROM players WHERE active = 1').get().n,
      matches: db.prepare('SELECT COUNT(*) n FROM matches').get().n,
      teams: db.prepare('SELECT COUNT(*) n FROM standings').get().n,
      posts: db.prepare('SELECT COUNT(*) n FROM posts').get().n,
      albums: db.prepare('SELECT COUNT(*) n FROM albums').get().n,
      photos: db.prepare('SELECT COUNT(*) n FROM photos').get().n
    }
  });
});

/* ---------- Synchronisation FFF ---------- */
router.post('/sync', csrf, async (req, res) => {
  const r = await syncAll();
  flash(req, r.ok ? 'ok' : 'error', r.ok ? `Synchronisation réussie : ${r.matches} matchs et ${r.standings} équipes au classement (${r.source === 'officiel' ? 'classement officiel' : 'classement recalculé depuis les résultats'}).` : `Échec de la synchronisation : ${r.error}`);
  res.redirect(req.get('referer') && req.get('referer').includes('/admin') ? req.get('referer') : '/admin');
});

/* ---------- Import FFF par copier-coller ---------- */
router.get('/import', (req, res) => {
  res.render('admin/import', { title: 'Import FFF', links: importLinks(), result: null, error: null });
});
router.post('/import', csrf, (req, res) => {
  let result = null, error = null;
  try { result = importFffText(req.body.data); }
  catch (e) { error = e.message; }
  res.render('admin/import', { title: 'Import FFF', links: importLinks(), result, error });
});

router.post('/fff/equipes', csrf, async (req, res) => {
  const cfg = configFromSettings();
  cfg.clubId = str(req.body.club_id) || cfg.clubId;
  if (!cfg.clubId) return res.status(400).json({ error: 'Indique le numéro de club FFF.' });
  try { res.json({ teams: await fff.fetchClubTeams(cfg) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---------- Joueurs ---------- */
router.get('/joueurs', (req, res) => res.render('admin/joueurs', { title: 'Effectif', players: q.players(false) }));
router.get('/joueurs/new', (req, res) => res.render('admin/joueur-form', { title: 'Nouveau joueur', p: { position: 'MIL', active: 1 } }));
router.get('/joueurs/:id', (req, res, next) => {
  const p = q.player(int(req.params.id));
  if (!p) return next();
  res.render('admin/joueur-form', { title: `${p.first_name} ${p.last_name}`, p });
});

router.post('/joueurs/save', upload.single('photo'), csrf, async (req, res) => {
  const b = req.body;
  const pid = int(b.id);
  const existing = pid ? q.player(pid) : null;
  let photo = existing ? existing.photo : null;
  if (req.file) {
    const saved = await saveImage(req.file.buffer, 'players', { square: true });
    if (photo) removeUpload(photo);
    photo = saved.file;
  } else if (b.remove_photo && photo) { removeUpload(photo); photo = null; }
  const pos = ['GB', 'DEF', 'MIL', 'ATT', 'STAFF'].includes(b.position) ? b.position : 'MIL';
  const vals = [str(b.first_name) || '?', str(b.last_name) || '?', str(b.nickname), int(b.number), pos, str(b.role), str(b.birth_date), int(b.height), str(b.foot), str(b.joined), str(b.previous_club), str(b.bio), photo,
    int(b.matches) || 0, int(b.goals) || 0, int(b.assists) || 0, int(b.yellow_cards) || 0, int(b.red_cards) || 0, bool(b.is_captain), bool(b.active), int(b.sort_order) || 0];
  const cols = 'first_name, last_name, nickname, number, position, role, birth_date, height, foot, joined, previous_club, bio, photo, matches, goals, assists, yellow_cards, red_cards, is_captain, active, sort_order';
  if (existing) db.prepare(`UPDATE players SET ${cols.split(', ').map(c => c + '=?').join(', ')} WHERE id = ?`).run(...vals, existing.id);
  else db.prepare(`INSERT INTO players (${cols}) VALUES (${vals.map(() => '?').join(',')})`).run(...vals);
  flash(req, 'ok', 'Joueur enregistré.');
  res.redirect(b.again ? '/admin/joueurs/new' : '/admin/joueurs');
});

router.post('/joueurs/:id/delete', csrf, (req, res) => {
  const p = q.player(int(req.params.id));
  if (p) { removeUpload(p.photo); db.prepare('DELETE FROM players WHERE id = ?').run(p.id); }
  flash(req, 'ok', 'Joueur supprimé.');
  res.redirect('/admin/joueurs');
});

/* ---------- Matchs ---------- */
router.get('/matchs', (req, res) => {
  const lineups = new Map(db.prepare('SELECT match_id, published FROM lineups').all().map(l => [l.match_id, l.published]));
  res.render('admin/matchs', { title: 'Matchs', matches: q.allMatches(), lineups });
});
router.get('/matchs/new', (req, res) => {
  const s = getSettings();
  res.render('admin/match-form', { title: 'Nouveau match', m: { home_team: s.club_name, is_home: 1, competition: s.competition_label, source: 'manual' } });
});
router.get('/matchs/:id', (req, res, next) => {
  const m = q.match(int(req.params.id));
  if (!m) return next();
  res.render('admin/match-form', { title: 'Modifier le match', m });
});
router.post('/matchs/save', csrf, (req, res) => {
  const b = req.body;
  const mid = int(b.id);
  const vals = [str(b.competition), str(b.round), str(b.date), str(b.time), str(b.home_team) || '?', str(b.away_team) || '?', int(b.home_score), int(b.away_score), bool(b.is_home), str(b.venue), str(b.status), bool(b.locked)];
  const cols = ['competition', 'round', 'date', 'time', 'home_team', 'away_team', 'home_score', 'away_score', 'is_home', 'venue', 'status', 'locked'];
  if (mid) db.prepare(`UPDATE matches SET ${cols.map(c => c + '=?').join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...vals, mid);
  else db.prepare(`INSERT INTO matches (${cols.join(', ')}, source) VALUES (${cols.map(() => '?').join(',')}, 'manual')`).run(...vals);
  flash(req, 'ok', 'Match enregistré.');
  res.redirect('/admin/matchs');
});
router.post('/matchs/:id/delete', csrf, (req, res) => {
  db.prepare('DELETE FROM matches WHERE id = ?').run(int(req.params.id));
  flash(req, 'ok', 'Match supprimé (il réapparaîtra à la prochaine synchro s\'il vient de la FFF).');
  res.redirect('/admin/matchs');
});

/* ---------- Composition ---------- */
router.get('/compo/:matchId', (req, res, next) => {
  const m = q.match(int(req.params.matchId));
  if (!m) return next();
  const l = q.lineup(m.id) || { formation: '4-4-2', slots: [], subs: [], captain_id: null, meeting: '', notes: '', published: 0 };
  res.render('admin/compo-form', { title: 'Composition', m, l, players: q.players(true).filter(p => p.position !== 'STAFF') });
});
router.post('/compo/:matchId', csrf, (req, res, next) => {
  const m = q.match(int(req.params.matchId));
  if (!m) return next();
  const b = req.body;
  const formation = FORMATIONS[b.formation] ? b.formation : '4-4-2';
  const n = FORMATIONS[formation].length;
  const arr = v => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
  const slots = Array.from({ length: n }, (_, i) => int(arr(b.slots)[i]));
  const subs = [...new Set(arr(b.subs).map(int).filter(Boolean))].filter(x => !slots.includes(x));
  db.prepare(`INSERT INTO lineups (match_id, formation, slots, subs, captain_id, meeting, notes, published, updated_at)
    VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(match_id) DO UPDATE SET formation=excluded.formation, slots=excluded.slots, subs=excluded.subs, captain_id=excluded.captain_id,
      meeting=excluded.meeting, notes=excluded.notes, published=excluded.published, updated_at=CURRENT_TIMESTAMP`)
    .run(m.id, formation, JSON.stringify(slots), JSON.stringify(subs), int(b.captain_id), str(b.meeting), str(b.notes), bool(b.published));
  flash(req, 'ok', bool(b.published) ? 'Composition publiée.' : 'Composition enregistrée (brouillon, non visible du public).');
  res.redirect(`/admin/compo/${m.id}`);
});
router.post('/compo/:matchId/delete', csrf, (req, res) => {
  db.prepare('DELETE FROM lineups WHERE match_id = ?').run(int(req.params.matchId));
  flash(req, 'ok', 'Composition supprimée.');
  res.redirect('/admin/matchs');
});

/* ---------- Classement (saisie manuelle de secours) ---------- */
router.get('/classement', (req, res) => res.render('admin/classement', { title: 'Classement', standings: q.standings() }));
router.post('/classement', csrf, (req, res) => {
  const b = req.body;
  const arr = v => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
  const teams = arr(b.team);
  tx(() => {
    db.exec('DELETE FROM standings');
    const ins = db.prepare(`INSERT INTO standings (rank, team, logo, points, played, won, drawn, lost, forfeits, goals_for, goals_against, goal_diff, penalties, is_us) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const usIdx = int(b.is_us);
    teams.forEach((t, i) => {
      if (!str(t)) return;
      const g = k => int(arr(b[k])[i]) || 0;
      ins.run(int(arr(b.rank)[i]) || i + 1, str(t), str(arr(b.logo)[i]), g('points'), g('played'), g('won'), g('drawn'), g('lost'), g('forfeits'), g('goals_for'), g('goals_against'), g('goals_for') - g('goals_against'), g('penalties'), usIdx === i ? 1 : 0);
    });
  });
  flash(req, 'ok', 'Classement enregistré. Attention : la prochaine synchronisation FFF le remplacera.');
  res.redirect('/admin/classement');
});

/* ---------- Actualités ---------- */
router.get('/actus', (req, res) => res.render('admin/actus', { title: 'Actualités', posts: q.posts(500, true) }));
router.get('/actus/new', (req, res) => res.render('admin/actu-form', { title: 'Nouvelle actualité', p: { published: 1 } }));
router.get('/actus/:id', (req, res, next) => {
  const p = q.post(int(req.params.id));
  if (!p) return next();
  res.render('admin/actu-form', { title: 'Modifier l\'actualité', p });
});
router.post('/actus/save', upload.single('image'), csrf, async (req, res) => {
  const b = req.body;
  const existing = int(b.id) ? q.post(int(b.id)) : null;
  let image = existing ? existing.image : null;
  if (req.file) { const s = await saveImage(req.file.buffer, 'posts', { max: 1600 }); removeUpload(image); image = s.file; }
  else if (b.remove_image && image) { removeUpload(image); image = null; }
  if (existing) db.prepare('UPDATE posts SET title=?, body=?, image=?, pinned=?, published=? WHERE id=?').run(str(b.title) || 'Sans titre', str(b.body), image, bool(b.pinned), bool(b.published), existing.id);
  else db.prepare('INSERT INTO posts (title, body, image, pinned, published) VALUES (?,?,?,?,?)').run(str(b.title) || 'Sans titre', str(b.body), image, bool(b.pinned), bool(b.published));
  flash(req, 'ok', 'Actualité enregistrée.');
  res.redirect('/admin/actus');
});
router.post('/actus/:id/delete', csrf, (req, res) => {
  const p = q.post(int(req.params.id));
  if (p) { removeUpload(p.image); db.prepare('DELETE FROM posts WHERE id = ?').run(p.id); }
  flash(req, 'ok', 'Actualité supprimée.');
  res.redirect('/admin/actus');
});

/* ---------- Infos club ---------- */
router.get('/club', (req, res) => res.render('admin/club', { title: 'Infos club', sections: q.clubSections() }));
router.post('/club', csrf, (req, res) => {
  const b = req.body;
  const arr = v => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
  const ids = arr(b.id);
  tx(() => {
    ids.forEach((sid, i) => {
      const title = str(arr(b.title)[i]);
      const body = str(arr(b.body)[i]);
      const order = int(arr(b.sort_order)[i]) || 0;
      if (sid === 'new') { if (title) db.prepare('INSERT INTO club_sections (title, body, sort_order) VALUES (?,?,?)').run(title, body, order); }
      else db.prepare('UPDATE club_sections SET title=?, body=?, sort_order=? WHERE id=?').run(title || 'Sans titre', body, order, int(sid));
    });
  });
  flash(req, 'ok', 'Infos du club enregistrées.');
  res.redirect('/admin/club');
});
router.post('/club/:id/delete', csrf, (req, res) => {
  db.prepare('DELETE FROM club_sections WHERE id = ?').run(int(req.params.id));
  flash(req, 'ok', 'Rubrique supprimée.');
  res.redirect('/admin/club');
});

/* ---------- Photothèque ---------- */
router.get('/photos', (req, res) => res.render('admin/albums', { title: 'Photothèque', albums: q.albums(true) }));
router.get('/photos/new', (req, res) => res.render('admin/album-form', { title: 'Nouvel album', a: { published: 1, match_id: int(req.query.match) }, photos: [], matches: q.allMatches() }));
router.get('/photos/:id', (req, res, next) => {
  const a = q.album(int(req.params.id));
  if (!a) return next();
  res.render('admin/album-form', { title: a.title, a, photos: q.photos(a.id), matches: q.allMatches() });
});
router.post('/photos/save', csrf, (req, res) => {
  const b = req.body;
  const aid = int(b.id);
  let matchId = int(b.match_id);
  let title = str(b.title);
  if (!title && matchId) { const m = q.match(matchId); if (m) title = `${m.home_team} – ${m.away_team}`; }
  const vals = [title || 'Album photo', matchId, str(b.date), str(b.description), bool(b.published)];
  let newId = aid;
  if (aid) db.prepare('UPDATE albums SET title=?, match_id=?, date=?, description=?, published=? WHERE id=?').run(...vals, aid);
  else newId = Number(db.prepare('INSERT INTO albums (title, match_id, date, description, published) VALUES (?,?,?,?,?)').run(...vals).lastInsertRowid);
  flash(req, 'ok', aid ? 'Album enregistré.' : 'Album créé : ajoute maintenant les photos.');
  res.redirect(`/admin/photos/${newId}`);
});
router.post('/photos/:id/upload', upload.array('photos', 60), csrf, async (req, res, next) => {
  const a = q.album(int(req.params.id));
  if (!a) return next();
  let ok = 0, ko = 0;
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM photos WHERE album_id = ?').get(a.id).m;
  const ins = db.prepare('INSERT INTO photos (album_id, file, thumb, sort_order) VALUES (?,?,?,?)');
  for (const f of req.files || []) {
    try { const s = await saveImage(f.buffer, `albums/${a.id}`, { max: 2000, thumb: 480 }); ins.run(a.id, s.file, s.thumb, max + ok + 1); ok++; }
    catch (e) { console.warn('[upload]', f.originalname, e.message); ko++; }
  }
  if (req.get('accept') && req.get('accept').includes('application/json')) return res.json({ ok, ko });
  flash(req, ko ? 'error' : 'ok', `${ok} photo(s) ajoutée(s)${ko ? `, ${ko} refusée(s) (format non supporté)` : ''}.`);
  res.redirect(`/admin/photos/${a.id}`);
});
router.post('/photos/:id/meta', csrf, (req, res) => {
  const aid = int(req.params.id);
  const b = req.body;
  const arr = v => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
  tx(() => {
    arr(b.photo_id).forEach((pid, i) => db.prepare('UPDATE photos SET caption = ? WHERE id = ? AND album_id = ?').run(str(arr(b.caption)[i]), int(pid), aid));
    if (int(b.cover_id)) db.prepare('UPDATE albums SET cover_id = ? WHERE id = ?').run(int(b.cover_id), aid);
  });
  flash(req, 'ok', 'Légendes enregistrées.');
  res.redirect(`/admin/photos/${aid}`);
});
router.post('/photos/:id/photo/:pid/delete', csrf, (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id = ? AND album_id = ?').get(int(req.params.pid), int(req.params.id));
  if (p) { removeUpload(p.file); if (p.thumb !== p.file) removeUpload(p.thumb); db.prepare('DELETE FROM photos WHERE id = ?').run(p.id); }
  flash(req, 'ok', 'Photo supprimée.');
  res.redirect(`/admin/photos/${int(req.params.id)}`);
});
router.post('/photos/:id/delete', csrf, (req, res) => {
  const aid = int(req.params.id);
  for (const p of q.photos(aid)) { removeUpload(p.file); if (p.thumb !== p.file) removeUpload(p.thumb); }
  db.prepare('DELETE FROM albums WHERE id = ?').run(aid);
  flash(req, 'ok', 'Album supprimé.');
  res.redirect('/admin/photos');
});

/* ---------- Réglages ---------- */
const SETTING_KEYS = ['club_name', 'team_label', 'competition_label', 'hero_tagline', 'stadium', 'address', 'email', 'phone', 'facebook', 'instagram',
  'fff_api_base', 'fff_club_id', 'fff_cp_no', 'fff_phase', 'fff_poule', 'fff_team_pattern'];

router.get('/reglages', (req, res) => res.render('admin/reglages', { title: 'Réglages' }));
router.post('/reglages', upload.single('logo'), csrf, async (req, res) => {
  for (const k of SETTING_KEYS) if (k in req.body) setSetting(k, String(req.body[k] || '').trim());
  setSetting('fff_auto_sync', bool(req.body.fff_auto_sync) ? '1' : '0');
  if (req.file) {
    const s = await saveImage(req.file.buffer, 'club', { max: 512 });
    removeUpload(getSettings().logo);
    setSetting('logo', s.file);
  } else if (req.body.remove_logo) { removeUpload(getSettings().logo); setSetting('logo', ''); }
  flash(req, 'ok', 'Réglages enregistrés.');
  res.redirect('/admin/reglages');
});
router.post('/password', csrf, (req, res) => {
  const { current, password, confirm } = req.body;
  if (!auth.checkPassword(current)) flash(req, 'error', 'Mot de passe actuel incorrect.');
  else if (!password || password.length < 8) flash(req, 'error', 'Le nouveau mot de passe doit faire au moins 8 caractères.');
  else if (password !== confirm) flash(req, 'error', 'Les deux mots de passe ne correspondent pas.');
  else { auth.setPassword(password); flash(req, 'ok', 'Mot de passe modifié.'); }
  res.redirect('/admin/reglages');
});

module.exports = router;
