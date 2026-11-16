'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { getSettings, setSetting } = require('./db');

function ensureAdminPassword() {
  const s = getSettings();
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD_RESET === '1') {
    setSetting('admin_password_hash', bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10));
    console.log('[admin] Mot de passe réinitialisé depuis ADMIN_PASSWORD.');
    return;
  }
  if (s.admin_password_hash) return;
  let pwd = process.env.ADMIN_PASSWORD;
  if (!pwd) {
    pwd = crypto.randomBytes(9).toString('base64url');
    console.log('==================================================');
    console.log(`[admin] Mot de passe administrateur généré : ${pwd}`);
    console.log('[admin] Change-le dans Administration > Réglages.');
    console.log('==================================================');
  }
  setSetting('admin_password_hash', bcrypt.hashSync(pwd, 10));
}

function checkPassword(pwd) {
  const hash = getSettings().admin_password_hash;
  return !!hash && bcrypt.compareSync(String(pwd || ''), hash);
}

function setPassword(pwd) {
  setSetting('admin_password_hash', bcrypt.hashSync(pwd, 10));
}

/* Limitation simple des tentatives de connexion (par IP). */
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.first > 15 * 60 * 1000) return false;
  return a.count >= 8;
}
function recordFailure(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.first > 15 * 60 * 1000) attempts.set(ip, { first: now, count: 1 });
  else a.count += 1;
}
function clearFailures(ip) { attempts.delete(ip); }

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
}

/* Protection CSRF : jeton stocké en session, vérifié sur chaque POST admin. */
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  return req.session.csrf;
}
function verifyCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (sent && req.session && sent === req.session.csrf) return next();
  return res.status(403).send('Jeton de sécurité invalide. Recharge la page et réessaie.');
}

module.exports = { ensureAdminPassword, checkPassword, setPassword, tooManyAttempts, recordFailure, clearFailures, requireAdmin, csrfToken, verifyCsrf };
