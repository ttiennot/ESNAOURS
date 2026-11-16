'use strict';
const { db, getSettings, setSetting, tx } = require('./db');
const fff = require('./fff');

function configFromSettings(s = getSettings()) {
  return {
    base: s.fff_api_base || 'https://api-dofa.fff.fr',
    clubId: s.fff_club_id,
    cpNo: s.fff_cp_no,
    phase: s.fff_phase || '1',
    poule: s.fff_poule,
    pattern: s.fff_team_pattern || 'NAOURS',
    competitionLabel: s.competition_label
  };
}

function isConfigured(cfg) {
  return !!(cfg.cpNo && cfg.poule);
}

let running = null;

async function syncAll() {
  if (running) return running;
  running = (async () => {
    const cfg = configFromSettings();
    if (!isConfigured(cfg)) {
      return { ok: false, error: 'Synchronisation non configurée (n° de compétition et de poule manquants).' };
    }
    try {
      const [standings, matches] = await Promise.all([fff.fetchStandings(cfg), fff.fetchMatches(cfg)]);
      tx(() => {
        if (standings.length) {
          db.exec('DELETE FROM standings');
          const ins = db.prepare(`INSERT INTO standings (rank, team, logo, points, played, won, drawn, lost, forfeits, goals_for, goals_against, goal_diff, penalties, is_us)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
          for (const r of standings) ins.run(r.rank, r.team, r.logo, r.points, r.played, r.won, r.drawn, r.lost, r.forfeits, r.goals_for, r.goals_against, r.goal_diff, r.penalties, r.is_us);
        }
        const find = db.prepare('SELECT id, locked FROM matches WHERE fff_id = ?');
        const ins = db.prepare(`INSERT INTO matches (fff_id, source, competition, round, date, time, home_team, away_team, home_logo, away_logo, home_score, away_score, is_home, venue, status)
          VALUES (?, 'fff', ?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        const upd = db.prepare(`UPDATE matches SET competition=?, round=?, date=?, time=?, home_team=?, away_team=?, home_logo=?, away_logo=?, home_score=?, away_score=?, is_home=?, venue=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
        for (const m of matches) {
          if (!m.fff_id) continue;
          const vals = [m.competition, m.round, m.date, m.time, m.home_team, m.away_team, m.home_logo, m.away_logo, m.home_score, m.away_score, m.is_home, m.venue, m.status];
          const row = find.get(m.fff_id);
          if (!row) ins.run(m.fff_id, ...vals);
          else if (!row.locked) upd.run(...vals, row.id);
        }
      });
      setSetting('fff_last_sync', new Date().toISOString());
      setSetting('fff_last_error', '');
      return { ok: true, standings: standings.length, matches: matches.length };
    } catch (e) {
      setSetting('fff_last_error', `${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} – ${e.message}`);
      return { ok: false, error: e.message };
    }
  })();
  try { return await running; } finally { running = null; }
}

function startScheduler(intervalMinutes = 30) {
  const tick = () => {
    if (getSettings().fff_auto_sync !== '1') return;
    syncAll().then(r => { if (!r.ok) console.warn('[sync FFF]', r.error); else console.log(`[sync FFF] ${r.matches} matchs, ${r.standings} équipes`); });
  };
  setTimeout(tick, 5000);
  return setInterval(tick, intervalMinutes * 60 * 1000);
}

module.exports = { syncAll, startScheduler, configFromSettings, isConfigured };
