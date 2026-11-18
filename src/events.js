'use strict';
/* Faits de match : définition des types, lecture, saisie et calcul des statistiques. */
const { db, tx } = require('./db');

const TYPES = {
  goal: { label: 'But', goal: true, assist: true },
  penalty: { label: 'But sur penalty', short: 'pen.', goal: true },
  own_goal: { label: 'But contre son camp', short: 'csc', goal: true, ownGoal: true },
  yellow: { label: 'Carton jaune' },
  second_yellow: { label: '2e jaune (expulsion)' },
  red: { label: 'Carton rouge' },
  sub: { label: 'Remplacement', sub: true },
  missed_penalty: { label: 'Penalty manqué' },
  note: { label: 'Autre fait de jeu', note: true }
};

/** Le joueur cité appartient-il à l'ES Naours ? (pour un CSC, c'est l'adversaire de l'équipe qui marque) */
function playerIsUs(type, side) {
  return (side === 'us') !== (type === 'own_goal');
}

function fullName(p) {
  return p ? [p.first_name, p.last_name].filter(Boolean).join(' ') : null;
}

/** Nom court pour l'affichage public : surnom, sinon « J. Dupont ». */
function shortName(first, last, nick, fallback) {
  if (nick) return nick;
  if (last) return (first ? first[0] + '. ' : '') + last;
  return fallback || '';
}

function list(matchId) {
  return db.prepare(`SELECT e.*,
      p.first_name AS p_first, p.last_name AS p_last, p.nickname AS p_nick,
      a.first_name AS a_first, a.last_name AS a_last, a.nickname AS a_nick,
      s.first_name AS s_first, s.last_name AS s_last, s.nickname AS s_nick
    FROM match_events e
    LEFT JOIN players p ON p.id = e.player_id
    LEFT JOIN players a ON a.id = e.assist_id
    LEFT JOIN players s ON s.id = e.player2_id
    WHERE e.match_id = ?
    ORDER BY e.minute IS NULL, e.minute, COALESCE(e.minute_extra, 0), e.id`).all(matchId)
    .map(e => ({
      ...e,
      def: TYPES[e.type] || TYPES.note,
      who: shortName(e.p_first, e.p_last, e.p_nick, e.player_name),
      assist: shortName(e.a_first, e.a_last, e.a_nick, e.assist_name),
      who2: shortName(e.s_first, e.s_last, e.s_nick, e.player2_name),
      time: e.minute == null ? '' : `${e.minute}${e.minute_extra ? '+' + e.minute_extra : ''}'`
    }));
}

/** Buteurs regroupés par équipe : « Roux 12', 67' (pen.) ». */
function scorers(events) {
  const out = { us: [], them: [] };
  for (const side of ['us', 'them']) {
    const byName = new Map();
    for (const e of events.filter(x => x.def.goal && x.side === side)) {
      const name = (e.who || 'Inconnu') + (e.type === 'own_goal' ? ' (csc)' : '');
      if (!byName.has(name)) byName.set(name, { name, playerId: playerIsUs(e.type, e.side) ? e.player_id : null, times: [] });
      byName.get(name).times.push(e.time + (e.type === 'penalty' ? ' (pen.)' : ''));
    }
    out[side] = [...byName.values()];
  }
  return out;
}

function playerRef(id, text, ourIds) {
  const pid = Number.parseInt(id, 10);
  if (pid && ourIds.has(pid)) {
    const p = db.prepare('SELECT first_name, last_name FROM players WHERE id = ?').get(pid);
    return { id: pid, name: fullName(p) };
  }
  const t = String(text || '').trim();
  return { id: null, name: t || null };
}

