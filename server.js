'use strict';
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');
const crypto = require('node:crypto');

const { getSettings, UPLOAD_DIR } = require('./src/db');
const helpers = require('./src/helpers');
const { FORMATIONS } = require('./src/formations');
const { ensureAdminPassword } = require('./src/auth');
const { startScheduler } = require('./src/sync');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';

if (PROD && !process.env.SESSION_SECRET) {
  console.warn('[securite] SESSION_SECRET non défini : une clé aléatoire est utilisée (les sessions admin seront perdues au redémarrage).');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN'
  });
  next();
});

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '7d' : 0 }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/img/crest.svg'));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\n'));

app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieSession({
  name: 'esn_sess',
  keys: [process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')],
  maxAge: 7 * 24 * 3600 * 1000,
  sameSite: 'lax',
  httpOnly: true,
  secure: PROD && process.env.COOKIE_SECURE !== '0'
}));

app.use((req, res, next) => {
  res.locals.settings = getSettings();
  res.locals.h = helpers;
  res.locals.FORMATIONS = FORMATIONS;
  res.locals.path = req.path;
  res.locals.isAdmin = !!(req.session && req.session.admin);
  res.locals.flash = req.session && req.session.flash;
  if (req.session) req.session.flash = null;
  next();
});

app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => res.status(404).render('404', { title: 'Page introuvable' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('404', { title: 'Erreur', message: "Une erreur est survenue. Réessaie dans un instant." });
});

ensureAdminPassword();
if (process.env.DISABLE_SYNC !== '1') startScheduler(Number(process.env.SYNC_INTERVAL_MINUTES) || 30);

app.listen(PORT, () => console.log(`ES Naours en ligne sur http://localhost:${PORT}`));
