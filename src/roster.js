'use strict';
/*
 * Ajout groupé de joueurs : une ligne par personne.
 * Formats acceptés (souples) :
 *   Jean Dupont
 *   DUPONT Jean            (style FFF : nom en majuscules d'abord)
 *   Dupont, Jean           (nom, prénom)
 *   10 Jean Dupont         (numéro au début)
 *   Jean Dupont - Gardien  (catégorie à la fin : gardien, défenseur, milieu, attaquant, staff…)
 */
const POS_WORDS = [
  [/^(gb|g|gardien(ne)?|goal|keeper)$/i, 'GB'],
  [/^(def|d|d[ée]f(enseur|enseuse)?|arri[eè]re|lat[ée]ral|central)$/i, 'DEF'],
  [/^(mil|m|milieu|mdc|moc)$/i, 'MIL'],
  [/^(att|a|attaquant(e)?|avant|buteur|ailier)$/i, 'ATT'],
  [/^(staff|coach|entra[iî]neur|dirigeant(e)?|d[ée]l[ée]gu[ée]|pr[ée]sident(e)?|arbitre|adjoint)$/i, 'STAFF']
];

const cap = w => w.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, sep, c) => sep + c.toUpperCase());
const isUpper = w => /\p{L}/u.test(w) && w === w.toUpperCase() && w.length > 1;

function parseLine(raw) {
  let line = String(raw || '').replace(/[\t;|]+/g, ' ').replace(/\s+/g, ' ').trim();
  line = line.replace(/^[-•*·]\s*/, '');
  if (!line) return null;

  let number = null;
  let position = null;
  let role = null;

  const num = line.match(/^(?:n[°o]\s*)?(\d{1,2})[.)]?\s+(.*)$/i);
  if (num) { number = Number(num[1]); line = num[2]; }

  // catégorie en fin de ligne : « … - Gardien », « … (Milieu) », « … ATT »
  const tail = line.match(/^(.*?)(?:\s*[-–(]\s*|\s+)([\p{L}éèêàîô]+)\)?$/u);
  // le poste n'est retenu que s'il reste au moins un prénom et un nom (« Marc Avant » reste un nom)
  if (tail && tail[1].trim().split(' ').length >= 2) {
    for (const [re, pos] of POS_WORDS) {
      if (re.test(tail[2])) { position = pos; role = pos === 'STAFF' ? cap(tail[2]) : null; line = tail[1].trim(); break; }
    }
  }

  let first = '', last = '';
  if (line.includes(',')) {
    const [a, b] = line.split(',').map(s => s.trim());
    last = a; first = b || '';
  } else {
    const words = line.split(' ');
    if (words.length === 1) { last = words[0]; }
    else if (isUpper(words[0]) && !words.every(isUpper)) {
      // « DUPONT DE LA TOUR Jean » : les mots en majuscules du début forment le nom
      let i = 0;
      while (i < words.length - 1 && isUpper(words[i])) i++;
      last = words.slice(0, i).join(' ');
      first = words.slice(i).join(' ');
    } else {
      first = words[0];
      last = words.slice(1).join(' ');
    }
  }
  first = cap(first.trim());
  last = cap(last.trim());
  if (!last && !first) return null;
  return { first_name: first || '?', last_name: last || '?', number, position: position || 'MIL', role, positionGiven: !!position };
}

function parseRoster(text) {
  return String(text || '').split(/\r?\n/).map(parseLine).filter(Boolean);
}

module.exports = { parseRoster, parseLine };
