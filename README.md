# ⚽ ES Naours – site de l'équipe Seniors (D5)

Site officiel de l'équipe Seniors de l'**ES Naours** (District de la Somme, Départemental 5), aux couleurs du club (vert et blanc).

| Page | Contenu |
|---|---|
| **Accueil** | Prochain match (compte à rebours, compo si publiée), derniers résultats, extrait du classement, actus, photos |
| **Calendrier** | Tous les matchs, filtres *à venir* / *résultats*, bilan V-N-D |
| **Classement** | Classement complet de la poule, ligne ES Naours mise en avant, forme récente |
| **Effectif** | Joueurs par poste (menu de filtres), photos, fiche détaillée au clic (âge, taille, pied, stats, présentation) |
| **Compo** | Composition saisie par l'admin : terrain avec système de jeu, remplaçants, capitaine, RDV, mot du coach |
| **Photos** | Un album par match, galerie plein écran (glisser sur mobile, flèches au clavier) |
| **Le club** | Actualités et rubriques d'infos (présentation, stade, entraînements, bureau…) modifiables |
| **Admin** (`/admin`) | Gestion de tout le contenu, synchro FFF, envoi de photos par glisser-déposer |

## Données FFF (calendrier & classement)

Les données viennent de l'**API FFF « DOFA »** (`api-dofa.fff.fr`), qui alimente l'appli myFFF et les sites des districts. Le serveur synchronise toutes les 30 minutes et stocke les données localement : si l'API est momentanément indisponible, le site continue d'afficher les dernières données connues.

