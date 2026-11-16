'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'esnaours.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  nickname TEXT,
  number INTEGER,
  position TEXT NOT NULL DEFAULT 'MIL',  -- GB, DEF, MIL, ATT, STAFF
  role TEXT,                            -- précision (latéral droit, coach...)
  birth_date TEXT,
  height INTEGER,
  foot TEXT,
  joined TEXT,
  previous_club TEXT,
  bio TEXT,
  photo TEXT,
  matches INTEGER DEFAULT 0,
  goals INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  yellow_cards INTEGER DEFAULT 0,
  red_cards INTEGER DEFAULT 0,
  is_captain INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fff_id TEXT UNIQUE,                   -- identifiant FFF (ma_no) si synchronisé
  source TEXT NOT NULL DEFAULT 'manual',-- 'fff' ou 'manual'
  competition TEXT,
  round TEXT,
  date TEXT,                            -- AAAA-MM-JJ
  time TEXT,                            -- HH:MM
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_logo TEXT,
  away_logo TEXT,
  home_score INTEGER,
  away_score INTEGER,
  is_home INTEGER DEFAULT 1,
  venue TEXT,
  status TEXT,                          -- ex. 'Reporté', 'Forfait'
  locked INTEGER DEFAULT 0,             -- 1 = ne pas écraser par la synchro
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS standings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rank INTEGER,
  team TEXT NOT NULL,
  logo TEXT,
  points INTEGER DEFAULT 0,
  played INTEGER DEFAULT 0,
  won INTEGER DEFAULT 0,
  drawn INTEGER DEFAULT 0,
  lost INTEGER DEFAULT 0,
  forfeits INTEGER DEFAULT 0,
  goals_for INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  goal_diff INTEGER DEFAULT 0,
  penalties INTEGER DEFAULT 0,
  is_us INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lineups (
  match_id INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  formation TEXT NOT NULL DEFAULT '4-4-2',
  slots TEXT NOT NULL DEFAULT '[]',     -- JSON : ids joueurs par poste
  subs TEXT NOT NULL DEFAULT '[]',      -- JSON : ids remplaçants
  captain_id INTEGER,
  meeting TEXT,                         -- RDV (heure / lieu)
  notes TEXT,
  published INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  image TEXT,
  pinned INTEGER DEFAULT 0,
  published INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS club_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  date TEXT,
  description TEXT,
  cover_id INTEGER,
  published INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  thumb TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const DEFAULT_SETTINGS = {
  club_name: 'ES Naours',
  team_label: 'Seniors · Départemental 5',
  competition_label: 'District de la Somme – D5',
  hero_tagline: 'Le club de foot de Naours depuis toujours, en vert et blanc.',
  logo: '',
  stadium: 'Stade municipal de Naours',
  address: 'Naours (80260), Somme',
  email: '',
  phone: '',
  facebook: '',
  instagram: '',
  // API FFF (api-dofa.fff.fr — même source que l'appli myFFF)
  fff_api_base: 'https://api-dofa.fff.fr',
  fff_club_id: '',
  fff_cp_no: '',
  fff_phase: '1',
  fff_poule: '',
  fff_team_pattern: 'NAOURS',
  fff_auto_sync: '1',
  fff_last_sync: '',
  fff_last_error: '',
  admin_password_hash: ''
};

const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertDefault.run(k, v);

if (db.prepare('SELECT COUNT(*) AS n FROM club_sections').get().n === 0) {
  const ins = db.prepare('INSERT INTO club_sections (title, body, sort_order) VALUES (?, ?, ?)');
  ins.run('Présentation', "L'**Entente Sportive de Naours** fait vivre le football au village. Notre équipe Seniors évolue en **Départemental 5** du District de la Somme.\n\n*Texte à personnaliser dans l'administration.*", 1);
  ins.run('Le stade', 'Stade municipal – Naours (80260)\n\nMatchs à domicile le dimanche après-midi.', 2);
  ins.run('Entraînements', '- Mercredi : 19h00 – 20h30\n- Vendredi : 19h00 – 20h30', 3);
  ins.run('Bureau', '- Président : à compléter\n- Secrétaire : à compléter\n- Trésorier : à compléter', 4);
  ins.run('Nous rejoindre', "Tu veux jouer ou donner un coup de main ? Viens nous voir à l'entraînement ou contacte-nous !", 5);
}

function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value ?? '';
  return out;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? '' : String(value));
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, getSettings, setSetting, tx, DATA_DIR, UPLOAD_DIR };
