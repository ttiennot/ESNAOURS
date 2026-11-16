'use strict';
const { db } = require('./db');
const { todayParis } = require('./helpers');

const MATCH_ORDER = "ORDER BY (date IS NULL), date, time";

const q = {
  allMatches: () => db.prepare(`SELECT * FROM matches ${MATCH_ORDER}`).all(),
  match: id => db.prepare('SELECT * FROM matches WHERE id = ?').get(id),
  nextMatch: () => db.prepare(`SELECT * FROM matches WHERE home_score IS NULL AND (date >= ? OR date IS NULL) ${MATCH_ORDER} LIMIT 1`).get(todayParis()),
  upcoming: (n = 5) => db.prepare(`SELECT * FROM matches WHERE home_score IS NULL AND date >= ? ${MATCH_ORDER} LIMIT ?`).all(todayParis(), n),
  lastResults: (n = 5) => db.prepare('SELECT * FROM matches WHERE home_score IS NOT NULL ORDER BY date DESC, time DESC LIMIT ?').all(n),
  standings: () => db.prepare('SELECT * FROM standings ORDER BY rank, points DESC').all(),

  players: (activeOnly = true) => db.prepare(`SELECT * FROM players ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY CASE position WHEN 'GB' THEN 1 WHEN 'DEF' THEN 2 WHEN 'MIL' THEN 3 WHEN 'ATT' THEN 4 ELSE 5 END, sort_order, number IS NULL, number, last_name`).all(),
  player: id => db.prepare('SELECT * FROM players WHERE id = ?').get(id),

  lineup: matchId => {
    const l = db.prepare('SELECT * FROM lineups WHERE match_id = ?').get(matchId);
    if (!l) return null;
    return { ...l, slots: JSON.parse(l.slots || '[]'), subs: JSON.parse(l.subs || '[]') };
  },
  publishedLineups: () => db.prepare(`SELECT l.*, m.date, m.time, m.home_team, m.away_team, m.is_home, m.home_score, m.away_score, m.round, m.competition
     FROM lineups l JOIN matches m ON m.id = l.match_id WHERE l.published = 1 ORDER BY m.date DESC, m.time DESC`).all(),

  posts: (n = 50, includeDrafts = false) => db.prepare(`SELECT * FROM posts ${includeDrafts ? '' : 'WHERE published = 1'} ORDER BY pinned DESC, created_at DESC LIMIT ?`).all(n),
  post: id => db.prepare('SELECT * FROM posts WHERE id = ?').get(id),
  clubSections: () => db.prepare('SELECT * FROM club_sections ORDER BY sort_order, id').all(),

  albums: (includeDrafts = false) => db.prepare(`SELECT a.*, m.home_team, m.away_team, m.home_score, m.away_score, m.is_home,
      (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) AS photo_count,
      COALESCE((SELECT thumb FROM photos p WHERE p.id = a.cover_id), (SELECT thumb FROM photos p WHERE p.album_id = a.id ORDER BY sort_order, id LIMIT 1)) AS cover
    FROM albums a LEFT JOIN matches m ON m.id = a.match_id ${includeDrafts ? '' : 'WHERE a.published = 1'}
    ORDER BY COALESCE(a.date, m.date, a.created_at) DESC, a.id DESC`).all(),
  album: id => db.prepare(`SELECT a.*, m.home_team, m.away_team, m.home_score, m.away_score, m.is_home, m.date AS match_date
    FROM albums a LEFT JOIN matches m ON m.id = a.match_id WHERE a.id = ?`).get(id),
  albumsForMatch: matchId => db.prepare('SELECT id, title FROM albums WHERE match_id = ? AND published = 1').all(matchId),
  photos: albumId => db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY sort_order, id').all(albumId)
};

/** Remplace les ids d'une compo par les objets joueurs. */
function hydrateLineup(lineup) {
  if (!lineup) return null;
  const ids = [...lineup.slots, ...lineup.subs].filter(Boolean);
  const map = new Map();
  if (ids.length) {
    const rows = db.prepare(`SELECT * FROM players WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    for (const r of rows) map.set(r.id, r);
  }
  return {
    ...lineup,
    slotPlayers: lineup.slots.map(id => map.get(Number(id)) || null),
    subPlayers: lineup.subs.map(id => map.get(Number(id))).filter(Boolean)
  };
}

module.exports = { q, hydrateLineup };
