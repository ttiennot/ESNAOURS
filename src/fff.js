'use strict';
/*
 * Client de l'API FFF « DOFA » (api-dofa.fff.fr).
 * C'est l'API publique qui alimente l'appli myFFF et les sites des districts.
 * Les réponses peuvent être en JSON-LD (hydra:member) ou en tableau simple :
 * les fonctions ci-dessous gèrent les deux formats et restent tolérantes
 * aux champs manquants.
 */

const UA = 'ESNaours-Site/1.0 (+https://esnaours.fr)';

async function getJson(base, path, { timeout = 15000 } = {}) {
  const url = base.replace(/\/+$/, '') + path;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(timeout)
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('json')) {
    throw new Error(`API FFF : HTTP ${res.status} sur ${path}${type.includes('json') ? '' : ' (réponse non JSON, accès probablement filtré)'}`);
  }
  return res.json();
}

function members(data) {
  if (Array.isArray(data)) return { items: data, next: null };
  if (data && Array.isArray(data['hydra:member'])) {
    const view = data['hydra:view'] || {};
    return { items: data['hydra:member'], next: view['hydra:next'] || null };
  }
  return { items: [], next: null };
}

async function getAll(base, path, maxPages = 20) {
  const all = [];
  let page = 1;
  let nextPath = path;
  while (nextPath && page <= maxPages) {
    const data = await getJson(base, nextPath);
    const { items, next } = members(data);
    all.push(...items);
    if (next) nextPath = next;
    else if (Array.isArray(data) && items.length >= 30) {
      page += 1;
      nextPath = path + (path.includes('?') ? '&' : '?') + 'page=' + page;
      continue;
    } else nextPath = null;
    page += 1;
  }
  return all;
}

/* ---------- Normalisation ---------- */

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
const num = v => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function teamName(t) {
  if (!t) return '';
  return String(pick(t.short_name, t.name, t.club && t.club.name, t.nom, '')).trim();
}
function teamClubId(t) {
  return t && t.club ? String(pick(t.club.cl_no, t.club.id, '')) : '';
}
function teamLogo(t) {
  if (!t) return '';
  return String(pick(t.club && t.club.logo, t.logo, '') || '');
}

/** Convertit une date ISO de l'API en AAAA-MM-JJ (heure de Paris). */
function parisDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // fr-CA => AAAA-MM-JJ
}

