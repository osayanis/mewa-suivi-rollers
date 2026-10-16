# Suivi des rollers Mewa

Application web interne : les agents de production **scannent un roller au départ** puis **le rescannent au retour**, et l'on voit en temps réel les rollers **en transit** ou **sur site**.

Tout tourne dans **un seul conteneur Docker** : l'interface web et l'API. Il n'y a rien à installer sur les postes : un navigateur suffit, PC avec douchette, tablette ou smartphone.

```
 PC / tablette / smartphone                     Serveur Docker
┌────────────────────────────┐   http://…:8080  ┌───────────────────────────────┐
│ Navigateur                  │ ───────────────▶ │ conteneur « mewa-rollers »     │
│ + douchette (ou caméra)     │ ◀─────────────── │  interface web + API + SQLite │
└────────────────────────────┘                   │  données : volume rollers-data │
                                                 └───────────────────────────────┘
```

## Installation sur le serveur

Pré-requis : un serveur avec Docker et Docker Compose.

**1. Copier le projet sur le serveur.** Par exemple dans `/opt/mewa-rollers/`. Le dossier `node_modules` est inutile.

**2. Configurer (facultatif).**
```bash
cd /opt/mewa-rollers
cp .env.example .env
nano .env          # par exemple ACCESS_CODE=UnCodeChoisi
```

**3. Lancer.**
```bash
docker compose up -d --build
```

**4. Ouvrir** `http://<adresse-du-serveur>:8080` dans un navigateur. C'est prêt.

Pour mettre à jour après une modification du code : `docker compose up -d --build`. Les données sont conservées.

### Réglages (`.env`)

| Variable | Rôle | Par défaut |
|---|---|---|
| `STATION_NAME` | Nom du poste enregistré avec chaque scan. | GS75 Toussieu |
| `ACCESS_CODE` | Code demandé une seule fois par appareil. Vide = pas de code. | vide |
| `OVERDUE_DAYS` | Nombre de jours en transit avant qu'un roller soit signalé « en retard ». | 7 |
| `DUPLICATE_WINDOW_SECONDS` | Double lecture accidentelle ignorée dans ce délai (0 = désactivé). | 2 |
| `CODE_PREFIX` / `CODE_DIGITS` | Format des codes-barres (`ROL000042`). | ROL / 6 |

Après une modification de `.env` : `docker compose up -d`.

### HTTP ou HTTPS ?

- **Douchettes (PC)** : `http://serveur:8080` suffit.
- **Mode caméra (tablettes, smartphones)** : le navigateur n'autorise la caméra qu'en **HTTPS**. Il faut alors publier l'application derrière le reverse proxy HTTPS de l'entreprise (ex. `https://rollers.mewa.local` → `http://serveur:8080`).

### Sauvegarde

Toutes les données sont dans un seul fichier SQLite, dans le volume Docker `rollers-data`. Pour faire une copie à chaud :
```bash
docker compose exec rollers node -e "new (require('node:sqlite').DatabaseSync)('/data/rollers.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp rollers:/data/backup.db ./sauvegarde-$(date +%F).db
docker compose exec rollers rm /data/backup.db
```

## Utilisation

Aucune identification n'est demandée : chaque scan est enregistré au nom du poste (« GS75 Toussieu », réglable avec `STATION_NAME`). Si un code d'accès est activé, il est demandé une seule fois sur l'appareil.

**Onglet Scanner** (écran des agents) : on scanne, c'est tout. Pas besoin d'appuyer sur Entrée : le scan est validé tout seul dès que le code est lu.
- **Roller sur site** → **départ** enregistré (écran bleu, double bip montant).
- **Roller en transit** → **retour** enregistré (écran vert, double bip descendant), avec la date et l'heure du départ et du retour.
- **Annuler** : un bouton permet d'annuler un scan fait par erreur.
- **Double lecture** : si la douchette lit deux fois la même étiquette en moins de 2 s, la seconde lecture est ignorée. Un roller peut repartir juste après son retour.
- **Saisie de la douchette** :
  - les frappes arrivent dans la zone de scan même si le curseur est ailleurs ;
  - les codes déformés par un clavier AZERTY sont corrigés automatiquement.

**Onglet Rollers** : compteurs (sur site, en transit, en retard), recherche et filtres, création de rollers, impression des étiquettes, fiche et historique de chaque roller, archivage.

**Onglet Historique** : tous les mouvements, avec export CSV pour Excel.

## Étiquettes et matériel

- **Codes** : Code 128 au format `ROL000042`, générés automatiquement à la création.
- **Formats d'impression** :
  - **étiquette 100 × 50 mm** pour une imprimante d'étiquettes (Zebra, Brother…) ;
  - **planche A4 de 3 × 8** étiquettes autocollantes 70 × 37 mm.
  - Imprimer à **100 %**, sans « ajuster à la page ». Pour un usage industriel, préférer des étiquettes polyester ou plastifiées.
- **Douchettes** : n'importe quel modèle USB ou Bluetooth en mode clavier, avec le **Code 128** activé. Le suffixe Entrée n'est pas nécessaire : l'application valide le scan d'elle-même, avec ou sans.
- **Tablettes** : en HTTPS, ouvrir la page puis « Ajouter à l'écran d'accueil » pour l'utiliser comme une application, en plein écran.

## Contenu du projet

| Élément | Rôle |
|---|---|
| `Dockerfile`, `docker-compose.yml`, `.env.example` | Construction et lancement du conteneur |
| `backend/` | Serveur Node.js 24 (Express) : API, base SQLite, service de l'interface |
| `frontend/` | Interface web (TypeScript, sans framework), construite avec esbuild |

## Développement (sur un poste avec Node.js 22+)

```bash
cd frontend && npm install && npm run dev            # reconstruit l'interface à chaque modification
cd backend  && npm install && PUBLIC_DIR=../frontend/dist npm run dev
# → http://localhost:8080
```

Tests :
```bash
cd backend  && npm test               # API : scans, anti-doublon, annulation, CSV, code d'accès, en-têtes
cd frontend && npm run test:barcode   # codes-barres relus par un décodeur ZXing
cd frontend && npm run typecheck
```

## API (résumé)

Toutes les routes sauf `/api/health` exigent l'en-tête `X-Access-Code` si `ACCESS_CODE` est défini.

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/scans` `{code}` | Scan : départ si le roller est sur site, retour s'il est en transit |
| `POST` | `/api/movements/:id/cancel` | Annuler le dernier mouvement d'un roller |
| `GET` | `/api/stats` | Compteurs |
| `GET` / `POST` | `/api/rollers` | Liste (filtres `status`, `q`) / création (`count`, `label`) |
| `GET` / `PATCH` | `/api/rollers/:code` | Fiche + historique / modification, archivage |
| `GET` | `/api/movements` | Historique |
| `GET` | `/api/export/movements.csv` | Export Excel |
| `GET` | `/api/info` | Nom du poste |
| `GET` | `/api/health` | Supervision |

## À noter

- **Un seul poste pour l'instant** : les scans sont enregistrés au nom du poste, pas d'un agent. Si d'autres PC sont ajoutés plus tard, chacun pourra avoir son propre nom de poste. Le code d'accès sert seulement à empêcher que n'importe qui sur le réseau utilise l'outil.
- **Police Gebauer** : c'est la police d'entreprise de Mewa (fonderie TypeMates), intégrée dans l'interface. Vérifier avec la communication que la licence couvre cet outil interne. Sinon, vider `frontend/src/app/brand/fonts.ts` et une police système prend le relais.
