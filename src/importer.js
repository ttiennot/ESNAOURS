'use strict';
/*
 * Import manuel des données FFF : l'administrateur ouvre une adresse de l'API
 * dans son navigateur (depuis chez lui, la FFF répond) et colle le texte obtenu.
 * Le format est détecté automatiquement : matchs (calendrier/résultats) ou classement.
 */
const { db, getSettings, setSetting, tx } = require('./db');
const fff = require('./fff');
const { configFromSettings, saveMatches, saveStandings, markSynced } = require('./sync');

/** Adresses à ouvrir dans le navigateur, construites depuis les réglages. */
function importLinks(s = getSettings()) {
  const cfg = configFromSettings(s);
  if (!cfg.cpNo || !cfg.poule) return null;
  const base = cfg.base.replace(/\/+$/, '') + fff.poulePath(cfg);
  const { start, end } = fff.seasonBounds();
  // n° de club interne de l'API : appris au premier import des résultats de la poule
  const clNo = s.fff_api_cl_no;
  const results = `${base}/resultat?ma_dat%5Bafter%5D=${start}&ma_dat%5Bbefore%5D=${end}`;
  return {
    matches: clNo ? `${base}/matchs?clNo=${encodeURIComponent(clNo)}` : null,
    results,
    resultsPage2: results + '&page=2',
    resultsPage3: results + '&page=3',
    standings: `${base}/classement_journees`
  };
}

function parse(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Rien à importer : colle le texte affiché par la page FFF.');
  if (/^<!doctype html|^<html/i.test(t)) throw new Error("C'est une page web, pas des données : la FFF a sans doute refusé l'accès. Réessaie depuis un autre navigateur ou réseau.");
  try { return JSON.parse(t); }
  catch { throw new Error("Le texte collé n'est pas complet ou pas au bon format. Sélectionne tout le contenu de la page (Ctrl+A) avant de copier."); }
}

function importFffText(text) {
  const data = parse(text);
  const { items } = fff.members(data);
  if (!items.length) throw new Error('Aucune donnée trouvée dans le texte collé (la liste est vide).');
  const cfg = configFromSettings();
  const hasNext = !!(data['hydra:view'] && data['hydra:view']['hydra:next']);

  const matchItems = items.filter(i => i && i.ma_no != null && (i.home || i.away));
  const standingItems = items.filter(i => i && (i.point_count != null || i.rank != null) && i.equipe);
  if (!matchItems.length && !standingItems.length) throw new Error("Format non reconnu : ce ne sont ni des matchs ni un classement.");

  const out = { matches: 0, ours: 0, standings: 0, source: null, hasNext };

  tx(() => {
    if (matchItems.length) {
      // mémorise le numéro de club interne de l'API (≠ n° d'affiliation)
      for (const m of matchItems) {
        for (const t of [m.home, m.away]) {
          if (t && fff.isUs(t, cfg) && fff.teamClubId(t)) setSetting('fff_api_cl_no', fff.teamClubId(t));
        }
      }
      const up = db.prepare(`INSERT INTO poule_results (ma_no, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(ma_no) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`);
      for (const m of matchItems) up.run(String(m.ma_no), JSON.stringify(m));
      const ours = matchItems.map(m => fff.normalizeMatch(m, cfg)).filter(m => m.involves_us);
      out.matches = matchItems.length;
      out.ours = saveMatches(ours);
    }

    if (standingItems.length) {
      const rows = fff.dedupeStandings(standingItems.map(s => fff.normalizeStanding(s, cfg)).filter(r => r.team));
      saveStandings(rows);
      out.standings = rows.length;
      out.source = 'officiel';
    } else if (matchItems.length) {
      // classement recalculé depuis tous les résultats de la poule connus,
      // seulement si on dispose de matchs d'autres équipes que la nôtre
      const all = db.prepare('SELECT data FROM poule_results').all().map(r => JSON.parse(r.data))
        .filter(m => !m.competition || !cfg.cpNo || String(m.competition.cp_no) === String(cfg.cpNo));
      const othersOnly = all.some(m => !fff.isUs(m.home || {}, cfg) && !fff.isUs(m.away || {}, cfg));
      if (othersOnly) {
        const rows = fff.standingsFromMatches(all, cfg);
        saveStandings(rows);
        out.standings = rows.length;
        out.source = 'calculé';
      }
    }
  });

  markSynced(out.source);
  return out;
}

module.exports = { importFffText, importLinks };