function normTime(t) {
  if (!t) return null;
  const m = String(t).match(/(\d{1,2})\s*[hH:]\s*(\d{2})?/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${(m[2] || '00')}`;
}

function isUs(team, cfg) {
  const id = teamClubId(team);
  if (cfg.clubId && id && id === String(cfg.clubId)) return true;
  const pat = (cfg.pattern || '').trim().toUpperCase();
  return !!pat && teamName(team).toUpperCase().includes(pat);
}

function normalizeMatch(m, cfg) {
  const home = m.home || m.equipe_dom || {};
  const away = m.away || m.equipe_ext || {};
  const homeScore = num(pick(m.home_score, m.score_dom));
  const awayScore = num(pick(m.away_score, m.score_ext));
  const journee = m.poule_journee || {};
  const terrain = m.terrain || {};
  const resu = `${m.home_resu || ''} ${m.away_resu || ''}`.toUpperCase();
  let status = null;
  if (/\b(FO|FF|FG)\b/.test(resu)) status = 'Forfait';
  if (m.seems_postponed === true || m.seems_postponed === 'O' || /report/i.test(String(m.status_label || ''))) status = 'Reporté';
  return {
    fff_id: String(pick(m.ma_no, m.id, m['@id'], '')),
    competition: pick(m.competition && m.competition.name, cfg.competitionLabel, null),
    round: journee.number != null ? `J${journee.number}` : pick(journee.name, null),
    date: parisDate(pick(m.date, m.match_date)),
    time: normTime(pick(m.time, m.heure)),
    home_team: teamName(home) || 'À déterminer',
    away_team: teamName(away) || 'À déterminer',
    home_logo: teamLogo(home),
    away_logo: teamLogo(away),
    home_score: homeScore,
    away_score: awayScore,
    is_home: isUs(home, cfg) ? 1 : 0,
    involves_us: isUs(home, cfg) || isUs(away, cfg),
    venue: [terrain.name, terrain.city].filter(Boolean).join(' – ') || null,
    status
  };
}

function normalizeStanding(s, cfg) {
  const team = s.equipe || s.team || {};
  return {
    rank: num(pick(s.rank, s.place)),
    team: teamName(team),
    logo: teamLogo(team),
    points: num(pick(s.point_count, s.points)) || 0,
    played: num(pick(s.total_games_count, s.played)) || 0,
    won: num(pick(s.won_games_count, s.won)) || 0,
    drawn: num(pick(s.draw_games_count, s.drawn)) || 0,
    lost: num(pick(s.lost_games_count, s.lost)) || 0,
    forfeits: num(pick(s.forfeits_games_count, s.forfeit_games_count)) || 0,
    goals_for: num(pick(s.goals_for_count, s.goals_for)) || 0,
    goals_against: num(pick(s.goals_against_count, s.goals_against)) || 0,
    goal_diff: num(pick(s.goals_diff, s.goal_diff)) ?? 0,
    penalties: num(pick(s.penalty_point_count)) || 0,
    is_us: isUs(team, cfg) ? 1 : 0
  };
}

/** Garde une seule ligne par équipe (la plus récente) et trie. */
function dedupeStandings(rows) {
  const byTeam = new Map();
  for (const r of rows) {
    const prev = byTeam.get(r.team);
    if (!prev || r.played >= prev.played) byTeam.set(r.team, r);
  }
  const list = [...byTeam.values()];
  list.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.points - a.points || b.goal_diff - a.goal_diff);
  list.forEach((r, i) => { if (r.rank == null) r.rank = i + 1; });
  return list;
}

/* ---------- Appels haut niveau ---------- */

function poulePath(cfg) {
  return `/api/compets/${encodeURIComponent(cfg.cpNo)}/phases/${encodeURIComponent(cfg.phase || 1)}/poules/${encodeURIComponent(cfg.poule)}`;
}

async function fetchStandings(cfg) {
  const raw = await getAll(cfg.base, poulePath(cfg) + '/classement_journees');
  return dedupeStandings(raw.map(s => normalizeStanding(s, cfg)).filter(r => r.team));
}

async function fetchMatches(cfg) {
  const raw = await getAll(cfg.base, poulePath(cfg) + '/matchs');
  return raw.map(m => normalizeMatch(m, cfg)).filter(m => m.involves_us);
}

/** Liste les équipes et engagements d'un club (aide à la configuration). */
async function fetchClubTeams(cfg) {
  const raw = await getAll(cfg.base, `/api/clubs/${encodeURIComponent(cfg.clubId)}/equipes`, 5);
  const out = [];
  for (const t of raw) {
    const engagements = t.engagements || [];
    for (const e of engagements) {
      out.push({
        team: teamName(t),
        category: pick(t.category_label, t.category_code, ''),
        competition: pick(e.competition && e.competition.name, ''),
        cp_no: pick(e.competition && e.competition.cp_no, ''),
        phase: pick(e.phase && e.phase.number, 1),
        poule: pick(e.poule && e.poule.stage_number, ''),
        poule_name: pick(e.poule && e.poule.name, '')
      });
    }
    if (!engagements.length) out.push({ team: teamName(t), category: pick(t.category_label, t.category_code, ''), competition: '', cp_no: '', phase: '', poule: '', poule_name: '' });
  }
  return out;
}

module.exports = {
  getJson, members, getAll,
  normalizeMatch, normalizeStanding, dedupeStandings,
  fetchStandings, fetchMatches, fetchClubTeams, parisDate, normTime
};
