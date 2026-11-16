'use strict';
/*
 * Client de l'API FFF « DOFA » (api-dofa.fff.fr).
 * C'est l'API publique qui alimente l'appli myFFF et les sites des districts.
 * Les réponses peuvent être en JSON-LD (hydra:member) ou en tableau simple :
 * les fonctions ci-dessous gèrent les deux formats et restent tolérantes
 * aux champs manquants.
 */

/*
 * En-têtes repris du projet Open-FFF-Stats (github.com/GeoHolz/Open-FFF-Stats) :
 * l'API est protégée par un pare-feu qui rejette les requêtes ne ressemblant pas
 * à celles du site fff.fr. Le User-Agent peut être remplacé via FFF_USER_AGENT.
 */
const HEADERS = {
  'User-Agent': process.env.FFF_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  Origin: 'https://www.fff.fr',
  Referer: 'https://www.fff.fr/'
};

async function getJson(base, path, { timeout = 20000 } = {}) {
  const url = /^https?:/.test(path) ? path : base.replace(/\/+$/, '') + path;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok || /^\s*<!doctype html/i.test(text) || !type.includes('json')) {
    const shortPath = path.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    throw new Error(`API FFF : HTTP ${res.status} sur ${shortPath}${type.includes('json') ? '' : ' (réponse non JSON : accès filtré par le pare-feu FFF)'}`);
  }
  return JSON.parse(text);
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
    if (next) nextPath = /^https?:/.test(next) || next.startsWith('/') ? next : '/' + next;
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
  const homeFf = m.home_is_forfeit === true || m.home_is_forfeit === 'O';
  const awayFf = m.away_is_forfeit === true || m.away_is_forfeit === 'O';
  if (homeFf || awayFf || /\b(FO|FF|FG)\b/.test(resu)) status = 'Forfait';
  const label = String(m.status_label || '');
  if (m.seems_postponed === true || m.seems_postponed === 'O' || /report/i.test(label)) status = 'Reporté';
  else if (/annul|arr[eê]t/i.test(label)) status = label;
  return {
    fff_id: String(pick(m.ma_no, m.id, m['@id'], '')),
    competition: pick(m.competition && m.competition.name, cfg.competitionLabel, null),
    round: journee.number != null ? `J${journee.number}` : (journee.name ? String(journee.name).replace(/^journ[ée]e\s*/i, 'J') : null),
    home_forfeit: homeFf,
    away_forfeit: awayFf,
    _home: home,
    _away: away,
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

/** Bornes de la saison en cours (1er juillet → 30 juin). */
function seasonBounds(now = new Date()) {
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return { start: `${y}-07-01`, end: `${y + 1}-06-30` };
}

/** Tous les matchs de la poule : route /resultat (comme Open-FFF-Stats), sinon /matchs. */
async function fetchPouleMatches(cfg) {
  const { start, end } = seasonBounds();
  try {
    return await getAll(cfg.base, `${poulePath(cfg)}/resultat?ma_dat%5Bafter%5D=${start}&ma_dat%5Bbefore%5D=${end}`);
  } catch {
    return getAll(cfg.base, `${poulePath(cfg)}/matchs`);
  }
}

/** Classement recalculé depuis les résultats (barème district : V 3, N 1, D 0, forfait -1). */
function standingsFromMatches(rawMatches, cfg) {
  const table = new Map();
  const row = t => {
    const name = teamName(t);
    if (!table.has(name)) {
      table.set(name, { team: name, logo: teamLogo(t), points: 0, played: 0, won: 0, drawn: 0, lost: 0, forfeits: 0,
        goals_for: 0, goals_against: 0, goal_diff: 0, penalties: 0, is_us: isUs(t, cfg) ? 1 : 0, rank: null });
    }
    return table.get(name);
  };
  for (const raw of rawMatches) {
    const m = normalizeMatch(raw, cfg);
    if (!teamName(m._home) || !teamName(m._away)) continue;
    const h = row(m._home), a = row(m._away);
    if (m.home_score == null || m.away_score == null || m.status === 'Reporté') continue;
    h.played++; a.played++;
    h.goals_for += m.home_score; h.goals_against += m.away_score;
    a.goals_for += m.away_score; a.goals_against += m.home_score;
    if (m.home_forfeit || m.away_forfeit) {
      if (m.home_forfeit) { h.forfeits++; h.lost++; h.points -= 1; } else { h.won++; h.points += 3; }
      if (m.away_forfeit) { a.forfeits++; a.lost++; a.points -= 1; } else { a.won++; a.points += 3; }
    } else if (m.home_score > m.away_score) { h.won++; h.points += 3; a.lost++; }
    else if (m.home_score < m.away_score) { a.won++; a.points += 3; h.lost++; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }
  const list = [...table.values()];
  list.forEach(r => { r.goal_diff = r.goals_for - r.goals_against; });
  list.sort((x, y) => y.points - x.points || y.goal_diff - x.goal_diff || y.goals_for - x.goals_for || x.team.localeCompare(y.team));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

/** Classement officiel FFF (pénalités incluses) ; à défaut, recalculé depuis les résultats. */
async function fetchStandings(cfg, pouleMatches) {
  try {
    const raw = await getAll(cfg.base, poulePath(cfg) + '/classement_journees');
    const rows = dedupeStandings(raw.map(s => normalizeStanding(s, cfg)).filter(r => r.team));
    if (rows.length) return { rows, source: 'officiel' };
  } catch { /* repli sur le calcul */ }
  return { rows: standingsFromMatches(pouleMatches || await fetchPouleMatches(cfg), cfg), source: 'calculé' };
}

async function fetchMatches(cfg, pouleMatches) {
  let raw = pouleMatches;
  if (!raw && cfg.clubId) {
    try { raw = await getAll(cfg.base, `${poulePath(cfg)}/matchs?clNo=${encodeURIComponent(cfg.clubId)}`); } catch { raw = null; }
  }
  if (!raw) raw = await fetchPouleMatches(cfg);
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
  fetchStandings, fetchMatches, fetchPouleMatches, fetchClubTeams, standingsFromMatches, seasonBounds, parisDate, normTime
};