/** Enregistre un fait de match depuis le formulaire admin. */
function add(matchId, body) {
  const type = TYPES[body.type] ? body.type : 'note';
  const side = body.side === 'them' ? 'them' : 'us';
  const ourIds = new Set(db.prepare('SELECT id FROM players').all().map(r => r.id));
  const usPlayer = playerIsUs(type, side);
  const minute = Number.parseInt(body.minute, 10);
  const extra = Number.parseInt(body.minute_extra, 10);

  const player = usPlayer ? playerRef(body.player_id, body.player_name_free, ourIds) : playerRef(null, body.player_name, ourIds);
  let assist = { id: null, name: null };
  if (TYPES[type].assist) assist = side === 'us' ? playerRef(body.assist_id, null, ourIds) : playerRef(null, body.assist_name, ourIds);
  let p2 = { id: null, name: null };
  if (type === 'sub') p2 = side === 'us' ? playerRef(body.player2_id, null, ourIds) : playerRef(null, body.player2_name, ourIds);

  const note = String(body.note || '').trim() || null;
  // côté ES Naours, le joueur est demandé (sauf simple note) ; côté adverse, le nom est facultatif
  if (usPlayer && !player.id && !player.name && type !== 'note') throw new Error("Choisis le joueur de l'ES Naours concerné.");
  if (type === 'note' && !note && !player.name && !player.id) throw new Error('Décris le fait de jeu.');

  db.prepare(`INSERT INTO match_events (match_id, type, side, minute, minute_extra, player_id, player_name, assist_id, assist_name, player2_id, player2_name, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(matchId, type, side,
    Number.isFinite(minute) ? Math.max(0, Math.min(130, minute)) : null, Number.isFinite(extra) && extra > 0 ? Math.min(30, extra) : null,
    player.id, player.name, assist.id, assist.name, p2.id, p2.name, note);
}

function remove(matchId, eventId) {
  db.prepare('DELETE FROM match_events WHERE id = ? AND match_id = ?').run(eventId, matchId);
}

/** Nombre de buts saisis par équipe (pour comparer au score). */
function goalCount(matchId) {
  const rows = db.prepare(`SELECT side, COUNT(*) n FROM match_events WHERE match_id = ? AND type IN ('goal','penalty','own_goal') GROUP BY side`).all(matchId);
  const out = { us: 0, them: 0 };
  for (const r of rows) out[r.side] = r.n;
  return out;
}

/**
 * Recalcule les statistiques des joueurs à partir des faits de match et des compos :
 * matchs = présent dans une compo (titulaire ou remplaçant) d'un match joué.
 */
function recomputePlayerStats() {
  const players = db.prepare("SELECT id FROM players WHERE position != 'STAFF'").all();
  const stats = new Map(players.map(p => [p.id, { matches: 0, goals: 0, assists: 0, yellow: 0, red: 0 }]));
  const lineups = db.prepare(`SELECT l.slots, l.subs FROM lineups l JOIN matches m ON m.id = l.match_id WHERE m.home_score IS NOT NULL`).all();
  for (const l of lineups) {
    const ids = new Set([...JSON.parse(l.slots || '[]'), ...JSON.parse(l.subs || '[]')].filter(Boolean).map(Number));
    for (const id of ids) if (stats.has(id)) stats.get(id).matches++;
  }
  for (const e of db.prepare('SELECT * FROM match_events').all()) {
    // seuls les faits de l'ES Naours comptent (un CSC de l'adversaire n'est attribué à personne)
    const s = e.player_id && stats.get(e.player_id);
    if (e.side === 'us' && (e.type === 'goal' || e.type === 'penalty') && s) s.goals++;
    if (e.side === 'us' && e.assist_id && stats.has(e.assist_id)) stats.get(e.assist_id).assists++;
    if (e.side === 'us' && e.type === 'yellow' && s) s.yellow++;
    if (e.side === 'us' && e.type === 'second_yellow' && s) { s.yellow++; s.red++; }
    if (e.side === 'us' && e.type === 'red' && s) s.red++;
  }
  const upd = db.prepare('UPDATE players SET matches = ?, goals = ?, assists = ?, yellow_cards = ?, red_cards = ? WHERE id = ?');
  tx(() => { for (const [id, s] of stats) upd.run(s.matches, s.goals, s.assists, s.yellow, s.red, id); });
  return stats.size;
}

module.exports = { TYPES, list, scorers, add, remove, goalCount, recomputePlayerStats, playerIsUs };