Fonctionnement, sur le modèle du projet [Open-FFF-Stats](https://github.com/GeoHolz/Open-FFF-Stats) :
- les requêtes envoient les mêmes en-têtes que le site fff.fr (`Origin`/`Referer: https://www.fff.fr`, User-Agent de navigateur), sans quoi le pare-feu de l'API répond par une erreur 403. Le User-Agent peut être changé avec la variable `FFF_USER_AGENT` dans `.env` ;
- calendrier : route `…/poules/{poule}/resultat` (saison en cours), avec `…/matchs` en secours ;
- classement : classement officiel (`classement_journees`, pénalités comprises). S'il est indisponible, il est **recalculé depuis les résultats** (victoire 3, nul 1, défaite 0, forfait -1). Le tableau de bord indique la source utilisée.

Configuration dans **Admin → Réglages → Synchronisation FFF** :
1. **Le plus simple :** coller l'adresse de la page de la poule (`epreuves.fff.fr` ou `somme.fff.fr`), par exemple `…/competition/engagement/444088-…/phase/1/11/…`. N° de compétition, phase et poule se remplissent tout seuls.
2. Ou bien : saisir le **n° de club FFF**, cliquer sur **« Rechercher les équipes du club »** et choisir l'engagement **Seniors / D5**.
3. Renseigner le **n° de club** dans tous les cas : il sert à reconnaître l'ES Naours dans les matchs.
4. Enregistrer, puis **Synchroniser maintenant** depuis le tableau de bord.

**Solution de secours :** si l'API refuse l'accès depuis le serveur (elle filtre certains hébergeurs), on peut saisir les matchs (*Matchs → + Match manuel*) et le classement (*Classement*) dans l'admin. Un match peut aussi être **verrouillé 🔒** pour que la synchro ne l'écrase pas. Les matchs de coupe et les matchs amicaux se saisissent toujours à la main.

## Installation sur le VPS OVH (54.37.9.20)

### 1. DNS (espace client OVH → Noms de domaine → esnaours.fr → Zone DNS)
| Type | Sous-domaine | Cible |
|---|---|---|
| A | *(vide)* | `54.37.9.20` |
| A | `www` | `54.37.9.20` |

Supprimer les anciens enregistrements **A** et **AAAA** de `esnaours.fr` et `www` qui pointent ailleurs (page de parking OVH). La propagation prend de quelques minutes à quelques heures.

### 2. Préparer le serveur (en SSH, en root)
```bash
curl -fsSL https://get.docker.com | sh
```
```bash
git clone https://github.com/ttiennot/ESNAOURS.git /opt/esnaours
```
```bash
cd /opt/esnaours && cp .env.example .env && nano .env
```
Dans `.env`, choisir `ADMIN_PASSWORD` et coller dans `SESSION_SECRET` le résultat de :
```bash
openssl rand -hex 32
```
Si un pare-feu est actif (ufw), ouvrir les ports web :
```bash
ufw allow 80,443/tcp
```

### 3 bis. Si un autre site utilise déjà les ports 80/443 (Nginx ou Apache)
Le site écoute en local sur `127.0.0.1:3010` (modifiable avec `APP_PORT` dans `.env`). Le serveur web existant relaie esnaours.fr vers ce port :
- **Nginx** : copier `deploy/nginx-esnaours.conf` dans `/etc/nginx/sites-available/`, l'activer, puis lancer `certbot --nginx -d esnaours.fr -d www.esnaours.fr` ;
- **Apache** : copier `deploy/apache-esnaours.conf` dans `/etc/apache2/sites-available/`, activer `a2enmod proxy proxy_http headers`, puis lancer `certbot --apache -d esnaours.fr -d www.esnaours.fr`.

Sans autre site sur le VPS, ajouter `COMPOSE_PROFILES=caddy` dans `.env` : Caddy gère alors seul les ports 80/443 et l'HTTPS.

### 3. Lancer le site
```bash
cd /opt/esnaours && ./scripts/deploy.sh
```
Caddy obtient automatiquement le certificat HTTPS (Let's Encrypt) dès que le DNS pointe vers le VPS. Le site est alors en ligne sur **https://esnaours.fr**, et l'admin sur **https://esnaours.fr/admin**.

Pour vérifier que l'API FFF répond depuis le VPS (doit afficher du JSON, pas une page HTML) :
```bash
curl -s https://api-dofa.fff.fr/api/clubs/NUMERO_DE_CLUB | head -c 300
```

### Mises à jour, logs, sauvegardes
```bash
cd /opt/esnaours && ./scripts/deploy.sh
```
```bash
docker compose logs -f app
```
```bash
./scripts/backup.sh
```
Pour une sauvegarde chaque nuit (base + photos, 14 jours conservés), ajouter dans `crontab -e` :
```
30 3 * * * cd /opt/esnaours && ./scripts/backup.sh
```
Toutes les données (base SQLite + photos) se trouvent dans `/opt/esnaours/data`.

**Mot de passe admin oublié :** dans `.env`, mettre un nouveau `ADMIN_PASSWORD` et `ADMIN_PASSWORD_RESET=1`, lancer `docker compose up -d`, puis remettre `ADMIN_PASSWORD_RESET=0`.

## Développement local

Node.js ≥ 22.13 requis (SQLite intégré).
```bash
npm install
```
```bash
DATA_DIR=./data-demo npm run demo
```
```bash
DATA_DIR=./data-demo ADMIN_PASSWORD=demo1234 DISABLE_SYNC=1 npm run dev
```
Puis ouvrir http://localhost:3000 (admin : `demo1234`). La commande `npm run demo` ajoute des joueurs et adversaires **fictifs** : ne jamais la lancer en production.

Pour lancer les tests (synchro FFF contre une API simulée) :
```bash
npm test
```

### Organisation du code
```
server.js            serveur Express
src/db.js            schéma SQLite + réglages
src/fff.js           client API FFF + normalisation des données
src/sync.js          synchronisation planifiée
src/formations.js    systèmes de jeu (4-4-2, 4-3-3, 4-2-3-1, 3-5-2…)
src/routes/          pages publiques et administration
views/               gabarits EJS
public/              CSS, JS, écusson par défaut
```
