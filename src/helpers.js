'use strict';
const { marked } = require('marked');

marked.setOptions({ gfm: true, breaks: true });

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Markdown simple (gras, listes, liens) – le HTML brut est neutralisé. */
function md(text) {
  if (!text) return '';
  const html = marked.parse(escapeHtml(text));
  // n'autorise que les liens http(s)/mailto/tel
  return html.replace(/href="(?!https?:|mailto:|tel:|\/)[^"]*"/gi, 'href="#"');
}

const TZ = 'Europe/Paris';
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const DAYS_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function parseYmd(ymd) {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

function fmtDate(ymd, { long = false, year = false } = {}) {
  const p = parseYmd(ymd);
  if (!p) return 'Date à fixer';
  const day = long ? DAYS_LONG[p.dow] : DAYS[p.dow];
  const month = long ? ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][p.m - 1] : MONTHS[p.m - 1];
  return `${day} ${p.d} ${month}${year ? ' ' + p.y : ''}`;
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
}

function todayParis() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function age(birth) {
  const p = parseYmd(birth);
  if (!p) return null;
  const t = parseYmd(todayParis());
  let a = t.y - p.y;
  if (t.m < p.m || (t.m === p.m && t.d < p.d)) a -= 1;
  return a;
}

/** Résultat du point de vue de l'ES Naours : 'V', 'N', 'D' ou null. */
function outcome(m) {
  if (m.home_score == null || m.away_score == null) return null;
  const us = m.is_home ? m.home_score : m.away_score;
  const them = m.is_home ? m.away_score : m.home_score;
  return us > them ? 'V' : us < them ? 'D' : 'N';
}

const POSITIONS = {
  GB: { label: 'Gardiens', single: 'Gardien' },
  DEF: { label: 'Défenseurs', single: 'Défenseur' },
  MIL: { label: 'Milieux', single: 'Milieu' },
  ATT: { label: 'Attaquants', single: 'Attaquant' },
  STAFF: { label: 'Staff', single: 'Staff' }
};

function initials(p) {
  return ((p.first_name || '')[0] || '') + ((p.last_name || '')[0] || '');
}

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = { escapeHtml, md, fmtDate, fmtDateTime, todayParis, age, outcome, POSITIONS, initials, slugify, parseYmd };

/** Écusson d'équipe : logo FFF si dispo, sinon initiales. */
/* Couleur stable par équipe pour les écussons sans logo (initiales sur fond coloré) */
const TEAM_COLORS = ['#C8102E', '#1E4FA3', '#B91C1C', '#3F3F46', '#15803D', '#1E3A8A', '#52525B', '#9F1239', '#166534', '#7C2D12', '#0F766E', '#6B21A8'];
function teamColor(name) {
  let h = 0;
  for (const c of String(name || '')) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length];
}

function badge(name, logo, { us = false, settings = {}, size = '' } = {}) {
  const cls = `badge${size ? ' badge--' + size : ''}${us ? ' badge--us' : ''}`;
  const src = us ? (settings.logo || '/static/img/crest.png') : logo;
  const style = `style="--tc:${teamColor(name)}"`;
  if (src) return `<span class="${cls}" ${style}><img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('badge--txt');this.remove()"><b>${escapeHtml(abbr(name))}</b></span>`;
  return `<span class="${cls} badge--txt" ${style}><b>${escapeHtml(abbr(name))}</b></span>`;
}

function abbr(name) {
  const words = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w.length > 1 && !/^(ES|AS|US|FC|SC|AC|JS|ENT|ENTENTE|OLYMPIQUE|CLUB|DE|DU|LA|LE|LES|SPORT|SPORTIVE|SPORTS)$/i.test(w));
  const base = words.length ? words : String(name || '?').split(/\s+/);
  return base.slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

module.exports.badge = badge;
module.exports.teamColor = teamColor;
module.exports.abbr = abbr;

function fmtPosted(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).includes('T') ? iso : String(iso).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
}
module.exports.fmtPosted = fmtPosted;
